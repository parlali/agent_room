import type { D1Database } from '@cloudflare/workers-types'
import type { JobSchedule } from '#/domain/job-schedule'
import {
    computeNextRunAt,
    describeJobSchedule,
    intervalMinutes,
    normalizeJobSchedule,
} from '#/domain/job-schedule'
import type { RoomCronJob, RoomRunHistorySnapshot } from '../rooms/execution-types'
import type { HostedActor } from './hosted-auth'
import type { AgentRoomHostedEnv } from './bindings'
import { requireHostedExecutionContext } from './hosted-execution-context'
import { nowIso, parseJsonValue } from './hosted-json'
import { getOrCreateHostedRoomConfig } from './hosted-room-config-store'
import { getHostedRoomConfigSnapshot, getHostedRuntimeEndpointState } from './hosted-room-service'

interface HostedCronRuntimeTruth {
    provider: string | null
    model: string | null
    configVersion: number | null
}

function hostedCronActor(input: { workspaceId: string; actorUserId: string }): HostedActor {
    return {
        authProvider: 'better-auth',
        userId: input.actorUserId,
        sessionId: 'hosted-cron',
        email: 'system@agent-room.local',
        workspaceId: input.workspaceId,
    }
}

export async function readHostedCronRuntimeTruth(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    actorUserId: string
}): Promise<HostedCronRuntimeTruth> {
    const [snapshot, endpoint] = await Promise.all([
        getHostedRoomConfigSnapshot({
            env: input.env,
            actor: hostedCronActor({
                workspaceId: input.workspaceId,
                actorUserId: input.actorUserId,
            }),
            roomId: input.roomId,
        }),
        getHostedRuntimeEndpointState({
            env: input.env,
            workspaceId: input.workspaceId,
            roomId: input.roomId,
        }),
    ])
    return {
        provider: snapshot.effective.provider,
        model: snapshot.effective.model,
        configVersion: endpoint?.runtime.configVersion ?? null,
    }
}

export async function listRoomCronJobs(input: {
    roomId: string
    limit?: number
}): Promise<RoomCronJob[]> {
    const { context, actor } = await requireHostedExecutionContext()
    const rows = await context.env.AGENT_ROOM_DB.prepare(
        `
            SELECT
                id,
                name,
                message,
                enabled,
                schedule,
                timezone,
                next_run_at AS nextRunAt,
                running_at AS runningAt,
                locked_until AS lockedUntil,
                lock_token AS lockToken,
                last_run_at AS lastRunAt,
                last_run_status AS lastRunStatus,
                last_error AS lastError,
                last_duration_ms AS lastDurationMs,
                provider,
                model,
                config_version AS configVersion
            FROM hosted_room_job
            WHERE workspace_id = ?1
              AND room_id = ?2
            ORDER BY created_at DESC
            LIMIT ?3
        `,
    )
        .bind(actor.workspaceId, input.roomId, input.limit ?? 200)
        .all<HostedCronRow>()
    return rows.results.map(mapCronJob)
}

export async function createRoomCronJob(input: {
    roomId: string
    name: string
    message: string
    schedule: JobSchedule
}): Promise<RoomCronJob> {
    return writeCronJob({
        ...input,
        jobId: null,
        enabled: true,
    })
}

export async function updateRoomCronJob(input: {
    roomId: string
    jobId: string
    name: string
    message: string
    schedule: JobSchedule
}): Promise<RoomCronJob> {
    const { context, actor } = await requireHostedExecutionContext()
    const existing = await readCronJob(context.env, actor.workspaceId, input.roomId, input.jobId)
    if (!existing) {
        throw new Error(`Cron job ${input.jobId} does not exist`)
    }
    return writeCronJob({
        ...input,
        enabled: existing.enabled === 1,
    })
}

