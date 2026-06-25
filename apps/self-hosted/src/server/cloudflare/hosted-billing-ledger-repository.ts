import type { AgentRoomHostedEnv } from './bindings'
import {
    assertPositiveCents,
    bucketForCreditSource,
    type HostedBillingCreditSource,
    type HostedBillingLedgerEntry,
    type HostedBillingLedgerSource,
} from './hosted-billing-types'
import { readHostedBillingAccount } from './hosted-billing-account-repository'
import {
    markHostedUsageBillingBlocked,
    readHostedUsageBillingState,
} from './hosted-billing-usage-repository'
import { nowIso } from './hosted-json'

interface LedgerRow {
    id: string
    workspaceId: string
    direction: 'credit' | 'debit'
    source: HostedBillingLedgerSource
    amountCents: number
    balanceAfterCents: number
    stripeEventId: string | null
    stripeCheckoutSessionId: string | null
    stripeInvoiceId: string | null
    usageEventId: string | null
    idempotencyKey: string
    metadata: string
    createdAt: string
}

function mapLedger(row: LedgerRow): HostedBillingLedgerEntry {
    return {
        id: row.id,
        workspaceId: row.workspaceId,
        direction: row.direction,
        source: row.source,
        amountCents: row.amountCents,
        balanceAfterCents: row.balanceAfterCents,
        stripeEventId: row.stripeEventId,
        stripeCheckoutSessionId: row.stripeCheckoutSessionId,
        stripeInvoiceId: row.stripeInvoiceId,
        usageEventId: row.usageEventId,
        idempotencyKey: row.idempotencyKey,
        metadata: JSON.parse(row.metadata) as Record<string, unknown>,
        createdAt: row.createdAt,
    }
}

