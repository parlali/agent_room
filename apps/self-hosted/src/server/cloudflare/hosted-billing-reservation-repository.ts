import type { AgentRoomHostedEnv } from './bindings'
import {
    assertPositiveCents,
    type HostedBillingReservationProvider,
    type HostedBillingReservationStatus,
} from './hosted-billing-types'
import { readHostedBillingAccount } from './hosted-billing-account-repository'
import { nowIso } from './hosted-json'

interface ReservationRow {
    id: string
    workspaceId: string
    roomId: string | null
    sessionKey: string | null
    runId: string | null
    jobId: string | null
    provider: HostedBillingReservationProvider
    status: HostedBillingReservationStatus
    reservedCents: number
    includedReservedCents: number
    purchasedReservedCents: number
    settledCents: number
    usageEventId: string | null
    billingLedgerEntryId: string | null
    idempotencyKey: string
    metadata: string
    expiresAt: string
    createdAt: string
    updatedAt: string
}

interface ExpiredReservationRow {
    id: string
    workspaceId: string
}

export class HostedBillingReservationAlreadyExistsError extends Error {
    constructor() {
        super('Hosted billing reservation idempotency key already exists')
        this.name = 'HostedBillingReservationAlreadyExistsError'
    }
}

export interface HostedBillingReservation {
    id: string
    workspaceId: string
    roomId: string | null
    sessionKey: string | null
    runId: string | null
    jobId: string | null
    provider: HostedBillingReservationProvider
    status: HostedBillingReservationStatus
    reservedCents: number
    includedReservedCents: number
    purchasedReservedCents: number
    settledCents: number
    usageEventId: string | null
    billingLedgerEntryId: string | null
    idempotencyKey: string
    metadata: Record<string, unknown>
    expiresAt: string
    createdAt: string
    updatedAt: string
}

function mapReservation(row: ReservationRow): HostedBillingReservation {
    return {
        id: row.id,
        workspaceId: row.workspaceId,
        roomId: row.roomId,
        sessionKey: row.sessionKey,
        runId: row.runId,
        jobId: row.jobId,
        provider: row.provider,
        status: row.status,
        reservedCents: row.reservedCents,
        includedReservedCents: row.includedReservedCents,
        purchasedReservedCents: row.purchasedReservedCents,
        settledCents: row.settledCents,
        usageEventId: row.usageEventId,
        billingLedgerEntryId: row.billingLedgerEntryId,
        idempotencyKey: row.idempotencyKey,
        metadata: JSON.parse(row.metadata) as Record<string, unknown>,
        expiresAt: row.expiresAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}

export async function findHostedBillingReservationByIdempotencyKey(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    idempotencyKey: string
}): Promise<HostedBillingReservation | null> {
    const row = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT
                id,
                workspace_id AS workspaceId,
                room_id AS roomId,
                session_key AS sessionKey,
                run_id AS runId,
                job_id AS jobId,
                provider,
                status,
                reserved_cents AS reservedCents,
                included_reserved_cents AS includedReservedCents,
                purchased_reserved_cents AS purchasedReservedCents,
                settled_cents AS settledCents,
                usage_event_id AS usageEventId,
                billing_ledger_entry_id AS billingLedgerEntryId,
                idempotency_key AS idempotencyKey,
                metadata,
                expires_at AS expiresAt,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM hosted_billing_reservation
            WHERE workspace_id = ?1
              AND idempotency_key = ?2
            LIMIT 1
        `,
    )
        .bind(input.workspaceId, input.idempotencyKey)
        .first<ReservationRow>()
    return row ? mapReservation(row) : null
}

async function findReservationById(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    reservationId: string
}): Promise<HostedBillingReservation | null> {
    const row = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT
                id,
                workspace_id AS workspaceId,
                room_id AS roomId,
                session_key AS sessionKey,
                run_id AS runId,
                job_id AS jobId,
                provider,
                status,
                reserved_cents AS reservedCents,
                included_reserved_cents AS includedReservedCents,
                purchased_reserved_cents AS purchasedReservedCents,
                settled_cents AS settledCents,
                usage_event_id AS usageEventId,
                billing_ledger_entry_id AS billingLedgerEntryId,
                idempotency_key AS idempotencyKey,
                metadata,
                expires_at AS expiresAt,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM hosted_billing_reservation
            WHERE workspace_id = ?1
              AND id = ?2
            LIMIT 1
        `,
    )
        .bind(input.workspaceId, input.reservationId)
        .first<ReservationRow>()
    return row ? mapReservation(row) : null
}

export async function findHostedBillingReservationById(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    reservationId: string
}): Promise<HostedBillingReservation | null> {
    return findReservationById(input)
}

