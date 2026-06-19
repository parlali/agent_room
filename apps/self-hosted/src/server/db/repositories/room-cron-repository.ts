import { and, asc, desc, eq, isNotNull, isNull, lte, or, sql } from 'drizzle-orm'
import type { JsonValue, RoomCronJobRecord, RoomCronRunRecord } from '#/domain/domain-types'
import { roomCronJobs, roomCronRuns } from '../schema'
import { mapRoomCronJob, mapRoomCronRun } from './row-mappers'
import {
    computeLeaseUntil,
    createDatabaseId,
    nowDate,
    repositoryBatch,
    repositoryDatabase,
} from './repository-utils'

function mapRequiredRoomCronJob(
    row: typeof roomCronJobs.$inferSelect | undefined,
    jobId: string,
): RoomCronJobRecord {
    if (!row) {
        throw new Error(`Cron job ${jobId} does not exist`)
    }
    return mapRoomCronJob(row)
}

function claimableAt(now: Date) {
    return or(
        isNull(roomCronJobs.runningAt),
        isNull(roomCronJobs.lockedUntil),
        lte(roomCronJobs.lockedUntil, now),
    )
}

function recoveryReasonFor(job: typeof roomCronJobs.$inferSelect, now: Date): string | null {
    if (job.runningAt && (!job.lockedUntil || job.lockedUntil <= now)) {
        return 'expired_lease'
    }
    return null
}

