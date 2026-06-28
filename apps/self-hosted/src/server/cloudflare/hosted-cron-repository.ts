import type { AgentRoomHostedEnv } from './bindings'
import { describeJobSchedule, normalizeJobSchedule, type JobSchedule } from '#/domain/job-schedule'
import type { RoomCronJob } from '../rooms/execution-types'

export interface HostedCronJobRecord {
    id: string
    workspaceId: string
    roomId: string
    name: string
    message: string
    enabled: boolean
    everyMinutes: number
    schedule: JobSchedule
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
}

export interface HostedCronRunRecord {
    id: string
    roomId: string
    jobId: string | null
    jobName: string | null
    status: 'running' | 'complete' | 'failed' | 'skipped'
    summary: string | null
    error: string | null
    sessionKey: string | null
    startedAt: string
    finishedAt: string | null
    durationMs: number | null
    nextRunAt: string | null
}

type Row = Record<string, unknown>

function nowIso(): string {
    return new Date().toISOString()
}

function asString(value: unknown): string {
    return typeof value === 'string' ? value : String(value ?? '')
}

function asNullableString(value: unknown): string | null {
    return typeof value === 'string' ? value : null
}

function asNumber(value: unknown): number {
    return typeof value === 'number' ? value : Number(value ?? 0)
}

function asNullableNumber(value: unknown): number | null {
    return value === null || value === undefined ? null : Number(value)
}

function mapJobRow(row: Row): HostedCronJobRecord {
    const everyMinutes = asNumber(row.every_minutes)
    let schedule: JobSchedule
    try {
        schedule = normalizeJobSchedule(
            JSON.parse(asString(row.schedule)) as JobSchedule,
            everyMinutes,
        )
    } catch {
        schedule = normalizeJobSchedule(undefined, everyMinutes)
    }
    return {
        id: asString(row.id),
        workspaceId: asString(row.workspace_id),
        roomId: asString(row.room_id),
        name: asString(row.name),
        message: asString(row.message),
        enabled: asNumber(row.enabled) === 1,
        everyMinutes,
        schedule,
        timezone: asString(row.timezone) || 'UTC',
        nextRunAt: asNullableString(row.next_run_at),
        runningAt: asNullableString(row.running_at),
        lockedUntil: asNullableString(row.locked_until),
        lockToken: asNullableString(row.lock_token),
        lastRunAt: asNullableString(row.last_run_at),
        lastRunStatus: asNullableString(row.last_run_status),
        lastError: asNullableString(row.last_error),
        lastDurationMs: asNullableNumber(row.last_duration_ms),
        provider: asNullableString(row.provider),
        model: asNullableString(row.model),
    }
}

function mapRunRow(row: Row): HostedCronRunRecord {
    const status = asString(row.status)
    return {
        id: asString(row.id),
        roomId: asString(row.room_id),
        jobId: asNullableString(row.job_id),
        jobName: asNullableString(row.job_name),
        status: (status === 'complete' || status === 'failed' || status === 'skipped'
            ? status
            : 'running') as HostedCronRunRecord['status'],
        summary: asNullableString(row.summary),
        error: asNullableString(row.error),
        sessionKey: asNullableString(row.session_key),
        startedAt: asString(row.started_at),
        finishedAt: asNullableString(row.finished_at),
        durationMs: asNullableNumber(row.duration_ms),
        nextRunAt: asNullableString(row.next_run_at),
    }
}

export function mapHostedCronJobToRoomCronJob(job: HostedCronJobRecord): RoomCronJob {
    return {
        id: job.id,
        agentId: 'main',
        sessionKey: null,
        name: job.name,
        description: null,
        enabled: job.enabled,
        sessionTarget: 'isolated',
        wakeMode: 'now',
        everyMinutes: job.everyMinutes,
        schedule: job.schedule,
        timezone: job.timezone,
        scheduleSummary: describeJobSchedule(job.schedule),
        payloadSummary: job.message,
        nextRunAt: job.nextRunAt ? new Date(job.nextRunAt).getTime() : null,
        runningAt: job.runningAt ? new Date(job.runningAt).getTime() : null,
        lastRunAt: job.lastRunAt ? new Date(job.lastRunAt).getTime() : null,
        lastRunStatus: job.lastRunStatus,
        lastError: job.lastError,
        lastDurationMs: job.lastDurationMs,
    }
}

const jobColumns =
    'id, workspace_id, room_id, name, message, enabled, every_minutes, schedule, timezone, next_run_at, running_at, locked_until, lock_token, last_run_at, last_run_status, last_error, last_duration_ms, provider, model'

