import { randomUUID } from 'node:crypto'

import { normalizeBudgets } from '../../configuration/capabilities'
import { getRoomConfigSnapshot } from '../../configuration/operator-configuration'
import { roomCronRepository, roomRuntimeMetadataRepository } from '../../db/repositories'
import type { RoomCronJobRecord, RoomCronRunRecord } from '#/domain/domain-types'
import type { RoomCronJob, RoomRunHistorySnapshot } from '../execution-types'

import { createRoomThread, sendRoomThreadMessage } from './thread-operations'
import {
    computeNextRunAt,
    describeJobSchedule,
    intervalMinutes,
    normalizeJobSchedule,
    type JobSchedule,
} from '#/domain/job-schedule'

const maxCronStaleLockMs = 12 * 60 * 60 * 1000
const cronLeaseRenewalMs = 30000

export async function listRoomCronJobs(input: {
    roomId: string
    limit?: number
}): Promise<RoomCronJob[]> {
    const limit =
        input.limit && Number.isFinite(input.limit) ? Math.max(1, Math.floor(input.limit)) : 200
    const jobs = await roomCronRepository.listJobsByRoomId(input.roomId)
    return jobs.slice(0, limit).map(mapCronJobRecord)
}

async function prepareCronJobWrite(input: {
    roomId: string
    name: string
    message: string
    schedule: JobSchedule
}) {
    const name = input.name.trim()
    if (!name) {
        throw new Error('Cron job name cannot be empty')
    }

    const message = input.message.trim()
    if (!message) {
        throw new Error('Cron job message cannot be empty')
    }

    const schedule = normalizeJobSchedule(input.schedule)
    const everyMinutes = intervalMinutes(schedule)

    const [config, runtimeMetadata] = await Promise.all([
        getRoomConfigSnapshot(input.roomId),
        roomRuntimeMetadataRepository.findByRoomId(input.roomId),
    ])
    return {
        name,
        message,
        schedule,
        everyMinutes,
        config,
        runtimeMetadata,
    }
}

export async function createRoomCronJob(input: {
    roomId: string
    name: string
    message: string
    schedule: JobSchedule
}): Promise<RoomCronJob> {
    const { name, message, schedule, everyMinutes, config, runtimeMetadata } =
        await prepareCronJobWrite(input)
    const job = await roomCronRepository.createJob({
        roomId: input.roomId,
        name,
        message,
        everyMinutes,
        schedule,
        timezone: config.config.cronTimezone,
        nextRunAt: computeNextRunAt({
            schedule,
            after: new Date(),
            timezone: config.config.cronTimezone,
        }),
        provider: config.effective.provider,
        model: config.effective.model,
        configVersion: runtimeMetadata?.configVersion ?? null,
    })
    return mapCronJobRecord(job)
}

export async function updateRoomCronJob(input: {
    roomId: string
    jobId: string
    name: string
    message: string
    schedule: JobSchedule
}): Promise<RoomCronJob> {
    const existing = await roomCronRepository.findJobById({
        roomId: input.roomId,
        jobId: input.jobId,
    })
    if (!existing) {
        throw new Error(`Cron job ${input.jobId} does not exist`)
    }

    const { name, message, schedule, everyMinutes, config, runtimeMetadata } =
        await prepareCronJobWrite(input)
    const job = await roomCronRepository.updateJob({
        roomId: input.roomId,
        jobId: input.jobId,
        name,
        message,
        everyMinutes,
        schedule,
        nextRunAt: existing.enabled
            ? computeNextRunAt({
                  schedule,
                  after: new Date(),
                  timezone: existing.timezone,
              })
            : null,
        provider: config.effective.provider,
        model: config.effective.model,
        configVersion: runtimeMetadata?.configVersion ?? existing.configVersion,
    })
    return mapCronJobRecord(job)
}

export async function updateRoomCronJobEnabled(input: {
    roomId: string
    jobId: string
    enabled: boolean
}): Promise<RoomCronJob> {
    const existing = await roomCronRepository.findJobById(input)
    if (!existing) {
        throw new Error(`Cron job ${input.jobId} does not exist`)
    }
    return mapCronJobRecord(
        await roomCronRepository.setJobEnabled({
            roomId: input.roomId,
            jobId: input.jobId,
            enabled: input.enabled,
            nextRunAt: input.enabled
                ? computeNextRunAt({
                      schedule: normalizeJobSchedule(existing.schedule, existing.everyMinutes),
                      after: new Date(),
                      timezone: existing.timezone,
                  })
                : null,
        }),
    )
}

