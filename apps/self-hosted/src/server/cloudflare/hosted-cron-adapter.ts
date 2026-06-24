import type { AgentRoomHostedEnv } from './bindings'
import { normalizeBudgets } from '../configuration/capabilities'
import { createThreadSchema, sendSchema } from '../rooms/pi-execution-adapter/runtime-schemas'
import {
    createThreadRuntimeRequest,
    sendThreadRuntimeRequest,
} from '../rooms/pi-execution-adapter/thread-requests'
import { assertHostedRunAllowed, requireHostedExecutionContext } from './hosted-execution-context'
import { nowIso } from './hosted-json'
import { enqueueHostedRuntimeReconcile } from './hosted-runtime-jobs'
import { requestHostedPiRuntime } from './hosted-runtime-client'
import { getHostedRuntimeEndpointState } from './hosted-room-service'
import {
    createHostedCronRun,
    failStaleHostedCronRunsForRecoveredLease,
    finishHostedCronJob,
    finishHostedCronRun,
    nextHostedCronRunAt,
    readCronJob,
    readHostedCronRuntimeTruth,
    recordHostedCronJobRunSnapshot,
    type HostedCronRow,
    type HostedDueCronRow,
} from './hosted-cron-management'

export {
    createRoomCronJob,
    listRoomCronJobs,
    listRoomRunHistory,
    removeRoomCronJob,
    updateRoomCronJob,
    updateRoomCronJobEnabled,
} from './hosted-cron-management'

const maxHostedCronStaleLockMs = 12 * 60 * 60 * 1000

type HostedCronRunSnapshot = Awaited<ReturnType<typeof readHostedCronRuntimeTruth>>

function hostedCronRunBudgetMs(): number {
    return normalizeBudgets().scheduledTurnMs
}

function hostedCronLeaseUntil(input: { now: Date; runBudgetMs: number }): string {
    const leaseMs = Math.min(
        maxHostedCronStaleLockMs,
        Math.max(5 * 60000, input.runBudgetMs + 60000),
    )
    return nowIso(new Date(input.now.getTime() + leaseMs))
}

export async function runRoomCronJobNow(input: {
    roomId: string
    jobId: string
}): Promise<{ ran: boolean; reason: string | null }> {
    const { context, actor } = await requireHostedExecutionContext()
    const existing = await readCronJob(context.env, actor.workspaceId, input.roomId, input.jobId)
    if (!existing) {
        throw new Error(`Cron job ${input.jobId} does not exist`)
    }
    const runtime = await hostedRuntimeCronReadiness({
        env: context.env,
        workspaceId: actor.workspaceId,
        roomId: input.roomId,
        actorUserId: actor.userId,
    })
    if (!runtime.ready) {
        return {
            ran: false,
            reason: runtime.reason,
        }
    }
    const lockToken = crypto.randomUUID()
    const job = await claimHostedCronJob({
        env: context.env,
        workspaceId: actor.workspaceId,
        roomId: input.roomId,
        jobId: input.jobId,
        lockToken,
    })
    if (!job) {
        return {
            ran: false,
            reason: 'Job is already running',
        }
    }
    return executeClaimedHostedCronJob({
        env: context.env,
        workspaceId: actor.workspaceId,
        roomId: input.roomId,
        job,
        lockToken,
        actorUserId: actor.userId,
        awaitCompletion: true,
    })
}

