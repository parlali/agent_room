import type { AgentRoomCronRunMessage, AgentRoomHostedEnv } from './bindings'
import { computeNextRunAt } from '#/domain/job-schedule'
import {
    claimDueHostedCronJobs,
    finishHostedCronJob,
    findHostedCronJob,
    type HostedCronJobRecord,
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

    const nextRunAt = nextRunIso(job)

    const desiredState = await readRoomDesiredState({
        env,
        workspaceId: message.workspaceId,
        roomId: message.roomId,
    })
    if (desiredState !== 'running') {
        await finishHostedCronJob({
            env,
            workspaceId: message.workspaceId,
            roomId: message.roomId,
            jobId: job.id,
            lockToken: message.lockToken,
            status: 'skipped',
            error: 'Room is not running',
            nextRunAt,
        })
        return
    }

    try {
        const thread = await ensureCronThread({
            env,
            workspaceId: message.workspaceId,
            roomId: message.roomId,
            title: job.name,
        })

        await assertHostedRunAllowed({
            env,
            workspaceId: message.workspaceId,
            roomId: message.roomId,
            jobId: job.id,
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

        await finishHostedCronJob({
            env,
            workspaceId: message.workspaceId,
            roomId: message.roomId,
            jobId: job.id,
            lockToken: message.lockToken,
            status: 'complete',
            error: null,
            nextRunAt,
        })
    } catch (error) {
        const reason = error instanceof Error ? error.message : 'Scheduled run failed'
        await finishHostedCronJob({
            env,
            workspaceId: message.workspaceId,
            roomId: message.roomId,
            jobId: job.id,
            lockToken: message.lockToken,
            status: 'failed',
            error: reason,
            nextRunAt,
        })
    }
}