export async function updateRoomCronJobEnabled(input: {
    roomId: string
    jobId: string
    enabled: boolean
}): Promise<RoomCronJob> {
    const { context, actor } = await requireHostedExecutionContext()
    const existing = await readCronJob(context.env, actor.workspaceId, input.roomId, input.jobId)
    if (!existing) {
        throw new Error(`Cron job ${input.jobId} does not exist`)
    }
    const schedule = normalizeJobSchedule(parseJsonValue(existing.schedule, {}))
    const nextRunAt = input.enabled
        ? computeNextRunAt({
              schedule,
              after: new Date(),
              timezone: existing.timezone,
          }).toISOString()
        : null
    await context.env.AGENT_ROOM_DB.prepare(
        `
            UPDATE hosted_room_job
            SET enabled = ?1,
                next_run_at = ?2,
                updated_at = ?3
            WHERE workspace_id = ?4
              AND room_id = ?5
              AND id = ?6
        `,
    )
        .bind(
            input.enabled ? 1 : 0,
            nextRunAt,
            nowIso(),
            actor.workspaceId,
            input.roomId,
            input.jobId,
        )
        .run()
    return mapCronJob({
        ...existing,
        enabled: input.enabled ? 1 : 0,
        nextRunAt,
    })
}

export async function removeRoomCronJob(input: { roomId: string; jobId: string }): Promise<void> {
    const { context, actor } = await requireHostedExecutionContext()
    const result = await context.env.AGENT_ROOM_DB.prepare(
        `
            DELETE FROM hosted_room_job
            WHERE workspace_id = ?1
              AND room_id = ?2
              AND id = ?3
        `,
    )
        .bind(actor.workspaceId, input.roomId, input.jobId)
        .run()
    if ((result.meta.changes ?? 0) < 1) {
        throw new Error(`Cron job ${input.jobId} does not exist`)
    }
}

export async function listRoomRunHistory(input: {
    roomId: string
    limit?: number
}): Promise<RoomRunHistorySnapshot> {
    const { context, actor } = await requireHostedExecutionContext()
    const limit =
        input.limit && Number.isFinite(input.limit)
            ? Math.max(1, Math.min(200, Math.floor(input.limit)))
            : 100
    const rows = await context.env.AGENT_ROOM_DB.prepare(
        `
            SELECT
                id,
                room_id AS roomId,
                job_id AS jobId,
                job_name AS jobName,
                status,
                summary,
                error,
                session_key AS sessionKey,
                session_id AS sessionId,
                provider,
                model,
                started_at AS startedAt,
                duration_ms AS durationMs,
                next_run_at AS nextRunAt
            FROM hosted_room_job_run
            WHERE workspace_id = ?1
              AND room_id = ?2
            ORDER BY started_at DESC
            LIMIT ?3
        `,
    )
        .bind(actor.workspaceId, input.roomId, limit)
        .all<HostedCronRunRow>()
    return {
        roomId: input.roomId,
        mismatchCount: 0,
        entries: rows.results.map(mapCronRun),
    }
}

async function writeCronJob(input: {
    roomId: string
    jobId: string | null
    name: string
    message: string
    schedule: JobSchedule
    enabled: boolean
}): Promise<RoomCronJob> {
    const { context, actor } = await requireHostedExecutionContext()
    const id = input.jobId ?? crypto.randomUUID()
    const name = input.name.trim()
    if (!name) {
        throw new Error('Cron job name cannot be empty')
    }
    const message = input.message.trim()
    if (!message) {
        throw new Error('Cron job message cannot be empty')
    }
    const existing = input.jobId
        ? await readCronJob(context.env, actor.workspaceId, input.roomId, input.jobId)
        : null
    if (input.jobId && !existing) {
        throw new Error(`Cron job ${input.jobId} does not exist`)
    }
    const config = await getOrCreateHostedRoomConfig({
        env: context.env,
        workspaceId: actor.workspaceId,
        roomId: input.roomId,
    })
    const runtimeTruth = await readHostedCronRuntimeTruth({
        env: context.env,
        workspaceId: actor.workspaceId,
        roomId: input.roomId,
        actorUserId: actor.userId,
    })
    const schedule = normalizeJobSchedule(input.schedule)
    const timezone = existing?.timezone ?? config.cronTimezone
    const enabled = existing ? existing.enabled === 1 : input.enabled
    const nextRunAt = enabled
        ? computeNextRunAt({ schedule, after: new Date(), timezone }).toISOString()
        : null
    const now = nowIso()
    await context.env.AGENT_ROOM_DB.prepare(
        `
            INSERT INTO hosted_room_job (
                id,
                workspace_id,
                room_id,
                name,
                message,
                enabled,
                schedule,
                timezone,
                next_run_at,
                provider,
                model,
                config_version,
                created_at,
                updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                message = excluded.message,
                enabled = excluded.enabled,
                schedule = excluded.schedule,
                timezone = excluded.timezone,
                next_run_at = excluded.next_run_at,
                provider = excluded.provider,
                model = excluded.model,
                config_version = excluded.config_version,
                updated_at = excluded.updated_at
            WHERE hosted_room_job.workspace_id = excluded.workspace_id
              AND hosted_room_job.room_id = excluded.room_id
        `,
    )
        .bind(
            id,
            actor.workspaceId,
            input.roomId,
            name,
            message,
            enabled ? 1 : 0,
            JSON.stringify(schedule),
            timezone,
            nextRunAt,
            runtimeTruth.provider,
            runtimeTruth.model,
            runtimeTruth.configVersion,
            now,
        )
        .run()
    const row = await readCronJob(context.env, actor.workspaceId, input.roomId, id)
    if (!row) {
        throw new Error('Hosted cron job was not saved')
    }
    return mapCronJob(row)
}