export const roomCronRepository = {
    async listJobsByRoomId(roomId: string): Promise<RoomCronJobRecord[]> {
        const db = await repositoryDatabase()
        const rows = await db
            .select()
            .from(roomCronJobs)
            .where(eq(roomCronJobs.roomId, roomId))
            .orderBy(desc(roomCronJobs.createdAt))
        return rows.map(mapRoomCronJob)
    },

    async findJobById(input: { roomId: string; jobId: string }): Promise<RoomCronJobRecord | null> {
        const db = await repositoryDatabase()
        const [row] = await db
            .select()
            .from(roomCronJobs)
            .where(and(eq(roomCronJobs.roomId, input.roomId), eq(roomCronJobs.id, input.jobId)))
            .limit(1)
        return row ? mapRoomCronJob(row) : null
    },

    async createJob(input: {
        roomId: string
        name: string
        message: string
        everyMinutes: number
        schedule: JsonValue
        timezone: string
        nextRunAt: Date
        provider: string | null
        model: string | null
        configVersion: number | null
    }): Promise<RoomCronJobRecord> {
        const db = await repositoryDatabase()
        const now = nowDate()
        const [row] = await db
            .insert(roomCronJobs)
            .values({
                id: createDatabaseId(),
                roomId: input.roomId,
                name: input.name,
                message: input.message,
                everyMinutes: input.everyMinutes,
                schedule: input.schedule,
                timezone: input.timezone,
                nextRunAt: input.nextRunAt,
                provider: input.provider,
                model: input.model,
                configVersion: input.configVersion,
                createdAt: now,
                updatedAt: now,
            })
            .returning()
        return mapRoomCronJob(row)
    },

    async setJobEnabled(input: {
        roomId: string
        jobId: string
        enabled: boolean
        nextRunAt: Date | null
    }): Promise<RoomCronJobRecord> {
        const db = await repositoryDatabase()
        const [row] = await db
            .update(roomCronJobs)
            .set({
                enabled: input.enabled,
                nextRunAt: input.nextRunAt,
                updatedAt: nowDate(),
            })
            .where(and(eq(roomCronJobs.roomId, input.roomId), eq(roomCronJobs.id, input.jobId)))
            .returning()
        return mapRequiredRoomCronJob(row, input.jobId)
    },

    async updateJob(input: {
        roomId: string
        jobId: string
        name: string
        message: string
        everyMinutes: number
        schedule: JsonValue
        nextRunAt: Date | null
        provider: string | null
        model: string | null
        configVersion: number | null
    }): Promise<RoomCronJobRecord> {
        const db = await repositoryDatabase()
        const [row] = await db
            .update(roomCronJobs)
            .set({
                name: input.name,
                message: input.message,
                everyMinutes: input.everyMinutes,
                schedule: input.schedule,
                nextRunAt: input.nextRunAt,
                provider: input.provider,
                model: input.model,
                configVersion: input.configVersion,
                updatedAt: nowDate(),
            })
            .where(and(eq(roomCronJobs.roomId, input.roomId), eq(roomCronJobs.id, input.jobId)))
            .returning()
        return mapRequiredRoomCronJob(row, input.jobId)
    },

    async removeJob(input: { roomId: string; jobId: string }): Promise<boolean> {
        const db = await repositoryDatabase()
        const rows = await db
            .delete(roomCronJobs)
            .where(and(eq(roomCronJobs.roomId, input.roomId), eq(roomCronJobs.id, input.jobId)))
            .returning({ id: roomCronJobs.id })
        return rows.length > 0
    },

    async claimJob(input: {
        roomId: string
        jobId: string
        lockToken: string
        runBudgetMs: number
        maxStaleLockMs: number
    }): Promise<RoomCronJobRecord | null> {
        const db = await repositoryDatabase()
        const now = nowDate()
        const [job] = await db
            .select()
            .from(roomCronJobs)
            .where(and(eq(roomCronJobs.roomId, input.roomId), eq(roomCronJobs.id, input.jobId)))
            .limit(1)
        if (!job) {
            return null
        }

        const [row] = await db
            .update(roomCronJobs)
            .set({
                runningAt: now,
                heartbeatAt: now,
                lockedUntil: computeLeaseUntil({
                    now,
                    everyMinutes: job.everyMinutes,
                    runBudgetMs: input.runBudgetMs,
                    maxStaleLockMs: input.maxStaleLockMs,
                }),
                lockToken: input.lockToken,
                lastRenewedAt: now,
                runBudgetMs: input.runBudgetMs,
                recoveryReason: recoveryReasonFor(job, now),
                lastRunAt: now,
                lastRunStatus: 'running',
                lastError: null,
                updatedAt: now,
            })
            .where(
                and(
                    eq(roomCronJobs.roomId, input.roomId),
                    eq(roomCronJobs.id, input.jobId),
                    claimableAt(now),
                ),
            )
            .returning()
        return row ? mapRoomCronJob(row) : null
    },

    async claimDueJobs(input: {
        lockToken: string
        runBudgetMs: number
        maxStaleLockMs: number
        limit: number
    }): Promise<RoomCronJobRecord[]> {
        if (input.limit <= 0) {
            return []
        }

        const db = await repositoryDatabase()
        const now = nowDate()
        const dueJobs = await db
            .select()
            .from(roomCronJobs)
            .where(
                and(
                    eq(roomCronJobs.enabled, true),
                    isNotNull(roomCronJobs.nextRunAt),
                    lte(roomCronJobs.nextRunAt, now),
                    claimableAt(now),
                ),
            )
            .orderBy(asc(roomCronJobs.nextRunAt))
            .limit(input.limit)

        if (dueJobs.length === 0) {
            return []
        }

        const results = await repositoryBatch(
            dueJobs.map((job) =>
                db
                    .update(roomCronJobs)
                    .set({
                        runningAt: now,
                        heartbeatAt: now,
                        lockedUntil: computeLeaseUntil({
                            now,
                            everyMinutes: job.everyMinutes,
                            runBudgetMs: input.runBudgetMs,
                            maxStaleLockMs: input.maxStaleLockMs,
                        }),
                        lockToken: input.lockToken,
                        lastRenewedAt: now,
                        runBudgetMs: input.runBudgetMs,
                        recoveryReason: recoveryReasonFor(job, now),
                        lastRunAt: now,
                        lastRunStatus: 'running',
                        lastError: null,
                        updatedAt: now,
                    })
                    .where(
                        and(
                            eq(roomCronJobs.id, job.id),
                            eq(roomCronJobs.enabled, true),
                            isNotNull(roomCronJobs.nextRunAt),
                            lte(roomCronJobs.nextRunAt, now),
                            claimableAt(now),
                        ),
                    )
                    .returning(),
            ),
        )

        return results
            .flatMap((result) => result as Array<typeof roomCronJobs.$inferSelect>)
            .map(mapRoomCronJob)
    },

    async renewJobLease(input: {
        roomId: string
        jobId: string
        lockToken: string
        lockedUntil: Date
    }): Promise<RoomCronJobRecord | null> {
        const db = await repositoryDatabase()
        const now = nowDate()
        const [row] = await db
            .update(roomCronJobs)
            .set({
                heartbeatAt: now,
                lastRenewedAt: now,
                lockedUntil: input.lockedUntil,
                updatedAt: now,
            })
            .where(
                and(
                    eq(roomCronJobs.roomId, input.roomId),
                    eq(roomCronJobs.id, input.jobId),
                    eq(roomCronJobs.lockToken, input.lockToken),
                    isNotNull(roomCronJobs.runningAt),
                ),
            )
            .returning()
        return row ? mapRoomCronJob(row) : null
    },

    async finishJob(input: {
        roomId: string
        jobId: string
        lockToken: string | null
        status: 'complete' | 'failed' | 'skipped'
        error: string | null
        durationMs: number
        nextRunAt: Date | null
    }): Promise<RoomCronJobRecord | null> {
        const db = await repositoryDatabase()
        const lockCondition = input.lockToken
            ? eq(roomCronJobs.lockToken, input.lockToken)
            : undefined
        const [row] = await db
            .update(roomCronJobs)
            .set({
                runningAt: null,
                heartbeatAt: null,
                lockedUntil: null,
                lockToken: null,
                lastRenewedAt: null,
                nextRunAt: input.nextRunAt,
                lastRunStatus: input.status,
                lastError: input.error,
                lastDurationMs: input.durationMs,
                updatedAt: nowDate(),
            })
            .where(
                and(
                    eq(roomCronJobs.roomId, input.roomId),
                    eq(roomCronJobs.id, input.jobId),
                    lockCondition,
                ),
            )
            .returning()
        return row ? mapRoomCronJob(row) : null
    },

    async createRun(input: {
        roomId: string
        jobId: string | null
        jobName: string | null
        status: 'running' | 'complete' | 'failed' | 'skipped'
        summary: string | null
        error: string | null
        sessionKey: string | null
        sessionId: string | null
        provider: string | null
        model: string | null
        configVersion: number | null
    }): Promise<RoomCronRunRecord> {
        const db = await repositoryDatabase()
        const [row] = await db
            .insert(roomCronRuns)
            .values({
                id: createDatabaseId(),
                roomId: input.roomId,
                jobId: input.jobId,
                jobName: input.jobName,
                status: input.status,
                summary: input.summary,
                error: input.error,
                sessionKey: input.sessionKey,
                sessionId: input.sessionId,
                provider: input.provider,
                model: input.model,
                configVersion: input.configVersion,
                startedAt: nowDate(),
            })
            .returning()
        return mapRoomCronRun(row)
    },

    async finishRun(input: {
        runId: string
        status: 'complete' | 'failed' | 'skipped'
        error: string | null
        nextRunAt: Date | null
    }): Promise<RoomCronRunRecord> {
        const db = await repositoryDatabase()
        const now = nowDate()
        const [row] = await db
            .update(roomCronRuns)
            .set({
                status: input.status,
                error: input.error,
                finishedAt: now,
                durationMs: sql<number>`max(0, ${now.getTime()} - ${roomCronRuns.startedAt})`,
                nextRunAt: input.nextRunAt,
            })
            .where(eq(roomCronRuns.id, input.runId))
            .returning()
        if (!row) {
            throw new Error(`Cron run ${input.runId} does not exist`)
        }
        return mapRoomCronRun(row)
    },

    async listRunsByRoomId(input: { roomId: string; limit: number }): Promise<RoomCronRunRecord[]> {
        const db = await repositoryDatabase()
        const rows = await db
            .select()
            .from(roomCronRuns)
            .where(eq(roomCronRuns.roomId, input.roomId))
            .orderBy(desc(roomCronRuns.startedAt))
            .limit(input.limit)
        return rows.map(mapRoomCronRun)
    },

    async deleteAllByRoomId(roomId: string): Promise<void> {
        const db = await repositoryDatabase()
        await repositoryBatch([
            db.delete(roomCronRuns).where(eq(roomCronRuns.roomId, roomId)),
            db.delete(roomCronJobs).where(eq(roomCronJobs.roomId, roomId)),
        ])
    },
}