export async function releaseExpiredHostedBillingReservations(input: {
    env: AgentRoomHostedEnv
    workspaceId?: string
    now?: Date
    limit?: number
}): Promise<number> {
    const now = nowIso(input.now)
    const limit = Math.max(1, Math.min(input.limit ?? 50, 200))
    const statement = input.workspaceId
        ? input.env.AGENT_ROOM_DB.prepare(
              `
                  SELECT id, workspace_id AS workspaceId
                  FROM hosted_billing_reservation
                  WHERE workspace_id = ?1
                    AND status = 'authorized'
                    AND expires_at <= ?2
                  ORDER BY expires_at ASC
                  LIMIT ${limit}
              `,
          ).bind(input.workspaceId, now)
        : input.env.AGENT_ROOM_DB.prepare(
              `
                  SELECT id, workspace_id AS workspaceId
                  FROM hosted_billing_reservation
                  WHERE status = 'authorized'
                    AND expires_at <= ?1
                  ORDER BY expires_at ASC
                  LIMIT ${limit}
              `,
          ).bind(now)
    const expired = await statement.all<ExpiredReservationRow>()
    let released = 0
    for (const reservation of expired.results ?? []) {
        const closed = await releaseHostedBillingReservation({
            env: input.env,
            workspaceId: reservation.workspaceId,
            reservationId: reservation.id,
            expired: true,
            now: input.now,
        })
        if (closed?.status === 'expired') {
            released += 1
        }
    }
    return released
}

