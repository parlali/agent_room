import { count, desc, eq, inArray, sql, sum } from 'drizzle-orm'
import type { JsonValue, UsageEventKind, UsageEventRecord } from '#/domain/domain-types'
import { usageEvents } from '../schema'
import { mapUsageEvent } from './row-mappers'
import { createDatabaseId, nowDate, repositoryDatabase } from './repository-utils'

function mapSummary(row: {
    eventCount: number
    durationMs: string | null
    totalTokens: string | null
    estimatedCostUsd: number | null
    unknownTokenEvents: number | null
}) {
    return {
        eventCount: row.eventCount,
        durationMs: row.durationMs === null ? null : Number(row.durationMs),
        totalTokens: row.totalTokens === null ? null : Number(row.totalTokens),
        estimatedCostUsd: row.estimatedCostUsd === null ? null : Number(row.estimatedCostUsd),
        unknownTokenEvents: Number(row.unknownTokenEvents ?? 0),
    }
}

function emptySummary() {
    return {
        eventCount: 0,
        durationMs: null,
        totalTokens: null,
        estimatedCostUsd: null,
        unknownTokenEvents: 0,
    }
}

const summarySelection = {
    eventCount: count(),
    durationMs: sum(usageEvents.durationMs),
    totalTokens: sum(usageEvents.totalTokens),
    estimatedCostUsd: sql<number | null>`sum(cast(${usageEvents.estimatedCostUsd} as real))`,
    unknownTokenEvents: sql<number>`sum(case when ${usageEvents.totalTokens} is null then 1 else 0 end)`,
}

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
        const db = await repositoryDatabase()
        const [row] = await db
            .insert(usageEvents)
            .values({
                id: createDatabaseId(),
                roomId: input.roomId,
                sessionKey: input.sessionKey,
                runId: input.runId,
                jobId: input.jobId,
                kind: input.kind,
                provider: input.provider,
                model: input.model,
                toolName: input.toolName,
                inputTokens: input.inputTokens,
                outputTokens: input.outputTokens,
                cachedTokens: input.cachedTokens,
                reasoningTokens: input.reasoningTokens,
                totalTokens: input.totalTokens,
                durationMs: input.durationMs,
                activeDurationMs: input.activeDurationMs,
                idleDurationMs: input.idleDurationMs,
                estimatedCostUsd:
                    input.estimatedCostUsd === null ? null : String(input.estimatedCostUsd),
                metadata: input.metadata,
                createdAt: nowDate(),
            })
            .returning()
        return mapUsageEvent(row)
    },

    async listByRoom(input: { roomId: string; limit: number }): Promise<UsageEventRecord[]> {
        const db = await repositoryDatabase()
        const rows = await db
            .select()
            .from(usageEvents)
            .where(eq(usageEvents.roomId, input.roomId))
            .orderBy(desc(usageEvents.createdAt))
            .limit(input.limit)
        return rows.map(mapUsageEvent)
    },

    async listRecent(input: { limit: number }): Promise<UsageEventRecord[]> {
        const db = await repositoryDatabase()
        const rows = await db
            .select()
            .from(usageEvents)
            .orderBy(desc(usageEvents.createdAt))
            .limit(input.limit)
        return rows.map(mapUsageEvent)
    },

    async listRecentByRooms(input: {
        roomIds: string[]
        limit: number
    }): Promise<UsageEventRecord[]> {
        if (input.roomIds.length === 0) {
            return []
        }
        const db = await repositoryDatabase()
        const rows = await db
            .select()
            .from(usageEvents)
            .where(inArray(usageEvents.roomId, input.roomIds))
            .orderBy(desc(usageEvents.createdAt))
            .limit(input.limit)
        return rows.map(mapUsageEvent)
    },

    async summarizeByRoom(input: { roomId: string }): Promise<{
        eventCount: number
        durationMs: number | null
        totalTokens: number | null
        estimatedCostUsd: number | null
        unknownTokenEvents: number
    }> {
        const db = await repositoryDatabase()
        const [row] = await db
            .select(summarySelection)
            .from(usageEvents)
            .where(eq(usageEvents.roomId, input.roomId))
        return mapSummary(row)
    },

    async summarizeAll(): Promise<{
        eventCount: number
        durationMs: number | null
        totalTokens: number | null
        estimatedCostUsd: number | null
        unknownTokenEvents: number
    }> {
        const db = await repositoryDatabase()
        const [row] = await db.select(summarySelection).from(usageEvents)
        return mapSummary(row)
    },

    async summarizeByRooms(input: { roomIds: string[] }): Promise<{
        eventCount: number
        durationMs: number | null
        totalTokens: number | null
        estimatedCostUsd: number | null
        unknownTokenEvents: number
    }> {
        if (input.roomIds.length === 0) {
            return emptySummary()
        }
        const db = await repositoryDatabase()
        const [row] = await db
            .select(summarySelection)
            .from(usageEvents)
            .where(inArray(usageEvents.roomId, input.roomIds))
        return mapSummary(row)
    },
}
