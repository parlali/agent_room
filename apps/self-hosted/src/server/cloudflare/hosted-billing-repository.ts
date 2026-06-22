import type { D1Result } from '@cloudflare/workers-types'
import type { AgentRoomHostedEnv } from './bindings'
import {
    assertPositiveCents,
    bucketForCreditSource,
    type HostedBillableUsageEvent,
    type HostedBillingAccountSnapshot,
    type HostedBillingCreditSource,
    type HostedBillingLedgerEntry,
    type HostedBillingLedgerSource,
    type HostedBillingPlanStatus,
} from './hosted-billing-types'

interface BillingAccountRow {
    workspaceId: string
    stripeCustomerId: string | null
    stripeSubscriptionId: string | null
    planKey: string
    planStatus: HostedBillingPlanStatus
    includedBalanceCents: number
    purchasedBalanceCents: number
    includedMonthlyCreditCents: number
    createdAt: string
    updatedAt: string
}

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

interface BillableUsageRow {
    id: string
    workspaceId: string
    roomId: string | null
    provider: 'openrouter' | 'brave'
    model: string | null
    costMicros: number
    billingStatus: 'not_billable' | 'pending' | 'debited' | 'blocked'
    createdAt: string
}

function nowIso(now = new Date()): string {
    return now.toISOString()
}