export async function releaseAuthorizedHostedBillingReservationsForRoom(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    now?: Date
}): Promise<number> {
    const rows = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT id, workspace_id AS workspaceId
            FROM hosted_billing_reservation
            WHERE workspace_id = ?1
              AND room_id = ?2
              AND status = 'authorized'
            ORDER BY expires_at ASC
        `,
    )
        .bind(input.workspaceId, input.roomId)
        .all<ExpiredReservationRow>()
    let released = 0
    for (const reservation of rows.results ?? []) {
        const closed = await releaseHostedBillingReservation({
            env: input.env,
            workspaceId: reservation.workspaceId,
            reservationId: reservation.id,
            now: input.now,
        })
        if (closed?.status === 'released') {
            released += 1
        }
    }
    return released
}

export async function authorizeHostedBillingReservation(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string | null
    sessionKey?: string | null
    runId?: string | null
    jobId?: string | null
    provider: HostedBillingReservationProvider
    amountCents: number
    idempotencyKey: string
    metadata?: Record<string, unknown>
    expiresAt: Date
    allowExisting?: boolean
    now?: Date
}): Promise<HostedBillingReservation> {
    assertPositiveCents(input.amountCents)
    await releaseExpiredHostedBillingReservations({
        env: input.env,
        workspaceId: input.workspaceId,
        now: input.now,
    })
    const existing = await findHostedBillingReservationByIdempotencyKey(input)
    if (existing) {
        if (input.allowExisting === false) {
            throw new HostedBillingReservationAlreadyExistsError()
        }
        return existing
    }

    const id = crypto.randomUUID()
    const now = nowIso(input.now)
    const expiresAt = nowIso(input.expiresAt)
    const maxAttempts = 8
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const retryExisting = await findHostedBillingReservationByIdempotencyKey(input)
        if (retryExisting) {
            if (input.allowExisting === false) {
                throw new HostedBillingReservationAlreadyExistsError()
            }
            return retryExisting
        }

        const account = await readHostedBillingAccount(input)
        if (account.availableBalanceCents < input.amountCents) {
            throw new Error('Hosted billing balance is exhausted')
        }
        const includedAvailable = account.includedBalanceCents - account.includedReservedCents
        const includedReserved = Math.min(includedAvailable, input.amountCents)
        const purchasedReserved = input.amountCents - includedReserved
        const [inserted, updated] = await input.env.AGENT_ROOM_DB.batch([
            input.env.AGENT_ROOM_DB.prepare(
                `
                    INSERT INTO hosted_billing_reservation (
                        id,
                        workspace_id,
                        room_id,
                        session_key,
                        run_id,
                        job_id,
                        provider,
                        status,
                        reserved_cents,
                        included_reserved_cents,
                        purchased_reserved_cents,
                        settled_cents,
                        usage_event_id,
                        billing_ledger_entry_id,
                        idempotency_key,
                        metadata,
                        expires_at,
                        created_at,
                        updated_at
                    )
                    SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, 'authorized', ?8, ?9, ?10, 0, NULL, NULL, ?11, ?12, ?13, ?14, ?14
                    WHERE EXISTS (
                        SELECT 1
                        FROM hosted_billing_account
                        WHERE workspace_id = ?2
                          AND included_balance_cents = ?15
                          AND purchased_balance_cents = ?16
                          AND included_reserved_cents = ?17
                          AND purchased_reserved_cents = ?18
                          AND included_balance_cents + purchased_balance_cents - included_reserved_cents - purchased_reserved_cents >= ?8
                    )
                      AND NOT EXISTS (
                          SELECT 1
                          FROM hosted_billing_reservation
                          WHERE workspace_id = ?2
                            AND idempotency_key = ?11
                      )
                `,
            ).bind(
                id,
                input.workspaceId,
                input.roomId,
                input.sessionKey ?? null,
                input.runId ?? null,
                input.jobId ?? null,
                input.provider,
                input.amountCents,
                includedReserved,
                purchasedReserved,
                input.idempotencyKey,
                JSON.stringify(input.metadata ?? {}),
                expiresAt,
                now,
                account.includedBalanceCents,
                account.purchasedBalanceCents,
                account.includedReservedCents,
                account.purchasedReservedCents,
            ),
            input.env.AGENT_ROOM_DB.prepare(
                `
                    UPDATE hosted_billing_account
                    SET included_reserved_cents = included_reserved_cents + ?2,
                        purchased_reserved_cents = purchased_reserved_cents + ?3,
                        updated_at = ?4
                    WHERE workspace_id = ?1
                      AND included_balance_cents = ?5
                      AND purchased_balance_cents = ?6
                      AND included_reserved_cents = ?7
                      AND purchased_reserved_cents = ?8
                      AND EXISTS (
                          SELECT 1
                          FROM hosted_billing_reservation
                          WHERE id = ?9
                            AND workspace_id = ?1
                      )
                `,
            ).bind(
                input.workspaceId,
                includedReserved,
                purchasedReserved,
                now,
                account.includedBalanceCents,
                account.purchasedBalanceCents,
                account.includedReservedCents,
                account.purchasedReservedCents,
                id,
            ),
        ])
        if ((inserted.meta.changes ?? 0) < 1) {
            continue
        }
        if ((updated.meta.changes ?? 0) < 1) {
            throw new Error('Hosted billing reservation was inserted without account hold')
        }
        const reservation = await findReservationById({
            env: input.env,
            workspaceId: input.workspaceId,
            reservationId: id,
        })
        if (!reservation) {
            throw new Error('Hosted billing reservation was not persisted')
        }
        return reservation
    }
    throw new Error('Hosted billing reservation failed due to concurrent balance contention')
}

async function closeHostedBillingReservation(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    reservationId: string
    status: Extract<HostedBillingReservationStatus, 'settled' | 'released' | 'expired'>
    settledCents: number
    usageEventId?: string | null
    billingLedgerEntryId?: string | null
    now?: Date
}): Promise<HostedBillingReservation | null> {
    const reservation = await findReservationById(input)
    if (!reservation || reservation.status !== 'authorized') {
        return reservation
    }
    const now = nowIso(input.now)
    const [updated, account] = await input.env.AGENT_ROOM_DB.batch([
        input.env.AGENT_ROOM_DB.prepare(
            `
                UPDATE hosted_billing_reservation
                SET status = ?3,
                    settled_cents = ?4,
                    usage_event_id = ?5,
                    billing_ledger_entry_id = ?6,
                    updated_at = ?7
                WHERE workspace_id = ?1
                  AND id = ?2
                  AND status = 'authorized'
            `,
        ).bind(
            input.workspaceId,
            input.reservationId,
            input.status,
            Math.min(input.settledCents, reservation.reservedCents),
            input.usageEventId ?? null,
            input.billingLedgerEntryId ?? null,
            now,
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
                        AND status = ?6
                        AND updated_at = ?4
                  )
            `,
        ).bind(
            input.workspaceId,
            reservation.includedReservedCents,
            reservation.purchasedReservedCents,
            now,
            input.reservationId,
            input.status,
        ),
    ])
    if ((updated.meta.changes ?? 0) < 1) {
        throw new Error('Hosted billing reservation status was not updated')
    }
    if ((account.meta.changes ?? 0) < 1) {
        throw new Error('Hosted billing reservation account hold was not released')
    }
    return findReservationById(input)
}

export async function settleHostedBillingReservation(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    reservationId: string
    settledCents: number
    usageEventId: string
    billingLedgerEntryId: string
    now?: Date
}): Promise<HostedBillingReservation | null> {
    return closeHostedBillingReservation({
        ...input,
        status: 'settled',
    })
}

export async function releaseHostedBillingReservation(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    reservationId: string
    expired?: boolean
    now?: Date
}): Promise<HostedBillingReservation | null> {
    return closeHostedBillingReservation({
        env: input.env,
        workspaceId: input.workspaceId,
        reservationId: input.reservationId,
        status: input.expired ? 'expired' : 'released',
        settledCents: 0,
        usageEventId: null,
        billingLedgerEntryId: null,
        now: input.now,
    })
}
