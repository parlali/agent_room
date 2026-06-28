import type { AgentRoomCronRunMessage, AgentRoomHostedEnv } from './bindings'
import { computeNextRunAt } from '#/domain/job-schedule'
import {
    claimDueHostedCronJobs,
    createHostedCronRun,
    finishHostedCronJob,
    finishHostedCronRun,
    findHostedCronJob,
    type HostedCronJobRecord,
    type HostedCronRunRecord,
} from './hosted-cron-repository'
import { enqueueHostedCronRun } from './hosted-runtime-jobs'
import { reconcileHostedRuntimeJob } from './hosted-runtime-adapter'
import { requestHostedPiRuntime } from './hosted-runtime-client'
import { assertHostedRunAllowed } from './hosted-execution-context'
import {
    createThreadRuntimeRequest,
    sendThreadRuntimeRequest,
} from '../rooms/pi-execution-adapter/thread-requests'
import { createThreadSchema, sendSchema } from '../rooms/pi-execution-adapter/runtime-schemas'

const hostedCronLeaseMs = 30 * 60 * 1000
const hostedCronClaimLimit = 25

export function hostedCronLeaseUntil(now = Date.now()): string {
    return new Date(now + hostedCronLeaseMs).toISOString()
}

function nextRunIso(job: HostedCronJobRecord): string | null {
    if (!job.enabled) {
        return null
    }
    return computeNextRunAt({
        schedule: job.schedule,
        after: new Date(),
        timezone: job.timezone,
    }).toISOString()
}

async function readRoomDesiredState(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
}): Promise<string | null> {
    const row = await input.env.AGENT_ROOM_DB.prepare(
        `SELECT desired_state FROM hosted_room WHERE workspace_id = ?1 AND id = ?2 LIMIT 1`,
    )
        .bind(input.workspaceId, input.roomId)
        .first<{ desired_state: string }>()
    return row ? row.desired_state : null
}

function isRuntimeDownError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : ''
    return /not running|not healthy|not active/i.test(message)
}

async function createCronThread(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    title: string
}): Promise<{ key: string }> {
    const request = createThreadRuntimeRequest({
        firstMessage: null,
        title: input.title,
        hideUserMessage: false,
        awaitInitialRun: false,
        internalInstruction: null,
        kind: 'main',
    })
    return requestHostedPiRuntime({
        env: input.env,
        workspaceId: input.workspaceId,
        roomId: input.roomId,
        path: request.path,
        method: request.method,
        body: request.body,
        schema: createThreadSchema,
    })
}

async function ensureCronThread(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    title: string
}): Promise<{ key: string }> {
    try {
        return await createCronThread(input)
    } catch (error) {
        if (!isRuntimeDownError(error)) {
            throw error
        }
        await reconcileHostedRuntimeJob(input.env, {
            kind: 'room-runtime-reconcile',
            workspaceId: input.workspaceId,
            roomId: input.roomId,
            actorUserId: null,
            requestedAt: new Date().toISOString(),
        })
        return createCronThread(input)
    }
}

export async function runDueHostedCronJobs(env: AgentRoomHostedEnv): Promise<void> {
    const lockToken = crypto.randomUUID()
    const jobs = await claimDueHostedCronJobs({
        env,
        lockToken,
        leaseUntil: hostedCronLeaseUntil(),
        limit: hostedCronClaimLimit,
    })
    for (const job of jobs) {
        await enqueueHostedCronRun({
            env,
            workspaceId: job.workspaceId,
            roomId: job.roomId,
            jobId: job.id,
            lockToken,
        })
    }
}

export async function executeHostedCronRun(
    env: AgentRoomHostedEnv,
    message: AgentRoomCronRunMessage,
): Promise<void> {
    const job = await findHostedCronJob({
        env,
        workspaceId: message.workspaceId,
        roomId: message.roomId,
        jobId: message.jobId,
    })
    if (!job) {
        return
    }
    if (job.lockToken !== message.lockToken) {
        return
    }

    const startedAt = Date.now()
    const nextRunAt = nextRunIso(job)

    const desiredState = await readRoomDesiredState({
        env,
        workspaceId: message.workspaceId,
        roomId: message.roomId,
    })
    if (desiredState !== 'running') {
        await createHostedCronRun({
            env,
            workspaceId: message.workspaceId,
            roomId: message.roomId,
            jobId: job.id,
            jobName: job.name,
            status: 'skipped',
            summary: job.message,
            error: 'Room is not running',
            sessionKey: null,
            provider: job.provider,
            model: job.model,
        })
        await finishHostedCronJob({
            env,
            workspaceId: message.workspaceId,
            roomId: message.roomId,
            jobId: job.id,
            lockToken: message.lockToken,
            status: 'skipped',
            error: null,
            durationMs: 0,
            nextRunAt,
        })
        return
    }

    let run: HostedCronRunRecord | null = null
    try {
        await assertHostedRunAllowed({
            env,
            workspaceId: message.workspaceId,
            roomId: message.roomId,
            jobId: job.id,
        })

        const thread = await ensureCronThread({
            env,
            workspaceId: message.workspaceId,
            roomId: message.roomId,
            title: job.name,
        })

        run = await createHostedCronRun({
            env,
            workspaceId: message.workspaceId,
            roomId: message.roomId,
            jobId: job.id,
            jobName: job.name,
            status: 'running',
            summary: job.message,
            error: null,
            sessionKey: thread.key,
            provider: job.provider,
            model: job.model,
        })

        const sendRequest = sendThreadRuntimeRequest({
            sessionKey: thread.key,
            message: job.message,
            awaitCompletion: true,
            runKind: 'scheduled',
            hideUserMessage: false,
            jobId: job.id,
        })
        const sendResult = await requestHostedPiRuntime({
            env,
            workspaceId: message.workspaceId,
            roomId: message.roomId,
            path: sendRequest.path,
            method: sendRequest.method,
            body: sendRequest.body,
            schema: sendSchema,
        })
        if (sendResult.status === 'error') {
            throw new Error(sendResult.error ?? 'Scheduled run failed in the hosted runtime')
        }

        await finishHostedCronRun({
            env,
            runId: run.id,
            status: 'complete',
            error: null,
            nextRunAt,
        })
        await finishHostedCronJob({
            env,
            workspaceId: message.workspaceId,
            roomId: message.roomId,
            jobId: job.id,
            lockToken: message.lockToken,
            status: 'complete',
            error: null,
            durationMs: Date.now() - startedAt,
            nextRunAt,
        })
    } catch (error) {
        const reason = error instanceof Error ? error.message : 'Scheduled run failed'
        if (run) {
            await finishHostedCronRun({
                env,
                runId: run.id,
                status: 'failed',
                error: reason,
                nextRunAt,
            })
        } else {
            await createHostedCronRun({
                env,
                workspaceId: message.workspaceId,
                roomId: message.roomId,
                jobId: job.id,
                jobName: job.name,
                status: 'failed',
                summary: job.message,
                error: reason,
                sessionKey: null,
                provider: job.provider,
                model: job.model,
            })
        }
        await finishHostedCronJob({
            env,
            workspaceId: message.workspaceId,
            roomId: message.roomId,
            jobId: job.id,
            lockToken: message.lockToken,
            status: 'failed',
            error: reason,
            durationMs: Date.now() - startedAt,
            nextRunAt,
        })
    }
}