export async function readCronJob(
    env: { AGENT_ROOM_DB: D1Database },
    workspaceId: string,
    roomId: string,
    jobId: string,
): Promise<HostedCronRow | null> {
    return env.AGENT_ROOM_DB.prepare(
        `
            SELECT
                id,
                name,
                message,
                enabled,
                schedule,
                timezone,
                next_run_at AS nextRunAt,
                running_at AS runningAt,
                locked_until AS lockedUntil,
                lock_token AS lockToken,
                last_run_at AS lastRunAt,
                last_run_status AS lastRunStatus,
                last_error AS lastError,
                last_duration_ms AS lastDurationMs,
                provider,
                model,
                config_version AS configVersion
            FROM hosted_room_job
            WHERE workspace_id = ?1
              AND room_id = ?2
              AND id = ?3
        `,
    )
        .bind(workspaceId, roomId, jobId)
        .first<HostedCronRow>()
}

export function nextHostedCronRunAt(row: HostedCronRow): string | null {
    if (row.enabled !== 1) {
        return null
    }
    return computeNextRunAt({
        schedule: normalizeJobSchedule(parseJsonValue(row.schedule, {})),
        after: new Date(),
        timezone: row.timezone,
    }).toISOString()
}

export async function createHostedCronRun(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    job: HostedCronRow
    status: 'running' | 'complete' | 'failed' | 'skipped'
    error: string | null
    sessionKey: string | null
    provider?: string | null
    model?: string | null
    configVersion?: number | null
    runId?: string | null
    lockToken?: string | null
    nextRunAt?: string | null
}): Promise<{ id: string; startedAt: string }> {
    const id = input.runId ?? crypto.randomUUID()
    const startedAt = nowIso()
    const provider = 'provider' in input ? (input.provider ?? null) : input.job.provider
    const model = 'model' in input ? (input.model ?? null) : input.job.model
    const configVersion =
        'configVersion' in input ? (input.configVersion ?? null) : input.job.configVersion
    await input.env.AGENT_ROOM_DB.prepare(
        `
            INSERT INTO hosted_room_job_run (
                id,
                workspace_id,
                room_id,
                job_id,
                job_name,
                attempt,
                status,
                summary,
                error,
                lock_token,
                session_key,
                session_id,
                provider,
                model,
                config_version,
                started_at,
                finished_at,
                duration_ms,
                next_run_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7, ?8, ?9, ?10, NULL, ?11, ?12, ?13, ?14, NULL, NULL, ?15)
        `,
    )
        .bind(
            id,
            input.workspaceId,
            input.roomId,
            input.job.id,
            input.job.name,
            input.status,
            input.job.message,
            input.error,
            input.lockToken ?? null,
            input.sessionKey,
            provider,
            model,
            configVersion,
            startedAt,
            input.nextRunAt ?? null,
        )
        .run()
    return { id, startedAt }
}