export async function runDueHostedRoomCronJobs(
    env: AgentRoomHostedEnv,
    input: {
        limit?: number
    } = {},
): Promise<Array<{ jobId: string; ran: boolean; reason: string | null }>> {
    const now = nowIso()
    const limit =
        input.limit && Number.isFinite(input.limit)
            ? Math.max(1, Math.min(25, Math.floor(input.limit)))
            : 10
    const rows = await env.AGENT_ROOM_DB.prepare(
        `
            SELECT
                job.id,
                job.workspace_id AS workspaceId,
                job.room_id AS roomId,
                room.created_by_user_id AS createdByUserId,
                job.name,
                job.message,
                job.enabled,
                job.schedule,
                job.timezone,
                job.next_run_at AS nextRunAt,
                job.running_at AS runningAt,
                job.locked_until AS lockedUntil,
                job.lock_token AS lockToken,
                job.last_run_at AS lastRunAt,
                job.last_run_status AS lastRunStatus,
                job.last_error AS lastError,
                job.last_duration_ms AS lastDurationMs,
                job.provider,
                job.model,
                job.config_version AS configVersion
            FROM hosted_room_job job
            INNER JOIN hosted_room room
                ON room.workspace_id = job.workspace_id
               AND room.id = job.room_id
            WHERE job.enabled = 1
              AND job.next_run_at IS NOT NULL
              AND job.next_run_at <= ?1
              AND room.desired_state = 'running'
              AND (job.running_at IS NULL OR job.locked_until IS NULL OR job.locked_until <= ?3)
            ORDER BY job.next_run_at ASC
            LIMIT ?2
        `,
    )
        .bind(now, limit, now)
        .all<HostedDueCronRow>()
    const results: Array<{ jobId: string; ran: boolean; reason: string | null }> = []
    for (const row of rows.results) {
        const runtime = await hostedRuntimeCronReadiness({
            env,
            workspaceId: row.workspaceId,
            roomId: row.roomId,
            actorUserId: row.createdByUserId ?? 'system',
        })
        if (!runtime.ready) {
            results.push({
                jobId: row.id,
                ran: false,
                reason: runtime.reason,
            })
            continue
        }
        const lockToken = crypto.randomUUID()
        const claimed = await claimHostedCronJob({
            env,
            workspaceId: row.workspaceId,
            roomId: row.roomId,
            jobId: row.id,
            lockToken,
            dueAt: now,
        })
        if (!claimed) {
            console.warn('Hosted cron job was already claimed by another invocation; skipping')
            continue
        }
        const result = await executeClaimedHostedCronJob({
            env,
            workspaceId: row.workspaceId,
            roomId: row.roomId,
            job: claimed,
            lockToken,
            actorUserId: row.createdByUserId ?? 'system',
            awaitCompletion: false,
        })
        results.push({
            jobId: row.id,
            ...result,
        })
    }
    return results
}

async function hostedRuntimeCronReadiness(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    actorUserId: string
}): Promise<{ ready: true } | { ready: false; reason: string }> {
    const endpoint = await getHostedRuntimeEndpointState(input)
    if (!endpoint || endpoint.desiredState !== 'running' || endpoint.status === 'stopped') {
        return {
            ready: false,
            reason: 'Room runtime is not running',
        }
    }
    if (!endpoint.runtime.tokenObjectKey || endpoint.runtime.healthStatus !== 'healthy') {
        await enqueueHostedRuntimeReconcile(input)
        return {
            ready: false,
            reason: 'Room runtime reconcile queued',
        }
    }
    const container = input.env.AGENT_ROOM_RUNTIME.getByName(endpoint.runtime.containerName)
    const state = await container.getState()
    if (state.status !== 'healthy') {
        await enqueueHostedRuntimeReconcile(input)
        return {
            ready: false,
            reason: 'Room runtime reconcile queued',
        }
    }
    return { ready: true }
}

async function claimHostedCronJob(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    jobId: string
    lockToken: string
    dueAt?: string | null
}): Promise<HostedCronRow | null> {
    const existing = await readCronJob(input.env, input.workspaceId, input.roomId, input.jobId)
    if (!existing) {
        return null
    }
    const now = new Date()
    const nowText = nowIso(now)
    const recoveredExpiredLease =
        existing.runningAt !== null && (!existing.lockedUntil || existing.lockedUntil <= nowText)
    const lockedUntil = hostedCronLeaseUntil({
        now,
        runBudgetMs: hostedCronRunBudgetMs(),
    })
    const result = await input.env.AGENT_ROOM_DB.prepare(
        `
            UPDATE hosted_room_job
            SET running_at = ?1,
                heartbeat_at = ?1,
                locked_until = ?2,
                lock_token = ?3,
                last_renewed_at = ?1,
                run_budget_ms = ?4,
                recovery_reason = CASE
                    WHEN running_at IS NOT NULL
                     AND (locked_until IS NULL OR locked_until <= ?1)
                    THEN 'expired_lease'
                    ELSE NULL
                END,
                last_run_at = ?1,
                last_run_status = 'running',
                last_error = NULL,
                updated_at = ?1
            WHERE workspace_id = ?5
              AND room_id = ?6
              AND id = ?7
              AND (running_at IS NULL OR locked_until IS NULL OR locked_until <= ?1)
              AND (
                  ?8 IS NULL
                  OR (
                      enabled = 1
                      AND next_run_at IS NOT NULL
                      AND next_run_at <= ?8
                      AND EXISTS (
                          SELECT 1
                          FROM hosted_room
                          WHERE hosted_room.workspace_id = hosted_room_job.workspace_id
                            AND hosted_room.id = hosted_room_job.room_id
                            AND hosted_room.desired_state = 'running'
                      )
                  )
              )
        `,
    )
        .bind(
            nowText,
            lockedUntil,
            input.lockToken,
            hostedCronRunBudgetMs(),
            input.workspaceId,
            input.roomId,
            input.jobId,
            input.dueAt ?? null,
        )
        .run()
    if ((result.meta.changes ?? 0) < 1) {
        return null
    }
    if (recoveredExpiredLease) {
        await failStaleHostedCronRunsForRecoveredLease({
            env: input.env,
            workspaceId: input.workspaceId,
            roomId: input.roomId,
            jobId: input.jobId,
            recoveredAt: nowText,
        })
    }
    return readCronJob(input.env, input.workspaceId, input.roomId, input.jobId)
}