export async function listHostedCronJobs(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
}): Promise<HostedCronJobRecord[]> {
    const result = await input.env.AGENT_ROOM_DB.prepare(
        `SELECT ${jobColumns} FROM hosted_room_cron_job WHERE workspace_id = ?1 AND room_id = ?2 ORDER BY created_at DESC`,
    )
        .bind(input.workspaceId, input.roomId)
        .all<Row>()
    return (result.results ?? []).map(mapJobRow)
}

export async function findHostedCronJob(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    jobId: string
}): Promise<HostedCronJobRecord | null> {
    const row = await input.env.AGENT_ROOM_DB.prepare(
        `SELECT ${jobColumns} FROM hosted_room_cron_job WHERE workspace_id = ?1 AND room_id = ?2 AND id = ?3 LIMIT 1`,
    )
        .bind(input.workspaceId, input.roomId, input.jobId)
        .first<Row>()
    return row ? mapJobRow(row) : null
}

export async function createHostedCronJob(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    name: string
    message: string
    everyMinutes: number
    schedule: JobSchedule
    timezone: string
    nextRunAt: string
    provider: string | null
    model: string | null
}): Promise<HostedCronJobRecord> {
    const id = crypto.randomUUID()
    const now = nowIso()
    const row = await input.env.AGENT_ROOM_DB.prepare(
        `INSERT INTO hosted_room_cron_job
            (id, workspace_id, room_id, name, message, enabled, every_minutes, schedule, timezone, next_run_at, provider, model, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)
         RETURNING ${jobColumns}`,
    )
        .bind(
            id,
            input.workspaceId,
            input.roomId,
            input.name,
            input.message,
            input.everyMinutes,
            JSON.stringify(input.schedule),
            input.timezone,
            input.nextRunAt,
            input.provider,
            input.model,
            now,
        )
        .first<Row>()
    if (!row) {
        throw new Error('Failed to create hosted cron job')
    }
    return mapJobRow(row)
}

export async function updateHostedCronJob(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    jobId: string
    name: string
    message: string
    everyMinutes: number
    schedule: JobSchedule
    nextRunAt: string | null
    provider: string | null
    model: string | null
}): Promise<HostedCronJobRecord> {
    const row = await input.env.AGENT_ROOM_DB.prepare(
        `UPDATE hosted_room_cron_job
            SET name = ?4, message = ?5, every_minutes = ?6, schedule = ?7, next_run_at = ?8, provider = ?9, model = ?10, updated_at = ?11
         WHERE workspace_id = ?1 AND room_id = ?2 AND id = ?3
         RETURNING ${jobColumns}`,
    )
        .bind(
            input.workspaceId,
            input.roomId,
            input.jobId,
            input.name,
            input.message,
            input.everyMinutes,
            JSON.stringify(input.schedule),
            input.nextRunAt,
            input.provider,
            input.model,
            nowIso(),
        )
        .first<Row>()
    if (!row) {
        throw new Error(`Cron job ${input.jobId} does not exist`)
    }
    return mapJobRow(row)
}

export async function setHostedCronJobEnabled(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    jobId: string
    enabled: boolean
    nextRunAt: string | null
}): Promise<HostedCronJobRecord> {
    const row = await input.env.AGENT_ROOM_DB.prepare(
        `UPDATE hosted_room_cron_job
            SET enabled = ?4, next_run_at = ?5, updated_at = ?6
         WHERE workspace_id = ?1 AND room_id = ?2 AND id = ?3
         RETURNING ${jobColumns}`,
    )
        .bind(
            input.workspaceId,
            input.roomId,
            input.jobId,
            input.enabled ? 1 : 0,
            input.nextRunAt,
            nowIso(),
        )
        .first<Row>()
    if (!row) {
        throw new Error(`Cron job ${input.jobId} does not exist`)
    }
    return mapJobRow(row)
}

export async function removeHostedCronJob(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    jobId: string
}): Promise<boolean> {
    const result = await input.env.AGENT_ROOM_DB.prepare(
        `DELETE FROM hosted_room_cron_job WHERE workspace_id = ?1 AND room_id = ?2 AND id = ?3`,
    )
        .bind(input.workspaceId, input.roomId, input.jobId)
        .run()
    return (result.meta?.changes ?? 0) > 0
}

export async function claimHostedCronJob(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    jobId: string
    lockToken: string
    leaseUntil: string
}): Promise<HostedCronJobRecord | null> {
    const now = nowIso()
    const row = await input.env.AGENT_ROOM_DB.prepare(
        `UPDATE hosted_room_cron_job
            SET running_at = ?5, locked_until = ?6, lock_token = ?7, last_renewed_at = ?5, last_run_at = ?5, last_run_status = 'running', last_error = NULL, updated_at = ?5
         WHERE workspace_id = ?1 AND room_id = ?2 AND id = ?3
           AND (running_at IS NULL OR locked_until IS NULL OR locked_until <= ?4)
         RETURNING ${jobColumns}`,
    )
        .bind(
            input.workspaceId,
            input.roomId,
            input.jobId,
            now,
            now,
            input.leaseUntil,
            input.lockToken,
        )
        .first<Row>()
    return row ? mapJobRow(row) : null
}