function scheduledRunBudgetMs(): number {
    return normalizeBudgets().scheduledTurnMs
}

function cronLeaseMs(job: Pick<RoomCronJobRecord, 'everyMinutes' | 'runBudgetMs'>): number {
    const intervalMs = Math.max(60000, job.everyMinutes * 60000)
    const budgetMs = job.runBudgetMs ?? scheduledRunBudgetMs()
    return Math.min(maxCronStaleLockMs, Math.max(5 * 60000, Math.min(intervalMs, budgetMs + 60000)))
}

function nextCronLease(job: RoomCronJobRecord): Date {
    return new Date(Date.now() + cronLeaseMs(job))
}

async function executeClaimedCronJob(input: {
    job: RoomCronJobRecord
    lockToken: string | null
}): Promise<{ ran: boolean; reason: string | null }> {
    const startedAt = Date.now()
    const [config, runtimeMetadata] = await Promise.all([
        getRoomConfigSnapshot(input.job.roomId),
        roomRuntimeMetadataRepository.findByRoomId(input.job.roomId),
    ])
    const provider = config.effective.provider
    const model = config.effective.model
    const configVersion = runtimeMetadata?.configVersion ?? input.job.configVersion
    let run: RoomCronRunRecord | null = null
    let renewal: ReturnType<typeof setInterval> | null = null

    if (input.lockToken) {
        renewal = setInterval(() => {
            void roomCronRepository.renewJobLease({
                roomId: input.job.roomId,
                jobId: input.job.id,
                lockToken: input.lockToken!,
                lockedUntil: nextCronLease(input.job),
            })
        }, cronLeaseRenewalMs)
        renewal.unref?.()
    }

    try {
        if (!config.effective.ready) {
            throw new Error(
                `Room configuration is blocked: ${config.effective.blockedReasons.join('; ')}`,
            )
        }

        const thread = await createRoomThread({
            roomId: input.job.roomId,
        })
        run = await roomCronRepository.createRun({
            roomId: input.job.roomId,
            jobId: input.job.id,
            jobName: input.job.name,
            status: 'running',
            summary: input.job.message,
            error: null,
            sessionKey: thread.key,
            sessionId: null,
            provider,
            model,
            configVersion,
        })
        const sendResult = await sendRoomThreadMessage({
            roomId: input.job.roomId,
            sessionKey: thread.key,
            message: input.job.message,
            awaitCompletion: true,
            runKind: 'scheduled',
            jobId: input.job.id,
        })
        if (sendResult.status === 'error') {
            throw new Error(sendResult.error ?? 'Scheduled run failed in the Pi runtime')
        }

        const schedule = normalizeJobSchedule(input.job.schedule, input.job.everyMinutes)
        const nextRunAt = input.job.enabled
            ? computeNextRunAt({
                  schedule,
                  after: new Date(),
                  timezone: input.job.timezone,
              })
            : null
        await roomCronRepository.finishRun({
            runId: run.id,
            status: 'complete',
            error: null,
            nextRunAt,
        })
        await roomCronRepository.finishJob({
            roomId: input.job.roomId,
            jobId: input.job.id,
            lockToken: input.lockToken,
            status: 'complete',
            error: null,
            durationMs: Date.now() - startedAt,
            nextRunAt,
        })
        return {
            ran: true,
            reason: null,
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Scheduled run failed'
        const schedule = normalizeJobSchedule(input.job.schedule, input.job.everyMinutes)
        const nextRunAt = input.job.enabled
            ? computeNextRunAt({
                  schedule,
                  after: new Date(),
                  timezone: input.job.timezone,
              })
            : null
        if (run) {
            await roomCronRepository.finishRun({
                runId: run.id,
                status: 'failed',
                error: message,
                nextRunAt,
            })
        } else {
            await roomCronRepository.createRun({
                roomId: input.job.roomId,
                jobId: input.job.id,
                jobName: input.job.name,
                status: 'failed',
                summary: input.job.message,
                error: message,
                sessionKey: null,
                sessionId: null,
                provider,
                model,
                configVersion,
            })
        }
        await roomCronRepository.finishJob({
            roomId: input.job.roomId,
            jobId: input.job.id,
            lockToken: input.lockToken,
            status: 'failed',
            error: message,
            durationMs: Date.now() - startedAt,
            nextRunAt,
        })
        return {
            ran: false,
            reason: message,
        }
    } finally {
        if (renewal) {
            clearInterval(renewal)
        }
    }
}

export async function runRoomCronJobNow(input: {
    roomId: string
    jobId: string
}): Promise<{ ran: boolean; reason: string | null }> {
    const job = await roomCronRepository.findJobById(input)
    if (!job) {
        throw new Error(`Cron job ${input.jobId} does not exist`)
    }
    const lockToken = randomUUID()
    const claimed = await roomCronRepository.claimJob({
        roomId: input.roomId,
        jobId: input.jobId,
        lockToken,
        runBudgetMs: scheduledRunBudgetMs(),
        maxStaleLockMs: maxCronStaleLockMs,
    })
    if (!claimed) {
        return {
            ran: false,
            reason: 'Job is already running',
        }
    }
    return executeClaimedCronJob({
        job: claimed,
        lockToken,
    })
}

export async function runDueRoomCronJobs(
    input: {
        limit?: number
    } = {},
): Promise<Array<{ jobId: string; ran: boolean; reason: string | null }>> {
    const lockToken = randomUUID()
    const jobs = await roomCronRepository.claimDueJobs({
        lockToken,
        runBudgetMs: scheduledRunBudgetMs(),
        maxStaleLockMs: maxCronStaleLockMs,
        limit:
            input.limit && Number.isFinite(input.limit)
                ? Math.max(1, Math.min(25, Math.floor(input.limit)))
                : 10,
    })
    const results: Array<{ jobId: string; ran: boolean; reason: string | null }> = []
    for (const job of jobs) {
        const result = await executeClaimedCronJob({
            job,
            lockToken,
        })
        results.push({
            jobId: job.id,
            ...result,
        })
    }
    return results
}

export async function removeRoomCronJob(input: { roomId: string; jobId: string }): Promise<void> {
    const removed = await roomCronRepository.removeJob(input)
    if (!removed) {
        throw new Error(`Cron job ${input.jobId} was not removed`)
    }
}

function mapCronJobRecord(job: RoomCronJobRecord): RoomCronJob {
    const schedule = normalizeJobSchedule(job.schedule, job.everyMinutes)
    return {
        id: job.id,
        agentId: 'main',
        sessionKey: job.targetThreadKey,
        name: job.name,
        description: null,
        enabled: job.enabled,
        sessionTarget: job.sessionTarget,
        wakeMode: 'now',
        everyMinutes: job.everyMinutes,
        schedule,
        timezone: job.timezone,
        scheduleSummary: describeJobSchedule(schedule),
        payloadSummary: job.message,
        nextRunAt: job.nextRunAt ? job.nextRunAt.getTime() : null,
        runningAt: job.runningAt ? job.runningAt.getTime() : null,
        lastRunAt: job.lastRunAt ? job.lastRunAt.getTime() : null,
        lastRunStatus: job.lastRunStatus,
        lastError: job.lastError,
        lastDurationMs: job.lastDurationMs,
    }
}

function mapCronRunRecord(run: RoomCronRunRecord): RoomRunHistorySnapshot['entries'][number] {
    return {
        id: run.id,
        ts: run.startedAt.getTime(),
        jobId: run.jobId ?? '',
        jobName: run.jobName,
        status: run.status,
        summary: run.summary,
        error: run.error,
        sessionId: run.sessionId,
        sessionKey: run.sessionKey,
        declaredAgentId: 'main',
        effectiveAgentId: 'main',
        resolvedSessionAgentId: run.sessionKey ? 'main' : null,
        ownership: run.sessionKey ? 'owned' : 'unknown',
        durationMs: run.durationMs,
        nextRunAtMs: run.nextRunAt ? run.nextRunAt.getTime() : null,
        model: run.model,
        provider: run.provider,
    }
}

export async function listRoomRunHistory(input: {
    roomId: string
    limit?: number
}): Promise<RoomRunHistorySnapshot> {
    const limit =
        input.limit && Number.isFinite(input.limit)
            ? Math.max(1, Math.min(200, Math.floor(input.limit)))
            : 100
    const runs = await roomCronRepository.listRunsByRoomId({
        roomId: input.roomId,
        limit,
    })
    return {
        roomId: input.roomId,
        mismatchCount: 0,
        entries: runs.map(mapCronRunRecord),
    }
}
