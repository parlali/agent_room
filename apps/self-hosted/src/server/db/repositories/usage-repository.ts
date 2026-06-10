import type { JsonValue, UsageEventKind, UsageEventRecord } from '#/domain/domain-types'
import { sql } from '../client'
import { mapUsageEvent } from './row-mappers'

export const usageRepository = {
    async appendEvent(input: {
        roomId: string | null
        sessionKey: string | null
        runId: string | null
        jobId: string | null
        kind: UsageEventKind
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
        estimatedCostUsd: number | null
        metadata: JsonValue
    }): Promise<UsageEventRecord> {
        const rows = await sql`
            INSERT INTO usage_events (
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
                metadata
            )
            VALUES (
                ${input.roomId},
                ${input.sessionKey},
                ${input.runId},
                ${input.jobId},
                ${input.kind},
                ${input.provider},
                ${input.model},
                ${input.toolName},
                ${input.inputTokens},
                ${input.outputTokens},
                ${input.cachedTokens},
                ${input.reasoningTokens},
                ${input.totalTokens},
                ${input.durationMs},
                ${input.activeDurationMs},
                ${input.idleDurationMs},
                ${input.estimatedCostUsd},
                ${sql.json(input.metadata)}
            )
            RETURNING *
        `
        return mapUsageEvent(rows[0] as Record<string, unknown>)
    },

    async listByRoom(input: { roomId: string; limit: number }): Promise<UsageEventRecord[]> {
        const rows = await sql`
            SELECT *
            FROM usage_events
            WHERE room_id = ${input.roomId}
            ORDER BY created_at DESC
            LIMIT ${input.limit}
        `
        return rows.map((row) => mapUsageEvent(row as Record<string, unknown>))
    },

    async listRecent(input: { limit: number }): Promise<UsageEventRecord[]> {
        const rows = await sql`
            SELECT *
            FROM usage_events
            ORDER BY created_at DESC
            LIMIT ${input.limit}
        `
        return rows.map((row) => mapUsageEvent(row as Record<string, unknown>))
    },

    async summarizeByRoom(input: { roomId: string }): Promise<{
        eventCount: number
        durationMs: number | null
        totalTokens: number | null
        estimatedCostUsd: number | null
        unknownTokenEvents: number
    }> {
        const rows = await sql`
            SELECT
                COUNT(*)::int AS event_count,
                SUM(duration_ms)::bigint AS duration_ms,
                SUM(total_tokens)::bigint AS total_tokens,
                SUM(estimated_cost_usd)::numeric AS estimated_cost_usd,
                COUNT(*) FILTER (WHERE total_tokens IS NULL)::int AS unknown_token_events
            FROM usage_events
            WHERE room_id = ${input.roomId}
        `
        const row = rows[0] as Record<string, unknown>
        return {
            eventCount: Number(row.event_count ?? 0),
            durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
            totalTokens: row.total_tokens === null ? null : Number(row.total_tokens),
            estimatedCostUsd:
                row.estimated_cost_usd === null ? null : Number(row.estimated_cost_usd),
            unknownTokenEvents: Number(row.unknown_token_events ?? 0),
        }
    },

    async summarizeAll(): Promise<{
        eventCount: number
        durationMs: number | null
        totalTokens: number | null
        estimatedCostUsd: number | null
        unknownTokenEvents: number
    }> {
        const rows = await sql`
            SELECT
                COUNT(*)::int AS event_count,
                SUM(duration_ms)::bigint AS duration_ms,
                SUM(total_tokens)::bigint AS total_tokens,
                SUM(estimated_cost_usd)::numeric AS estimated_cost_usd,
                COUNT(*) FILTER (WHERE total_tokens IS NULL)::int AS unknown_token_events
            FROM usage_events
        `
        const row = rows[0] as Record<string, unknown>
        return {
            eventCount: Number(row.event_count ?? 0),
            durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
            totalTokens: row.total_tokens === null ? null : Number(row.total_tokens),
            estimatedCostUsd:
                row.estimated_cost_usd === null ? null : Number(row.estimated_cost_usd),
            unknownTokenEvents: Number(row.unknown_token_events ?? 0),
        }
    },

    async attachJobToRun(input: { roomId: string; runId: string; jobId: string }): Promise<number> {
        const rows = await sql`
            UPDATE usage_events
            SET job_id = ${input.jobId}
            WHERE room_id = ${input.roomId}
                AND run_id = ${input.runId}
                AND job_id IS NULL
            RETURNING id
        `
        return rows.length
    },
}
