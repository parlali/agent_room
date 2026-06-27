import type { RoomOnboardingRecord, UsageEventRecord } from '#/domain/domain-types'
import type { AgentRoomHostedEnv } from './bindings'
import type { HostedActor } from './hosted-auth'
import { nowIso, parseJsonValue, toDate } from './hosted-json'

export async function readHostedRoomOnboarding(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
}): Promise<RoomOnboardingRecord | null> {
    const row = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT
                room_id AS roomId,
                status,
                session_key AS sessionKey,
                created_at AS createdAt,
                updated_at AS updatedAt,
                completed_at AS completedAt,
                deferred_at AS deferredAt
            FROM hosted_room_onboarding
            WHERE workspace_id = ?1
              AND room_id = ?2
        `,
    )
        .bind(input.workspaceId, input.roomId)
        .first<HostedOnboardingRow>()
    return row
        ? {
              roomId: row.roomId,
              status: row.status as RoomOnboardingRecord['status'],
              sessionKey: row.sessionKey,
              createdAt: new Date(row.createdAt),
              updatedAt: new Date(row.updatedAt),
              completedAt: toDate(row.completedAt),
              deferredAt: toDate(row.deferredAt),
          }
        : null
}

export async function getHostedSessionComposerDraft(input: {
    env: AgentRoomHostedEnv
    actor: HostedActor
    authSessionId: string
    roomId: string
    sessionKey: string
}): Promise<{ draft: string; updatedAt: number | null }> {
    const row = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT draft, updated_at AS updatedAt
            FROM hosted_session_composer_draft
            WHERE workspace_id = ?1
              AND auth_session_id = ?2
              AND room_id = ?3
              AND session_key = ?4
        `,
    )
        .bind(input.actor.workspaceId, input.authSessionId, input.roomId, input.sessionKey)
        .first<{ draft: string; updatedAt: string }>()
    return {
        draft: row?.draft ?? '',
        updatedAt: row ? new Date(row.updatedAt).getTime() : null,
    }
}

export async function saveHostedSessionComposerDraft(input: {
    env: AgentRoomHostedEnv
    actor: HostedActor
    authSessionId: string
    roomId: string
    sessionKey: string
    draft: string
}): Promise<{ draft: string; updatedAt: number | null }> {
    const now = nowIso()
    await input.env.AGENT_ROOM_DB.prepare(
        `
            INSERT INTO hosted_session_composer_draft (
                workspace_id,
                auth_session_id,
                room_id,
                session_key,
                draft,
                created_at,
                updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
            ON CONFLICT(workspace_id, auth_session_id, room_id, session_key) DO UPDATE SET
                draft = excluded.draft,
                updated_at = excluded.updated_at
        `,
    )
        .bind(
            input.actor.workspaceId,
            input.authSessionId,
            input.roomId,
            input.sessionKey,
            input.draft,
            now,
        )
        .run()
    return {
        draft: input.draft,
        updatedAt: new Date(now).getTime(),
    }
}

export async function clearHostedSessionCompletedBadge(input: {
    env: AgentRoomHostedEnv
    actor: HostedActor
    roomId: string
    sessionKey: string
}): Promise<void> {
    const now = nowIso()
    await input.env.AGENT_ROOM_DB.prepare(
        `
            INSERT INTO hosted_room_session_badge (
                workspace_id,
                user_id,
                room_id,
                session_key,
                completed_cleared_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5)
            ON CONFLICT(workspace_id, user_id, room_id, session_key) DO UPDATE SET
                completed_cleared_at = excluded.completed_cleared_at
        `,
    )
        .bind(input.actor.workspaceId, input.actor.userId, input.roomId, input.sessionKey, now)
        .run()
}