export async function claimDueHostedCronJobs(input: {
    env: AgentRoomHostedEnv
    lockToken: string
    leaseUntil: string
    limit: number
}): Promise<HostedCronJobRecord[]> {
    if (input.limit <= 0) {
        return []
    }
    const now = nowIso()
    const result = await input.env.AGENT_ROOM_DB.prepare(
        `UPDATE hosted_room_cron_job
            SET running_at = ?1, locked_until = ?2, lock_token = ?3, last_renewed_at = ?1, last_run_at = ?1, last_run_status = 'running', last_error = NULL, updated_at = ?1
         WHERE id IN (
            SELECT id FROM hosted_room_cron_job
            WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?1
              AND (running_at IS NULL OR locked_until IS NULL OR locked_until <= ?1)
            ORDER BY next_run_at ASC
            LIMIT ?4
         )
         RETURNING ${jobColumns}`,
    )
        .bind(now, input.leaseUntil, input.lockToken, input.limit)
        .all<Row>()
    return (result.results ?? []).map(mapJobRow)
}

export async function finishHostedCronJob(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    jobId: string
    lockToken: string | null
    status: 'complete' | 'failed' | 'skipped'
    error: string | null
    durationMs: number
    nextRunAt: string | null
}): Promise<void> {
    const lockClause = input.lockToken ? 'AND lock_token = ?7' : ''
    const statement = input.env.AGENT_ROOM_DB.prepare(
        `UPDATE hosted_room_cron_job
            SET running_at = NULL, locked_until = NULL, lock_token = NULL, last_renewed_at = NULL,
                next_run_at = ?4, last_run_status = ?5, last_error = ?6, last_duration_ms = ?8, updated_at = ?9
         WHERE workspace_id = ?1 AND room_id = ?2 AND id = ?3 ${lockClause}`,
    )
    const now = nowIso()
    const bound = input.lockToken
        ? statement.bind(
              input.workspaceId,
              input.roomId,
              input.jobId,
              input.nextRunAt,
              input.status,
              input.error,
              input.lockToken,
              input.durationMs,
              now,
          )
        : statement.bind(
              input.workspaceId,
              input.roomId,
              input.jobId,
              input.nextRunAt,
              input.status,
              input.error,
              input.durationMs,
              now,
          )
    await bound.run()
}

export async function createHostedCronRun(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    jobId: string | null
    jobName: string | null
    status: HostedCronRunRecord['status']
    summary: string | null
    error: string | null
    sessionKey: string | null
    provider: string | null
    model: string | null
}): Promise<HostedCronRunRecord> {
    const id = crypto.randomUUID()
    const row = await input.env.AGENT_ROOM_DB.prepare(
        `INSERT INTO hosted_room_cron_run
            (id, workspace_id, room_id, job_id, job_name, status, summary, error, session_key, provider, model, started_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
         RETURNING id, room_id, job_id, job_name, status, summary, error, session_key, started_at, finished_at, duration_ms, next_run_at`,
    )
        .bind(
            id,
            input.workspaceId,
            input.roomId,
            input.jobId,
            input.jobName,
            input.status,
            input.summary,
            input.error,
            input.sessionKey,
            input.provider,
            input.model,
            nowIso(),
        )
        .first<Row>()
    if (!row) {
        throw new Error('Failed to create hosted cron run')
    }
    return mapRunRow(row)
}

export async function finishHostedCronRun(input: {
    env: AgentRoomHostedEnv
    runId: string
    status: 'complete' | 'failed' | 'skipped'
    error: string | null
    nextRunAt: string | null
}): Promise<void> {
    const existing = await input.env.AGENT_ROOM_DB.prepare(
        `SELECT started_at FROM hosted_room_cron_run WHERE id = ?1 LIMIT 1`,
    )
        .bind(input.runId)
        .first<Row>()
    const now = nowIso()
    const startedAt = existing ? asString(existing.started_at) : now
    const durationMs = Math.max(0, new Date(now).getTime() - new Date(startedAt).getTime())
    await input.env.AGENT_ROOM_DB.prepare(
        `UPDATE hosted_room_cron_run
            SET status = ?2, error = ?3, finished_at = ?4, duration_ms = ?5, next_run_at = ?6
         WHERE id = ?1`,
    )
        .bind(input.runId, input.status, input.error, now, durationMs, input.nextRunAt)
        .run()
}