function mapAccount(row: BillingAccountRow): HostedBillingAccountSnapshot {
    return {
        workspaceId: row.workspaceId,
        stripeCustomerId: row.stripeCustomerId,
        stripeSubscriptionId: row.stripeSubscriptionId,
        planKey: row.planKey,
        planStatus: row.planStatus,
        includedBalanceCents: row.includedBalanceCents,
        purchasedBalanceCents: row.purchasedBalanceCents,
        currentBalanceCents: row.includedBalanceCents + row.purchasedBalanceCents,
        includedMonthlyCreditCents: row.includedMonthlyCreditCents,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
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

function mapUsage(row: BillableUsageRow): HostedBillableUsageEvent {
    return {
        id: row.id,
        workspaceId: row.workspaceId,
        roomId: row.roomId,
        provider: row.provider,
        model: row.model,
        costMicros: row.costMicros,
        billingStatus: row.billingStatus,
        createdAt: row.createdAt,
    }
}

function assertChanged(result: D1Result<unknown>, message: string): void {
    if ((result.meta.changes ?? 0) < 1) {
        throw new Error(message)
    }
}

export async function ensureHostedBillingAccount(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    now?: Date
}): Promise<HostedBillingAccountSnapshot> {
    const now = nowIso(input.now)
    await input.env.AGENT_ROOM_DB.prepare(
        `
            INSERT INTO hosted_billing_account (
                workspace_id,
                plan_key,
                included_balance_cents,
                purchased_balance_cents,
                included_monthly_credit_cents,
                created_at,
                updated_at
            )
            VALUES (?1, 'none', 0, 0, 0, ?2, ?2)
            ON CONFLICT(workspace_id) DO NOTHING
        `,
    )
        .bind(input.workspaceId, now)
        .run()
    return readHostedBillingAccount(input)
}

export async function readHostedBillingAccount(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
}): Promise<HostedBillingAccountSnapshot> {
    const row = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT
                workspace_id AS workspaceId,
                stripe_customer_id AS stripeCustomerId,
                stripe_subscription_id AS stripeSubscriptionId,
                plan_key AS planKey,
                plan_status AS planStatus,
                included_balance_cents AS includedBalanceCents,
                purchased_balance_cents AS purchasedBalanceCents,
                included_monthly_credit_cents AS includedMonthlyCreditCents,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM hosted_billing_account
            WHERE workspace_id = ?1
            LIMIT 1
        `,
    )
        .bind(input.workspaceId)
        .first<BillingAccountRow>()
    if (!row) {
        throw new Error('Hosted billing account was not found')
    }
    return mapAccount(row)
}

export async function findHostedBillingAccountByStripeIds(input: {
    env: AgentRoomHostedEnv
    stripeCustomerId: string | null
    stripeSubscriptionId: string | null
}): Promise<HostedBillingAccountSnapshot | null> {
    const row = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT
                workspace_id AS workspaceId,
                stripe_customer_id AS stripeCustomerId,
                stripe_subscription_id AS stripeSubscriptionId,
                plan_key AS planKey,
                plan_status AS planStatus,
                included_balance_cents AS includedBalanceCents,
                purchased_balance_cents AS purchasedBalanceCents,
                included_monthly_credit_cents AS includedMonthlyCreditCents,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM hosted_billing_account
            WHERE (?1 IS NOT NULL AND stripe_subscription_id = ?1)
               OR (?2 IS NOT NULL AND stripe_customer_id = ?2)
            LIMIT 1
        `,
    )
        .bind(input.stripeSubscriptionId, input.stripeCustomerId)
        .first<BillingAccountRow>()
    return row ? mapAccount(row) : null
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
    const before = await readHostedBillingAccount(input)
    const balanceAfterCents = before.currentBalanceCents + input.amountCents
    const inserted = await input.env.AGENT_ROOM_DB.prepare(
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
            VALUES (?1, ?2, 'credit', ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?9, ?10, ?11)
            ON CONFLICT(workspace_id, idempotency_key) DO NOTHING
        `,
    )
        .bind(
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
        )
        .run()
    if ((inserted.meta.changes ?? 0) < 1) {
        const winner = await findLedgerEntryByIdempotencyKey(input)
        if (winner) return winner
        throw new Error('Hosted billing credit conflicted without a persisted ledger entry')
    }
    const bucketColumn =
        bucket === 'included' ? 'included_balance_cents' : 'purchased_balance_cents'
    const account = await input.env.AGENT_ROOM_DB.prepare(
        `
            UPDATE hosted_billing_account
            SET ${bucketColumn} = ${bucketColumn} + ?2,
                updated_at = ?3
            WHERE workspace_id = ?1
            RETURNING included_balance_cents + purchased_balance_cents AS currentBalanceCents
        `,
    )
        .bind(input.workspaceId, input.amountCents, now)
        .first<{ currentBalanceCents: number }>()
    if (!account) {
        throw new Error('Hosted billing account was not found while crediting balance')
    }
    const entry = await findLedgerEntryByIdempotencyKey(input)
    if (!entry) {
        throw new Error('Hosted billing credit ledger entry was not persisted')
    }
    return entry
}

export async function debitHostedBalance(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    source: Extract<HostedBillingLedgerSource, 'hosted_openrouter_usage' | 'hosted_brave_usage'>
    amountCents: number
    usageEventId: string
    idempotencyKey: string
    metadata?: Record<string, unknown>
    now?: Date
}): Promise<HostedBillingLedgerEntry> {
    assertPositiveCents(input.amountCents)
    const existing = await findLedgerEntryByIdempotencyKey(input)
    if (existing) return existing

    const id = crypto.randomUUID()
    const now = nowIso(input.now)
    const maxAttempts = 8
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const before = await readHostedBillingAccount(input)
        if (before.includedBalanceCents + before.purchasedBalanceCents < input.amountCents) {
            await markHostedUsageBillingBlocked({
                env: input.env,
                workspaceId: input.workspaceId,
                usageEventId: input.usageEventId,
            })
            throw new Error('Hosted billing balance is exhausted')
        }
        const includedDrawn = Math.min(before.includedBalanceCents, input.amountCents)
        const purchasedDrawn = input.amountCents - includedDrawn
        const account = await input.env.AGENT_ROOM_DB.prepare(
            `
                UPDATE hosted_billing_account
                SET included_balance_cents = included_balance_cents - ?2,
                    purchased_balance_cents = purchased_balance_cents - ?3,
                    updated_at = ?4
                WHERE workspace_id = ?1
                  AND included_balance_cents = ?5
                  AND purchased_balance_cents = ?6
                RETURNING included_balance_cents + purchased_balance_cents AS currentBalanceCents
            `,
        )
            .bind(
                input.workspaceId,
                includedDrawn,
                purchasedDrawn,
                now,
                before.includedBalanceCents,
                before.purchasedBalanceCents,
            )
            .first<{ currentBalanceCents: number }>()
        if (!account) {
            continue
        }

        await input.env.AGENT_ROOM_DB.prepare(
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
                VALUES (?1, ?2, 'debit', ?3, ?4, ?5, NULL, NULL, NULL, ?6, ?7, ?8, ?9)
            `,
        )
            .bind(
                id,
                input.workspaceId,
                input.source,
                input.amountCents,
                account.currentBalanceCents,
                input.usageEventId,
                input.idempotencyKey,
                JSON.stringify({
                    ...input.metadata,
                    includedDebitedCents: includedDrawn,
                    purchasedDebitedCents: purchasedDrawn,
                }),
                now,
            )
            .run()

        await markHostedUsageBillingDebited({
            env: input.env,
            workspaceId: input.workspaceId,
            usageEventId: input.usageEventId,
            ledgerEntryId: id,
        })
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
    if (before.includedBalanceCents === 0) return null

    const id = crypto.randomUUID()
    const now = nowIso(input.now)
    const clearedCents = before.includedBalanceCents
    const account = await input.env.AGENT_ROOM_DB.prepare(
        `
            UPDATE hosted_billing_account
            SET included_balance_cents = 0,
                updated_at = ?3
            WHERE workspace_id = ?1
              AND included_balance_cents = ?2
            RETURNING included_balance_cents + purchased_balance_cents AS currentBalanceCents
        `,
    )
        .bind(input.workspaceId, clearedCents, now)
        .first<{ currentBalanceCents: number }>()
    if (!account) {
        throw new Error('Hosted included balance changed while expiring leftover credit')
    }

    await input.env.AGENT_ROOM_DB.prepare(
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
    )
        .bind(
            id,
            input.workspaceId,
            clearedCents,
            account.currentBalanceCents,
            input.stripeEventId ?? null,
            input.stripeInvoiceId ?? null,
            input.idempotencyKey,
            JSON.stringify(input.metadata ?? {}),
            now,
        )
        .run()
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