export async function listHostedUsage(input: {
    env: AgentRoomHostedEnv
    actor: HostedActor
    limit: number
    roomId?: string | null
}): Promise<{
    events: UsageEventRecord[]
    totals: {
        eventCount: number
        durationMs: number | null
        totalTokens: number | null
        estimatedCostUsd: number | null
        unknownTokenEvents: number
    }
}> {
    const whereRoom = input.roomId ? 'AND room_id = ?2' : ''
    const limitIndex = input.roomId ? 3 : 2
    const query = `
        SELECT
            id,
            room_id AS roomId,
            session_key AS sessionKey,
            run_id AS runId,
            job_id AS jobId,
            kind,
            provider,
            model,
            tool_name AS toolName,
            input_tokens AS inputTokens,
            output_tokens AS outputTokens,
            cached_tokens AS cachedTokens,
            reasoning_tokens AS reasoningTokens,
            total_tokens AS totalTokens,
            duration_ms AS durationMs,
            active_duration_ms AS activeDurationMs,
            idle_duration_ms AS idleDurationMs,
            estimated_cost_usd AS estimatedCostUsd,
            metadata,
            created_at AS createdAt
        FROM hosted_usage_event
        WHERE workspace_id = ?1
          ${whereRoom}
        ORDER BY created_at DESC
        LIMIT ?${limitIndex}
    `
    const statement = input.roomId
        ? input.env.AGENT_ROOM_DB.prepare(query).bind(
              input.actor.workspaceId,
              input.roomId,
              input.limit,
          )
        : input.env.AGENT_ROOM_DB.prepare(query).bind(input.actor.workspaceId, input.limit)
    const totalsQuery = `
        SELECT
            COUNT(*) AS eventCount,
            SUM(duration_ms) AS durationMs,
            SUM(total_tokens) AS totalTokens,
            SUM(CAST(estimated_cost_usd AS REAL)) AS estimatedCostUsd,
            SUM(CASE WHEN total_tokens IS NULL THEN 1 ELSE 0 END) AS unknownTokenEvents
        FROM hosted_usage_event
        WHERE workspace_id = ?1
          ${whereRoom}
    `
    const totalsStatement = input.roomId
        ? input.env.AGENT_ROOM_DB.prepare(totalsQuery).bind(input.actor.workspaceId, input.roomId)
        : input.env.AGENT_ROOM_DB.prepare(totalsQuery).bind(input.actor.workspaceId)
    const rows = await statement.all<HostedUsageRow>()
    const totals = await totalsStatement.first<HostedUsageTotalsRow>()
    const events = rows.results.map(mapUsageEvent)
    return {
        events,
        totals: {
            eventCount: Number(totals?.eventCount ?? 0),
            durationMs: nullableNumber(totals?.durationMs),
            totalTokens: nullableNumber(totals?.totalTokens),
            estimatedCostUsd: nullableNumber(totals?.estimatedCostUsd),
            unknownTokenEvents: Number(totals?.unknownTokenEvents ?? 0),
        },
    }
}

function nullableNumber(value: unknown): number | null {
    if (value === null || value === undefined) {
        return null
    }
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : null
}

function mapUsageEvent(row: HostedUsageRow): UsageEventRecord {
    return {
        id: row.id,
        roomId: row.roomId,
        sessionKey: row.sessionKey,
        runId: row.runId,
        jobId: row.jobId,
        kind: row.kind as UsageEventRecord['kind'],
        provider: row.provider,
        model: row.model,
        toolName: row.toolName,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        cachedTokens: row.cachedTokens,
        reasoningTokens: row.reasoningTokens,
        totalTokens: row.totalTokens,
        durationMs: row.durationMs,
        activeDurationMs: row.activeDurationMs,
        idleDurationMs: row.idleDurationMs,
        estimatedCostUsd: row.estimatedCostUsd,
        metadata: parseJsonValue(row.metadata, {}),
        createdAt: new Date(row.createdAt),
    }
}

interface HostedOnboardingRow {
    roomId: string
    status: string
    sessionKey: string | null
    createdAt: string
    updatedAt: string
    completedAt: string | null
    deferredAt: string | null
}

interface HostedUsageRow {
    id: string
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
    reasoningTokens: number | null
    totalTokens: number | null
    durationMs: number | null
    activeDurationMs: number | null
    idleDurationMs: number | null
    estimatedCostUsd: string | null
    metadata: string
    createdAt: string
}

interface HostedUsageTotalsRow {
    eventCount: number
    durationMs: number | string | null
    totalTokens: number | null
    estimatedCostUsd: number | null
    unknownTokenEvents: number | null
}
