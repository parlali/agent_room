import { createServerFn } from '@tanstack/react-start'
import { setResponseHeaders } from '@tanstack/react-start/server'
import { z } from 'zod'

import type { UsageEventRecord } from '#/domain/domain-types'

const listJobUsageInputSchema = z.object({
    roomId: z.string().uuid(),
    jobId: z.string().min(1),
    limit: z.number().int().positive().max(100).optional(),
})

export interface ScheduledTaskUsageTotals {
    eventCount: number
    runCount: number
    durationMs: number | null
    totalTokens: number | null
    estimatedCostUsd: number | null
    unknownTokenEvents: number
}

export interface ScheduledTaskUsage {
    jobId: string
    events: UsageEventRecord[]
    totals: ScheduledTaskUsageTotals
    windowed: boolean
}

function aggregateEvents(events: UsageEventRecord[]): ScheduledTaskUsageTotals {
    const runIds = new Set<string>()
    let durationMs = 0
    let hasDuration = false
    let totalTokens = 0
    let hasTokens = false
    let estimatedCostUsd = 0
    let hasCost = false
    let unknownTokenEvents = 0
    for (const event of events) {
        if (event.runId !== null) runIds.add(event.runId)
        if (event.durationMs !== null) {
            durationMs += event.durationMs
            hasDuration = true
        }
        if (event.totalTokens !== null) {
            totalTokens += event.totalTokens
            hasTokens = true
        } else {
            unknownTokenEvents += 1
        }
        if (event.estimatedCostUsd !== null) {
            estimatedCostUsd += Number(event.estimatedCostUsd)
            hasCost = true
        }
    }
    return {
        eventCount: events.length,
        runCount: runIds.size,
        durationMs: hasDuration ? durationMs : null,
        totalTokens: hasTokens ? totalTokens : null,
        estimatedCostUsd: hasCost ? estimatedCostUsd : null,
        unknownTokenEvents,
    }
}

export const listJobUsageServer = createServerFn({ method: 'GET' })
    .inputValidator((input: unknown) => listJobUsageInputSchema.parse(input))
    .handler(async ({ data }): Promise<ScheduledTaskUsage> => {
        setResponseHeaders({
            'cache-control': 'no-store',
        })
        const limit = data.limit ?? 50
        const { requireAuthenticatedActor, requireRoomOwner } =
            await import('#/server/rooms/room-runtime-route-service')
        const { requireHostedActor } = await import('#/server/cloudflare/hosted-route-auth')
        const hosted = await requireHostedActor()
        if (hosted) {
            await requireRoomOwner(hosted.actor, data.roomId)
            const { listHostedUsage } =
                await import('#/server/cloudflare/hosted-room-read-model-service')
            const usage = await listHostedUsage({
                env: hosted.context.env,
                actor: hosted.actor,
                roomId: data.roomId,
                limit: 1000,
            })
            const jobEvents = usage.events.filter((event) => event.jobId === data.jobId)
            return {
                jobId: data.jobId,
                events: jobEvents.slice(0, limit),
                totals: aggregateEvents(jobEvents),
                windowed: usage.events.length >= 1000,
            }
        }
        const actor = await requireAuthenticatedActor()
        await requireRoomOwner(actor, data.roomId)
        const { syncRoomRuntimeUsage } = await import('#/server/rooms/execution-engine')
        await syncRoomRuntimeUsage(data.roomId)
        const { and, count, desc, eq, sql, sum } = await import('drizzle-orm')
        const { usageEvents } = await import('#/server/db/schema')
        const { mapUsageEvent } = await import('#/server/db/repositories/row-mappers')
        const { repositoryDatabase } = await import('#/server/db/repositories/repository-utils')
        const db = await repositoryDatabase()
        const where = and(eq(usageEvents.roomId, data.roomId), eq(usageEvents.jobId, data.jobId))
        const rows = await db
            .select()
            .from(usageEvents)
            .where(where)
            .orderBy(desc(usageEvents.createdAt))
            .limit(limit)
        const [summary] = await db
            .select({
                eventCount: count(),
                runCount: sql<number>`count(distinct ${usageEvents.runId})`,
                durationMs: sum(usageEvents.durationMs),
                totalTokens: sum(usageEvents.totalTokens),
                estimatedCostUsd: sql<
                    number | null
                >`sum(cast(${usageEvents.estimatedCostUsd} as real))`,
                unknownTokenEvents: sql<number>`sum(case when ${usageEvents.totalTokens} is null then 1 else 0 end)`,
            })
            .from(usageEvents)
            .where(where)
        return {
            jobId: data.jobId,
            events: rows.map(mapUsageEvent),
            totals: {
                eventCount: Number(summary?.eventCount ?? 0),
                runCount: Number(summary?.runCount ?? 0),
                durationMs: summary?.durationMs === null ? null : Number(summary?.durationMs),
                totalTokens: summary?.totalTokens === null ? null : Number(summary?.totalTokens),
                estimatedCostUsd:
                    summary?.estimatedCostUsd === null ? null : Number(summary?.estimatedCostUsd),
                unknownTokenEvents: Number(summary?.unknownTokenEvents ?? 0),
            },
            windowed: false,
        }
    })