export async function finishHostedCronRun(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    runId: string
    status: 'complete' | 'failed' | 'skipped'
    error: string | null
    startedAt: string
    nextRunAt: string | null
    provider?: string | null
    model?: string | null
    configVersion?: number | null
}): Promise<number> {
    const finishedAt = new Date()
    const durationMs = Math.max(0, finishedAt.getTime() - new Date(input.startedAt).getTime())
    await input.env.AGENT_ROOM_DB.prepare(
        `
            UPDATE hosted_room_job_run
            SET status = ?1,
                error = ?2,
                finished_at = ?3,
                duration_ms = ?4,
                next_run_at = ?5,
                provider = COALESCE(?6, provider),
                model = COALESCE(?7, model),
                config_version = COALESCE(?8, config_version)
            WHERE workspace_id = ?9
              AND room_id = ?10
              AND id = ?11
        `,
    )
        .bind(
            input.status,
            input.error,
            finishedAt.toISOString(),
            durationMs,
            input.nextRunAt,
            input.provider ?? null,
            input.model ?? null,
            input.configVersion ?? null,
            input.workspaceId,
            input.roomId,
            input.runId,
        )
        .run()
    return durationMs
}

export async function finishHostedCronJob(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    jobId: string
    lockToken: string
    status: 'complete' | 'failed' | 'skipped'
    error: string | null
    durationMs: number
    nextRunAt: string | null
    provider?: string | null
    model?: string | null
    configVersion?: number | null
}): Promise<void> {
    await input.env.AGENT_ROOM_DB.prepare(
        `
            UPDATE hosted_room_job
            SET running_at = NULL,
                heartbeat_at = NULL,
                locked_until = NULL,
                lock_token = NULL,
                last_renewed_at = NULL,
                next_run_at = ?1,
                last_run_status = ?2,
                last_error = ?3,
                last_duration_ms = ?4,
                provider = COALESCE(?5, provider),
                model = COALESCE(?6, model),
                config_version = COALESCE(?7, config_version),
                updated_at = ?8
            WHERE workspace_id = ?9
              AND room_id = ?10
              AND id = ?11
              AND lock_token = ?12
        `,
    )
        .bind(
            input.nextRunAt,
            input.status,
            input.error,
            input.durationMs,
            input.provider ?? null,
            input.model ?? null,
            input.configVersion ?? null,
            nowIso(),
            input.workspaceId,
            input.roomId,
            input.jobId,
            input.lockToken,
        )
        .run()
}