async function executeClaimedHostedCronJob(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    job: HostedCronRow
    lockToken: string
    actorUserId: string
    awaitCompletion: boolean
}): Promise<{ ran: boolean; reason: string | null }> {
    let run: { id: string; startedAt: string } | null = null
    let startedAt = nowIso()
    let runSnapshot: HostedCronRunSnapshot = {
        provider: input.job.provider,
        model: input.job.model,
        configVersion: input.job.configVersion,
    }
    try {
        await assertHostedRunAllowed({
            env: input.env,
            workspaceId: input.workspaceId,
            roomId: input.roomId,
        })
        runSnapshot = await readHostedCronRuntimeTruth({
            env: input.env,
            workspaceId: input.workspaceId,
            roomId: input.roomId,
            actorUserId: input.actorUserId,
        })
        await recordHostedCronJobRunSnapshot({
            env: input.env,
            workspaceId: input.workspaceId,
            roomId: input.roomId,
            jobId: input.job.id,
            lockToken: input.lockToken,
            ...runSnapshot,
        })
        const createRequest = createThreadRuntimeRequest({
            firstMessage: null,
            title: null,
            hideUserMessage: false,
            awaitInitialRun: false,
            internalInstruction: null,
            kind: 'main',
        })
        const thread = await requestHostedPiRuntime({
            env: input.env,
            workspaceId: input.workspaceId,
            roomId: input.roomId,
            path: createRequest.path,
            schema: createThreadSchema,
            method: createRequest.method,
            body: createRequest.body,
        })
        const runId = crypto.randomUUID()
        run = await createHostedCronRun({
            env: input.env,
            workspaceId: input.workspaceId,
            roomId: input.roomId,
            job: input.job,
            status: 'running',
            error: null,
            sessionKey: thread.key,
            ...runSnapshot,
            runId,
            lockToken: input.lockToken,
        })
        startedAt = run.startedAt
        const sendRequest = sendThreadRuntimeRequest({
            sessionKey: thread.key,
            message: input.job.message,
            awaitCompletion: input.awaitCompletion,
            runKind: 'scheduled',
            hideUserMessage: false,
            runId,
            jobId: input.job.id,
        })
        const result = await requestHostedPiRuntime({
            env: input.env,
            workspaceId: input.workspaceId,
            roomId: input.roomId,
            path: sendRequest.path,
            schema: sendSchema,
            method: sendRequest.method,
            body: sendRequest.body,
        })
        if (!input.awaitCompletion) {
            return {
                ran: true,
                reason: null,
            }
        }
        const status = result.status === 'error' ? 'failed' : 'complete'
        const nextRunAt = nextHostedCronRunAt(input.job)
        const durationMs = await finishHostedCronRun({
            env: input.env,
            workspaceId: input.workspaceId,
            roomId: input.roomId,
            runId: run.id,
            status,
            error: result.error,
            startedAt,
            nextRunAt,
            ...runSnapshot,
        })
        await finishHostedCronJob({
            env: input.env,
            workspaceId: input.workspaceId,
            roomId: input.roomId,
            jobId: input.job.id,
            lockToken: input.lockToken,
            status,
            error: result.error,
            durationMs,
            nextRunAt,
            ...runSnapshot,
        })
        return {
            ran: result.status !== 'error',
            reason: result.error,
        }
    } catch (error) {
        const reason = error instanceof Error ? error.message : 'Scheduled run failed'
        const nextRunAt = nextHostedCronRunAt(input.job)
        if (!run) {
            run = await createHostedCronRun({
                env: input.env,
                workspaceId: input.workspaceId,
                roomId: input.roomId,
                job: input.job,
                status: 'failed',
                error: reason,
                sessionKey: null,
                ...runSnapshot,
                lockToken: input.lockToken,
                nextRunAt,
            })
            startedAt = run.startedAt
        }
        const durationMs = await finishHostedCronRun({
            env: input.env,
            workspaceId: input.workspaceId,
            roomId: input.roomId,
            runId: run.id,
            status: 'failed',
            error: reason,
            startedAt,
            nextRunAt,
            ...runSnapshot,
        })
        await finishHostedCronJob({
            env: input.env,
            workspaceId: input.workspaceId,
            roomId: input.roomId,
            jobId: input.job.id,
            lockToken: input.lockToken,
            status: 'failed',
            error: reason,
            durationMs,
            nextRunAt,
            ...runSnapshot,
        })
        return {
            ran: false,
            reason,
        }
    }
}