export async function upsertHostedStripeCustomer(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    stripeCustomerId: string
    stripeSubscriptionId?: string | null
    planStatus?: HostedBillingPlanStatus
    planKey?: string
    includedMonthlyCreditCents?: number
    now?: Date
}): Promise<void> {
    const now = nowIso(input.now)
    const result = await input.env.AGENT_ROOM_DB.prepare(
        `
            UPDATE hosted_billing_account
            SET stripe_customer_id = ?2,
                stripe_subscription_id = COALESCE(?3, stripe_subscription_id),
                plan_status = COALESCE(?4, plan_status),
                plan_key = COALESCE(?5, plan_key),
                included_monthly_credit_cents = COALESCE(?6, included_monthly_credit_cents),
                updated_at = ?7
            WHERE workspace_id = ?1
        `,
    )
        .bind(
            input.workspaceId,
            input.stripeCustomerId,
            input.stripeSubscriptionId ?? null,
            input.planStatus ?? null,
            input.planKey ?? null,
            input.includedMonthlyCreditCents ?? null,
            now,
        )
        .run()
    assertChanged(result, 'Hosted billing account was not found while updating Stripe customer')
}

export async function recordHostedStripeEvent(input: {
    env: AgentRoomHostedEnv
    eventId: string
    type: string
    livemode: boolean
    now?: Date
}): Promise<boolean> {
    const result = await input.env.AGENT_ROOM_DB.prepare(
        `
            INSERT OR IGNORE INTO hosted_stripe_event (id, type, livemode, processed_at)
            VALUES (?1, ?2, ?3, ?4)
        `,
    )
        .bind(input.eventId, input.type, input.livemode ? 1 : 0, nowIso(input.now))
        .run()
    return (result.meta.changes ?? 0) > 0
}

export async function hostedStripeEventExists(input: {
    env: AgentRoomHostedEnv
    eventId: string
}): Promise<boolean> {
    const row = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT 1 AS present
            FROM hosted_stripe_event
            WHERE id = ?1
            LIMIT 1
        `,
    )
        .bind(input.eventId)
        .first<{ present: number }>()
    return row !== null
}

export async function appendHostedUsageEvent(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string | null
    sessionKey: string | null
    runId: string | null
    jobId: string | null
    kind: string
    provider: string | null
    model: string | null
    toolName: string | null
    inputTokens: number | null
    outputTokens: number | null
    cachedTokens: number | null
    costMicros: number | null
    billingStatus: 'not_billable' | 'pending'
    now?: Date
}): Promise<string> {
    const id = crypto.randomUUID()
    await input.env.AGENT_ROOM_DB.prepare(
        `
            INSERT INTO hosted_usage_event (
                id,
                workspace_id,
                room_id,
                session_key,
                run_id,
                job_id,
                kind,
                provider,
                model,
                tool_name,
                input_tokens,
                output_tokens,
                cached_tokens,
                cost_micros,
                billing_status,
                created_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
        `,
    )
        .bind(
            id,
            input.workspaceId,
            input.roomId,
            input.sessionKey,
            input.runId,
            input.jobId,
            input.kind,
            input.provider,
            input.model,
            input.toolName,
            input.inputTokens,
            input.outputTokens,
            input.cachedTokens,
            input.costMicros,
            input.billingStatus,
            nowIso(input.now),
        )
        .run()
    return id
}

export async function listRecentHostedBillableUsage(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    limit: number
}): Promise<HostedBillableUsageEvent[]> {
    const result = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT
                id,
                workspace_id AS workspaceId,
                room_id AS roomId,
                provider,
                model,
                cost_micros AS costMicros,
                billing_status AS billingStatus,
                created_at AS createdAt
            FROM hosted_usage_event
            WHERE workspace_id = ?1
              AND provider IN ('openrouter', 'brave')
            ORDER BY created_at DESC
            LIMIT ?2
        `,
    )
        .bind(input.workspaceId, input.limit)
        .all<BillableUsageRow>()
    return result.results.map(mapUsage)
}

async function markHostedUsageBillingDebited(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    usageEventId: string
    ledgerEntryId: string
}): Promise<void> {
    const result = await input.env.AGENT_ROOM_DB.prepare(
        `
            UPDATE hosted_usage_event
            SET billing_status = 'debited',
                billing_ledger_entry_id = ?3
            WHERE workspace_id = ?1
              AND id = ?2
              AND billing_status = 'pending'
        `,
    )
        .bind(input.workspaceId, input.usageEventId, input.ledgerEntryId)
        .run()
    assertChanged(result, 'Hosted usage event was not pending while marking debit')
}

async function markHostedUsageBillingBlocked(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    usageEventId: string
}): Promise<void> {
    await input.env.AGENT_ROOM_DB.prepare(
        `
            UPDATE hosted_usage_event
            SET billing_status = 'blocked'
            WHERE workspace_id = ?1
              AND id = ?2
              AND billing_status = 'pending'
        `,
    )
        .bind(input.workspaceId, input.usageEventId)
        .run()
}
