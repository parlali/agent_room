import type { D1Result } from '@cloudflare/workers-types'
import type { AgentRoomHostedEnv } from './bindings'
import type { HostedBillableUsageEvent, HostedUsageBillingStatus } from './hosted-billing-types'
import { nowIso } from './hosted-json'

interface BillableUsageRow {
    id: string
    workspaceId: string
    roomId: string | null
    provider: 'openrouter' | 'brave'
    model: string | null
    costMicros: number
    billingStatus: HostedUsageBillingStatus
    createdAt: string
}

interface UsageEventIdRow {
    id: string
}

interface ProviderUsageSettlementRow {
    id: string
    roomId: string | null
    sessionKey: string | null
    runId: string | null
    jobId: string | null
    provider: 'openrouter' | 'brave'
    model: string | null
    costMicros: number | null
    billingStatus: HostedUsageBillingStatus
    billingLedgerEntryId: string | null
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
    reasoningTokens?: number | null
    totalTokens?: number | null
    durationMs?: number | null
    activeDurationMs?: number | null
    idleDurationMs?: number | null
    estimatedCostUsd?: string | null
    costMicros: number | null
    billingStatus: 'not_billable' | 'pending' | 'blocked'
    metadata?: Record<string, unknown>
    idempotencyKey?: string | null
    now?: Date
}): Promise<string> {
    const idempotencyKey = input.idempotencyKey?.trim() || null
    if (idempotencyKey) {
        const existing = await findHostedUsageEventIdByIdempotencyKey({
            env: input.env,
            workspaceId: input.workspaceId,
            idempotencyKey,
        })
        if (existing) return existing
    }
    const id = crypto.randomUUID()
    let inserted: D1Result
    try {
        inserted = await input.env.AGENT_ROOM_DB.prepare(
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
                    reasoning_tokens,
                    total_tokens,
                    duration_ms,
                    active_duration_ms,
                    idle_duration_ms,
                    estimated_cost_usd,
                    cost_micros,
                    billing_status,
                    metadata,
                    idempotency_key,
                    created_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24)
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
                input.reasoningTokens ?? null,
                input.totalTokens ?? null,
                input.durationMs ?? null,
                input.activeDurationMs ?? null,
                input.idleDurationMs ?? null,
                input.estimatedCostUsd ?? null,
                input.costMicros,
                input.billingStatus,
                JSON.stringify(input.metadata ?? {}),
                idempotencyKey,
                nowIso(input.now),
            )
            .run()
    } catch (error) {
        if (idempotencyKey) {
            const existing = await findHostedUsageEventIdByIdempotencyKey({
                env: input.env,
                workspaceId: input.workspaceId,
                idempotencyKey,
            })
            if (existing) return existing
        }
        throw error
    }
    if ((inserted.meta.changes ?? 0) < 1 && idempotencyKey) {
        const existing = await findHostedUsageEventIdByIdempotencyKey({
            env: input.env,
            workspaceId: input.workspaceId,
            idempotencyKey,
        })
        if (existing) return existing
    }
    if ((inserted.meta.changes ?? 0) < 1) {
        throw new Error('Hosted usage event was not inserted')
    }
    return id
}

export async function readHostedUsageBillingState(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    usageEventId: string
}): Promise<{
    billingStatus: HostedUsageBillingStatus
    billingLedgerEntryId: string | null
} | null> {
    return input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT
                billing_status AS billingStatus,
                billing_ledger_entry_id AS billingLedgerEntryId
            FROM hosted_usage_event
            WHERE workspace_id = ?1
              AND id = ?2
            LIMIT 1
        `,
    )
        .bind(input.workspaceId, input.usageEventId)
        .first<{
            billingStatus: HostedUsageBillingStatus
            billingLedgerEntryId: string | null
        }>()
}

export async function findHostedUsageEventIdByIdempotencyKey(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    idempotencyKey: string
}): Promise<string | null> {
    const row = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT id
            FROM hosted_usage_event
            WHERE workspace_id = ?1
              AND idempotency_key = ?2
            LIMIT 1
        `,
    )
        .bind(input.workspaceId, input.idempotencyKey)
        .first<UsageEventIdRow>()
    return row?.id ?? null
}

export async function readHostedProviderUsageSettlementByIdempotencyKey(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    idempotencyKey: string
}): Promise<ProviderUsageSettlementRow | null> {
    const row = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT
                id,
                room_id AS roomId,
                session_key AS sessionKey,
                run_id AS runId,
                job_id AS jobId,
                provider,
                model,
                cost_micros AS costMicros,
                billing_status AS billingStatus,
                billing_ledger_entry_id AS billingLedgerEntryId
            FROM hosted_usage_event
            WHERE workspace_id = ?1
              AND idempotency_key = ?2
              AND kind = 'provider'
              AND provider IN ('openrouter', 'brave')
            LIMIT 1
        `,
    )
        .bind(input.workspaceId, input.idempotencyKey)
        .first<ProviderUsageSettlementRow>()
    return row ?? null
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
              AND billing_status IN ('pending', 'debited', 'blocked')
            ORDER BY created_at DESC
            LIMIT ?2
        `,
    )
        .bind(input.workspaceId, input.limit)
        .all<BillableUsageRow>()
    return result.results.map(mapUsage)
}

export async function markHostedUsageBillingBlocked(input: {
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