export async function finishHostedCronRunFromRuntimeEvent(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    runId: string | null
    jobId: string | null
    status: string | null
    error: string | null
    provider?: string | null
    model?: string | null
    configVersion?: number | null
}): Promise<void> {
    if (!input.runId || !input.jobId) {
        return
    }
    const row = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT
                id,
                job_id AS jobId,
                lock_token AS lockToken,
                started_at AS startedAt
            FROM hosted_room_job_run
            WHERE workspace_id = ?1
              AND room_id = ?2
              AND id = ?3
              AND job_id = ?4
              AND status = 'running'
            LIMIT 1
        `,
    )
        .bind(input.workspaceId, input.roomId, input.runId, input.jobId)
        .first<{
            id: string
            jobId: string | null
            lockToken: string | null
            startedAt: string
        }>()
    if (!row) {
        return
    }
    const job = row.jobId
        ? await readCronJob(input.env, input.workspaceId, input.roomId, row.jobId)
        : null
    const status = input.status === 'error' || input.error ? 'failed' : 'complete'
    const nextRunAt = job ? nextHostedCronRunAt(job) : null
    const durationMs = await finishHostedCronRun({
        env: input.env,
        workspaceId: input.workspaceId,
        roomId: input.roomId,
        runId: row.id,
        status,
        error: input.error,
        startedAt: row.startedAt,
        nextRunAt,
        provider: input.provider ?? null,
        model: input.model ?? null,
        configVersion: input.configVersion ?? null,
    })
    if (job && row.lockToken) {
        await finishHostedCronJob({
            env: input.env,
            workspaceId: input.workspaceId,
            roomId: input.roomId,
            jobId: job.id,
            lockToken: row.lockToken,
            status,
            error: input.error,
            durationMs,
            nextRunAt,
            provider: input.provider ?? null,
            model: input.model ?? null,
            configVersion: input.configVersion ?? null,
        })
    }
}

export async function recordHostedCronJobRunSnapshot(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    jobId: string
    lockToken: string
    provider: string | null
    model: string | null
    configVersion: number | null
}): Promise<void> {
    await input.env.AGENT_ROOM_DB.prepare(
        `
            UPDATE hosted_room_job
            SET provider = ?1,
                model = ?2,
                config_version = ?3,
                updated_at = ?4
            WHERE workspace_id = ?5
              AND room_id = ?6
              AND id = ?7
              AND lock_token = ?8
        `,
    )
        .bind(
            input.provider,
            input.model,
            input.configVersion,
            nowIso(),
            input.workspaceId,
            input.roomId,
            input.jobId,
            input.lockToken,
        )
        .run()
}

export async function failStaleHostedCronRunsForRecoveredLease(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    jobId: string
    recoveredAt: string
}): Promise<void> {
    await input.env.AGENT_ROOM_DB.prepare(
        `
            UPDATE hosted_room_job_run
            SET status = 'failed',
                error = 'Scheduled run lease expired before completion',
                finished_at = ?1,
                duration_ms = MAX(0, CAST((julianday(?1) - julianday(started_at)) * 86400000 AS INTEGER))
            WHERE workspace_id = ?2
              AND room_id = ?3
              AND job_id = ?4
              AND status = 'running'
        `,
    )
        .bind(input.recoveredAt, input.workspaceId, input.roomId, input.jobId)
        .run()
}

function mapCronJob(row: HostedCronRow): RoomCronJob {
    const schedule = normalizeJobSchedule(parseJsonValue(row.schedule, {}))
    return {
        id: row.id,
        agentId: null,
        sessionKey: null,
        name: row.name,
        description: null,
        enabled: row.enabled === 1,
        sessionTarget: null,
        wakeMode: null,
        everyMinutes: intervalMinutes(schedule),
        schedule,
        timezone: row.timezone,
        scheduleSummary: describeJobSchedule(schedule),
        payloadSummary: row.message,
        nextRunAt: row.nextRunAt ? new Date(row.nextRunAt).getTime() : null,
        runningAt: row.runningAt ? new Date(row.runningAt).getTime() : null,
        lastRunAt: row.lastRunAt ? new Date(row.lastRunAt).getTime() : null,
        lastRunStatus: row.lastRunStatus,
        lastError: row.lastError,
        lastDurationMs: row.lastDurationMs,
    }
}

function mapCronRun(row: HostedCronRunRow): RoomRunHistorySnapshot['entries'][number] {
    return {
        id: row.id,
        ts: new Date(row.startedAt).getTime(),
        jobId: row.jobId ?? '',
        jobName: row.jobName,
        status: row.status,
        summary: row.summary,
        error: row.error,
        sessionId: row.sessionId,
        sessionKey: row.sessionKey,
        declaredAgentId: 'main',
        effectiveAgentId: 'main',
        resolvedSessionAgentId: row.sessionKey ? 'main' : null,
        ownership: row.sessionKey ? 'owned' : 'unknown',
        durationMs: row.durationMs,
        nextRunAtMs: row.nextRunAt ? new Date(row.nextRunAt).getTime() : null,
        model: row.model,
        provider: row.provider,
    }
}

export interface HostedCronRow {
    id: string
    name: string
    message: string
    enabled: number
    schedule: string
    timezone: string
    nextRunAt: string | null
    runningAt: string | null
    lockedUntil: string | null
    lockToken: string | null
    lastRunAt: string | null
    lastRunStatus: string | null
    lastError: string | null
    lastDurationMs: number | null
    provider: string | null
    model: string | null
    configVersion: number | null
}

export interface HostedDueCronRow extends HostedCronRow {
    workspaceId: string
    roomId: string
    createdByUserId: string | null
}

interface HostedCronRunRow {
    id: string
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
    startedAt: string
    durationMs: number | null
    nextRunAt: string | null
}