export async function listHostedBillingLedger(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    limit: number
}): Promise<HostedBillingLedgerEntry[]> {
    const result = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT
                id,
                workspace_id AS workspaceId,
                direction,
                source,
                amount_cents AS amountCents,
                balance_after_cents AS balanceAfterCents,
                stripe_event_id AS stripeEventId,
                stripe_checkout_session_id AS stripeCheckoutSessionId,
                stripe_invoice_id AS stripeInvoiceId,
                usage_event_id AS usageEventId,
                idempotency_key AS idempotencyKey,
                metadata,
                created_at AS createdAt
            FROM hosted_billing_ledger_entry
            WHERE workspace_id = ?1
            ORDER BY created_at DESC
            LIMIT ?2
        `,
    )
        .bind(input.workspaceId, input.limit)
        .all<LedgerRow>()
    return result.results.map(mapLedger)
}

export async function creditHostedBalance(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    source: Extract<
        HostedBillingCreditSource,
        'subscription_included_credit' | 'stripe_topup' | 'manual_adjustment'
    >
    amountCents: number
    idempotencyKey: string
    stripeEventId?: string | null
    stripeCheckoutSessionId?: string | null
    stripeInvoiceId?: string | null
    metadata?: Record<string, unknown>
    now?: Date
}): Promise<HostedBillingLedgerEntry> {
    assertPositiveCents(input.amountCents)
    const existing = await findLedgerEntryByIdempotencyKey(input)
    if (existing) return existing

    const id = crypto.randomUUID()
    const now = nowIso(input.now)
    const bucket = bucketForCreditSource(input.source)
    const bucketColumn =
        bucket === 'included' ? 'included_balance_cents' : 'purchased_balance_cents'
    const before = await readHostedBillingAccount(input)
    const balanceAfterCents = before.currentBalanceCents + input.amountCents
    const [inserted, updated] = await input.env.AGENT_ROOM_DB.batch([
        input.env.AGENT_ROOM_DB.prepare(
            `
                INSERT INTO hosted_billing_ledger_entry (
                    id,
                    workspace_id,
                    direction,
                    source,
                    amount_cents,
                    balance_after_cents,
                    stripe_event_id,
                    stripe_checkout_session_id,
                    stripe_invoice_id,
                    usage_event_id,
                    idempotency_key,
                    metadata,
                    created_at
                )
                SELECT ?1, ?2, 'credit', ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?9, ?10, ?11
                WHERE EXISTS (
                    SELECT 1
                    FROM hosted_billing_account
                    WHERE workspace_id = ?2
                      AND included_balance_cents = ?12
                      AND purchased_balance_cents = ?13
                )
                  AND NOT EXISTS (
                      SELECT 1
                      FROM hosted_billing_ledger_entry
                      WHERE workspace_id = ?2
                        AND idempotency_key = ?9
                  )
            `,
        ).bind(
            id,
            input.workspaceId,
            input.source,
            input.amountCents,
            balanceAfterCents,
            input.stripeEventId ?? null,
            input.stripeCheckoutSessionId ?? null,
            input.stripeInvoiceId ?? null,
            input.idempotencyKey,
            JSON.stringify(input.metadata ?? {}),
            now,
            before.includedBalanceCents,
            before.purchasedBalanceCents,
        ),
        input.env.AGENT_ROOM_DB.prepare(
            `
                UPDATE hosted_billing_account
                SET ${bucketColumn} = ${bucketColumn} + ?2,
                    updated_at = ?3
                WHERE workspace_id = ?1
                  AND included_balance_cents = ?4
                  AND purchased_balance_cents = ?5
                  AND EXISTS (
                      SELECT 1
                      FROM hosted_billing_ledger_entry
                      WHERE id = ?6
                        AND workspace_id = ?1
                  )
            `,
        ).bind(
            input.workspaceId,
            input.amountCents,
            now,
            before.includedBalanceCents,
            before.purchasedBalanceCents,
            id,
        ),
    ])
    if ((inserted.meta.changes ?? 0) < 1) {
        const winner = await findLedgerEntryByIdempotencyKey(input)
        if (winner) return winner
        throw new Error('Hosted billing credit conflicted without a persisted ledger entry')
    }
    if ((updated.meta.changes ?? 0) < 1) {
        throw new Error('Hosted billing credit ledger was inserted without balance update')
    }
    const entry = await findLedgerEntryByIdempotencyKey(input)
    if (!entry) {
        throw new Error('Hosted billing credit ledger entry was not persisted')
    }
    return entry
}

interface DebitReservationSettlementInput {
    env: AgentRoomHostedEnv
    workspaceId: string
    usageEventId: string
    billingLedgerEntryId: string
    settleReservation?: {
        reservationId: string
        reservedCents: number
        includedReservedCents: number
        purchasedReservedCents: number
        settledCents: number
    }
    now?: Date
}

async function repairExistingHostedBillingDebitReservation(
    input: DebitReservationSettlementInput,
): Promise<void> {
    if (!input.settleReservation) {
        return
    }
    const now = nowIso(input.now)
    const [updated, account] = await input.env.AGENT_ROOM_DB.batch([
        input.env.AGENT_ROOM_DB.prepare(
            `
                UPDATE hosted_billing_reservation
                SET status = 'settled',
                    settled_cents = ?3,
                    usage_event_id = ?4,
                    billing_ledger_entry_id = ?5,
                    updated_at = ?6
                WHERE workspace_id = ?1
                  AND id = ?2
                  AND status = 'authorized'
                  AND included_reserved_cents = ?7
                  AND purchased_reserved_cents = ?8
                  AND EXISTS (
                      SELECT 1
                      FROM hosted_billing_ledger_entry
                      WHERE workspace_id = ?1
                        AND id = ?5
                        AND usage_event_id = ?4
                  )
            `,
        ).bind(
            input.workspaceId,
            input.settleReservation.reservationId,
            Math.min(input.settleReservation.settledCents, input.settleReservation.reservedCents),
            input.usageEventId,
            input.billingLedgerEntryId,
            now,
            input.settleReservation.includedReservedCents,
            input.settleReservation.purchasedReservedCents,
        ),
        input.env.AGENT_ROOM_DB.prepare(
            `
                UPDATE hosted_billing_account
                SET included_reserved_cents = included_reserved_cents - ?2,
                    purchased_reserved_cents = purchased_reserved_cents - ?3,
                    updated_at = ?4
                WHERE workspace_id = ?1
                  AND included_reserved_cents >= ?2
                  AND purchased_reserved_cents >= ?3
                  AND EXISTS (
                      SELECT 1
                      FROM hosted_billing_reservation
                      WHERE workspace_id = ?1
                        AND id = ?5
                        AND status = 'settled'
                        AND updated_at = ?4
                  )
            `,
        ).bind(
            input.workspaceId,
            input.settleReservation.includedReservedCents,
            input.settleReservation.purchasedReservedCents,
            now,
            input.settleReservation.reservationId,
        ),
    ])
    if ((updated.meta.changes ?? 0) > 0 && (account.meta.changes ?? 0) < 1) {
        throw new Error('Hosted billing existing debit reservation hold was not released')
    }
}

export async function debitHostedBalance(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    source: Extract<
        HostedBillingLedgerSource,
        | 'hosted_openrouter_usage'
        | 'hosted_brave_usage'
        | 'hosted_browserbase_usage'
        | 'hosted_fetch_url_usage'
    >
    amountCents: number
    usageEventId: string
    idempotencyKey: string
    metadata?: Record<string, unknown>
    reservedDraw?: {
        includedCents: number
        purchasedCents: number
    }
    settleReservation?: {
        reservationId: string
        reservedCents: number
        includedReservedCents: number
        purchasedReservedCents: number
        settledCents: number
    }
    now?: Date
}): Promise<HostedBillingLedgerEntry> {
    assertPositiveCents(input.amountCents)
    const existing = await findLedgerEntryByIdempotencyKey(input)
    if (existing) {
        await repairExistingHostedBillingDebitReservation({
            env: input.env,
            workspaceId: input.workspaceId,
            usageEventId: input.usageEventId,
            billingLedgerEntryId: existing.id,
            settleReservation: input.settleReservation,
            now: input.now,
        })
        return existing
    }

    const id = crypto.randomUUID()
    const now = nowIso(input.now)
    const maxAttempts = 8
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const retryExisting = await findLedgerEntryByIdempotencyKey(input)
        if (retryExisting) {
            await repairExistingHostedBillingDebitReservation({
                env: input.env,
                workspaceId: input.workspaceId,
                usageEventId: input.usageEventId,
                billingLedgerEntryId: retryExisting.id,
                settleReservation: input.settleReservation,
                now: input.now,
            })
            return retryExisting
        }

        const usageState = await readHostedUsageBillingState({
            env: input.env,
            workspaceId: input.workspaceId,
            usageEventId: input.usageEventId,
        })
        if (!usageState) {
            throw new Error('Hosted billing debit requires an existing usage event')
        }
        if (usageState.billingStatus !== 'pending') {
            throw new Error(
                `Hosted billing debit requires pending usage; found ${usageState.billingStatus}`,
            )
        }

        const before = await readHostedBillingAccount(input)
        const includedReservedDraw = Math.min(
            Math.max(0, Math.floor(input.reservedDraw?.includedCents ?? 0)),
            before.includedReservedCents,
        )
        const purchasedReservedDraw = Math.min(
            Math.max(0, Math.floor(input.reservedDraw?.purchasedCents ?? 0)),
            before.purchasedReservedCents,
        )
        const includedReservedRelease = Math.min(
            Math.max(0, Math.floor(input.settleReservation?.includedReservedCents ?? 0)),
            before.includedReservedCents,
        )
        const purchasedReservedRelease = Math.min(
            Math.max(0, Math.floor(input.settleReservation?.purchasedReservedCents ?? 0)),
            before.purchasedReservedCents,
        )
        const includedSpendable =
            before.includedBalanceCents - before.includedReservedCents + includedReservedDraw
        const purchasedSpendable =
            before.purchasedBalanceCents - before.purchasedReservedCents + purchasedReservedDraw
        if (includedSpendable + purchasedSpendable < input.amountCents) {
            await markHostedUsageBillingBlocked({
                env: input.env,
                workspaceId: input.workspaceId,
                usageEventId: input.usageEventId,
            })
            throw new Error('Hosted billing balance is exhausted')
        }
        const includedDrawn = Math.min(includedSpendable, input.amountCents)
        const purchasedDrawn = input.amountCents - includedDrawn
        const balanceAfterCents =
            before.includedBalanceCents + before.purchasedBalanceCents - input.amountCents
        const metadata = JSON.stringify({
            ...input.metadata,
            includedDebitedCents: includedDrawn,
            purchasedDebitedCents: purchasedDrawn,
            includedReservedDebitCents: includedReservedDraw,
            purchasedReservedDebitCents: purchasedReservedDraw,
            includedReservedReleasedCents: includedReservedRelease,
            purchasedReservedReleasedCents: purchasedReservedRelease,
        })
        const statements = [
            input.env.AGENT_ROOM_DB.prepare(
                `
                    INSERT INTO hosted_billing_ledger_entry (
                        id,
                        workspace_id,
                        direction,
                        source,
                        amount_cents,
                        balance_after_cents,
                        stripe_event_id,
                        stripe_checkout_session_id,
                        stripe_invoice_id,
                        usage_event_id,
                        idempotency_key,
                        metadata,
                        created_at
                    )
                    SELECT ?1, ?2, 'debit', ?3, ?4, ?5, NULL, NULL, NULL, ?6, ?7, ?8, ?9
	                    WHERE EXISTS (
	                        SELECT 1
	                        FROM hosted_billing_account
	                        WHERE workspace_id = ?2
	                          AND included_balance_cents = ?10
	                          AND purchased_balance_cents = ?11
	                          AND included_reserved_cents = ?12
	                          AND purchased_reserved_cents = ?13
	                          AND included_balance_cents + purchased_balance_cents - included_reserved_cents - purchased_reserved_cents + ?14 + ?15 >= ?4
	                    )
                      AND EXISTS (
                        SELECT 1
                        FROM hosted_usage_event
                        WHERE workspace_id = ?2
                          AND id = ?6
                          AND billing_status = 'pending'
	                    )
	                      AND NOT EXISTS (
	                        SELECT 1
	                        FROM hosted_billing_ledger_entry
	                        WHERE workspace_id = ?2
	                          AND idempotency_key = ?7
	                    )
	                `,
            ).bind(
                id,
                input.workspaceId,
                input.source,
                input.amountCents,
                balanceAfterCents,
                input.usageEventId,
                input.idempotencyKey,
                metadata,
                now,
                before.includedBalanceCents,
                before.purchasedBalanceCents,
                before.includedReservedCents,
                before.purchasedReservedCents,
                includedReservedDraw,
                purchasedReservedDraw,
            ),
            input.env.AGENT_ROOM_DB.prepare(
                `
		                    UPDATE hosted_billing_account
		                    SET included_balance_cents = included_balance_cents - ?2,
		                        purchased_balance_cents = purchased_balance_cents - ?3,
		                        included_reserved_cents = included_reserved_cents - ?4,
		                        purchased_reserved_cents = purchased_reserved_cents - ?5,
		                        updated_at = ?6
		                    WHERE workspace_id = ?1
		                      AND included_balance_cents = ?7
		                      AND purchased_balance_cents = ?8
		                      AND included_reserved_cents = ?9
		                      AND purchased_reserved_cents = ?10
		                      AND included_reserved_cents >= ?4
		                      AND purchased_reserved_cents >= ?5
		                      AND EXISTS (
		                          SELECT 1
		                          FROM hosted_billing_ledger_entry
		                          WHERE id = ?11
		                            AND workspace_id = ?1
		                      )
		                `,
            ).bind(
                input.workspaceId,
                includedDrawn,
                purchasedDrawn,
                includedReservedRelease,
                purchasedReservedRelease,
                now,
                before.includedBalanceCents,
                before.purchasedBalanceCents,
                before.includedReservedCents,
                before.purchasedReservedCents,
                id,
            ),
            input.env.AGENT_ROOM_DB.prepare(
                `
                    UPDATE hosted_usage_event
                    SET billing_status = 'debited',
                        billing_ledger_entry_id = ?3
                    WHERE workspace_id = ?1
                      AND id = ?2
                      AND billing_status = 'pending'
                      AND EXISTS (
                          SELECT 1
                          FROM hosted_billing_ledger_entry
                          WHERE id = ?3
                            AND workspace_id = ?1
                      )
	                `,
            ).bind(input.workspaceId, input.usageEventId, id),
        ]
        if (input.settleReservation) {
            statements.push(
                input.env.AGENT_ROOM_DB.prepare(
                    `
                        UPDATE hosted_billing_reservation
                        SET status = 'settled',
                            settled_cents = ?3,
                            usage_event_id = ?4,
                            billing_ledger_entry_id = ?5,
                            updated_at = ?6
                        WHERE workspace_id = ?1
                          AND id = ?2
                          AND status = 'authorized'
                          AND included_reserved_cents = ?7
                          AND purchased_reserved_cents = ?8
                          AND EXISTS (
                              SELECT 1
                              FROM hosted_billing_ledger_entry
                              WHERE workspace_id = ?1
                                AND id = ?5
                                AND usage_event_id = ?4
                          )
                    `,
                ).bind(
                    input.workspaceId,
                    input.settleReservation.reservationId,
                    Math.min(
                        input.settleReservation.settledCents,
                        input.settleReservation.reservedCents,
                    ),
                    input.usageEventId,
                    id,
                    now,
                    input.settleReservation.includedReservedCents,
                    input.settleReservation.purchasedReservedCents,
                ),
            )
        }
        const results = await input.env.AGENT_ROOM_DB.batch(statements)
        const inserted = results[0]
        const updated = results[1]
        const marked = results[2]
        const settled = results[3]
        if ((inserted.meta.changes ?? 0) < 1) {
            continue
        }
        if ((updated.meta.changes ?? 0) < 1) {
            throw new Error('Hosted billing debit ledger was inserted without balance update')
        }
        if ((marked.meta.changes ?? 0) < 1) {
            throw new Error('Hosted billing debit ledger was inserted without marking usage')
        }
        if (input.settleReservation && (!settled || (settled.meta.changes ?? 0) < 1)) {
            throw new Error('Hosted billing debit ledger was inserted without settling reservation')
        }
        const entry = await findLedgerEntryByIdempotencyKey(input)
        if (!entry) {
            throw new Error('Hosted billing debit ledger entry was not persisted')
        }
        return entry
    }
    throw new Error('Hosted billing debit failed due to concurrent balance contention')
}

export async function expireIncludedBalance(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    idempotencyKey: string
    stripeEventId?: string | null
    stripeInvoiceId?: string | null
    metadata?: Record<string, unknown>
    now?: Date
}): Promise<HostedBillingLedgerEntry | null> {
    const existing = await findLedgerEntryByIdempotencyKey(input)
    if (existing) return existing

    const before = await readHostedBillingAccount(input)
    const clearedCents = Math.max(0, before.includedBalanceCents - before.includedReservedCents)
    if (clearedCents === 0) return null

    const id = crypto.randomUUID()
    const now = nowIso(input.now)
    const balanceAfterCents = before.includedReservedCents + before.purchasedBalanceCents
    const results = await input.env.AGENT_ROOM_DB.batch([
        input.env.AGENT_ROOM_DB.prepare(
            `
                UPDATE hosted_billing_account
                SET included_balance_cents = included_reserved_cents,
                    updated_at = ?3
                WHERE workspace_id = ?1
                  AND included_balance_cents = ?2
                  AND included_reserved_cents = ?4
            `,
        ).bind(input.workspaceId, before.includedBalanceCents, now, before.includedReservedCents),
        input.env.AGENT_ROOM_DB.prepare(
            `
                INSERT INTO hosted_billing_ledger_entry (
                    id,
                    workspace_id,
                    direction,
                    source,
                    amount_cents,
                    balance_after_cents,
                    stripe_event_id,
                    stripe_checkout_session_id,
                    stripe_invoice_id,
                    usage_event_id,
                    idempotency_key,
                    metadata,
                    created_at
                )
                VALUES (?1, ?2, 'debit', 'included_credit_expiry', ?3, ?4, ?5, NULL, ?6, NULL, ?7, ?8, ?9)
            `,
        ).bind(
            id,
            input.workspaceId,
            clearedCents,
            balanceAfterCents,
            input.stripeEventId ?? null,
            input.stripeInvoiceId ?? null,
            input.idempotencyKey,
            JSON.stringify(input.metadata ?? {}),
            now,
        ),
    ])
    const updated = results[0]
    const inserted = results[1]
    if ((updated.meta.changes ?? 0) < 1) {
        throw new Error('Hosted included balance changed while expiring leftover credit')
    }
    if ((inserted.meta.changes ?? 0) < 1) {
        throw new Error('Hosted included credit expiry ledger entry was not inserted')
    }
    const entry = await findLedgerEntryByIdempotencyKey(input)
    if (!entry) {
        throw new Error('Hosted included credit expiry ledger entry was not persisted')
    }
    return entry
}

export async function findLedgerEntryByIdempotencyKey(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    idempotencyKey: string
}): Promise<HostedBillingLedgerEntry | null> {
    const row = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT
                id,
                workspace_id AS workspaceId,
                direction,
                source,
                amount_cents AS amountCents,
                balance_after_cents AS balanceAfterCents,
                stripe_event_id AS stripeEventId,
                stripe_checkout_session_id AS stripeCheckoutSessionId,
                stripe_invoice_id AS stripeInvoiceId,
                usage_event_id AS usageEventId,
                idempotency_key AS idempotencyKey,
                metadata,
                created_at AS createdAt
            FROM hosted_billing_ledger_entry
            WHERE workspace_id = ?1
              AND idempotency_key = ?2
            LIMIT 1
        `,
    )
        .bind(input.workspaceId, input.idempotencyKey)
        .first<LedgerRow>()
    return row ? mapLedger(row) : null
}
