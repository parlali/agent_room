import type { RoomCronJobRecord, RoomCronRunRecord } from '../../domain/types'
import { sql } from '../client'
import { mapRoomCronJob, mapRoomCronRun } from './row-mappers'

export const roomCronRepository = {
    async listJobsByRoomId(roomId: string): Promise<RoomCronJobRecord[]> {
        const rows = await sql`
            SELECT *
            FROM room_cron_jobs
            WHERE room_id = ${roomId}
            ORDER BY created_at DESC
        `
        return rows.map((row) => mapRoomCronJob(row as Record<string, unknown>))
    },

    async findJobById(input: { roomId: string; jobId: string }): Promise<RoomCronJobRecord | null> {
        const rows = await sql`
            SELECT *
            FROM room_cron_jobs
            WHERE room_id = ${input.roomId} AND id = ${input.jobId}
            LIMIT 1
        `
        return rows[0] ? mapRoomCronJob(rows[0] as Record<string, unknown>) : null
    },

    async createJob(input: {
        roomId: string
        name: string
        message: string
        everyMinutes: number
        timezone: string
        nextRunAt: Date
        provider: string | null
        model: string | null
        configVersion: number | null
    }): Promise<RoomCronJobRecord> {
        const rows = await sql`
            INSERT INTO room_cron_jobs (
                room_id,
                name,
                message,
                every_minutes,
                timezone,
                next_run_at,
                provider,
                model,
                config_version
            )
            VALUES (
                ${input.roomId},
                ${input.name},
                ${input.message},
                ${input.everyMinutes},
                ${input.timezone},
                ${input.nextRunAt},
                ${input.provider},
                ${input.model},
                ${input.configVersion}
            )
            RETURNING *
        `
        return mapRoomCronJob(rows[0] as Record<string, unknown>)
    },

    async setJobEnabled(input: {
        roomId: string
        jobId: string
        enabled: boolean
        nextRunAt: Date | null
    }): Promise<RoomCronJobRecord> {
        const rows = await sql`
            UPDATE room_cron_jobs
            SET
                enabled = ${input.enabled},
                next_run_at = ${input.nextRunAt},
                updated_at = now()
            WHERE room_id = ${input.roomId} AND id = ${input.jobId}
            RETURNING *
        `
        if (!rows[0]) {
            throw new Error(`Cron job ${input.jobId} does not exist`)
        }
        return mapRoomCronJob(rows[0] as Record<string, unknown>)
    },

    async updateJob(input: {
        roomId: string
        jobId: string
        name: string
        message: string
        everyMinutes: number
        nextRunAt: Date | null
        provider: string | null
        model: string | null
        configVersion: number | null
    }): Promise<RoomCronJobRecord> {
        const rows = await sql`
            UPDATE room_cron_jobs
            SET
                name = ${input.name},
                message = ${input.message},
                every_minutes = ${input.everyMinutes},
                next_run_at = ${input.nextRunAt},
                provider = ${input.provider},
                model = ${input.model},
                config_version = ${input.configVersion},
                updated_at = now()
            WHERE room_id = ${input.roomId} AND id = ${input.jobId}
            RETURNING *
        `
        if (!rows[0]) {
            throw new Error(`Cron job ${input.jobId} does not exist`)
        }
        return mapRoomCronJob(rows[0] as Record<string, unknown>)
    },

    async removeJob(input: { roomId: string; jobId: string }): Promise<boolean> {
        const rows = await sql`
            DELETE FROM room_cron_jobs
            WHERE room_id = ${input.roomId} AND id = ${input.jobId}
            RETURNING id
        `
        return rows.length > 0
    },

    async claimJob(input: {
        roomId: string
        jobId: string
        lockToken: string
        lockedUntil: Date
    }): Promise<RoomCronJobRecord | null> {
        const rows = await sql`
            UPDATE room_cron_jobs
            SET
                running_at = now(),
                locked_until = ${input.lockedUntil},
                lock_token = ${input.lockToken},
                last_run_at = now(),
                last_run_status = 'running',
                last_error = NULL,
                updated_at = now()
            WHERE
                room_id = ${input.roomId}
                AND id = ${input.jobId}
                AND (running_at IS NULL OR locked_until < now())
            RETURNING *
        `
        return rows[0] ? mapRoomCronJob(rows[0] as Record<string, unknown>) : null
    },

    async claimDueJobs(input: {
        lockToken: string
        lockedUntil: Date
        limit: number
    }): Promise<RoomCronJobRecord[]> {
        const rows = await sql`
            WITH due AS (
                SELECT id
                FROM room_cron_jobs
                WHERE
                    enabled = true
                    AND next_run_at IS NOT NULL
                    AND next_run_at <= now()
                    AND (running_at IS NULL OR locked_until < now())
                ORDER BY next_run_at ASC
                LIMIT ${input.limit}
                FOR UPDATE SKIP LOCKED
            )
            UPDATE room_cron_jobs AS job
            SET
                running_at = now(),
                locked_until = ${input.lockedUntil},
                lock_token = ${input.lockToken},
                last_run_at = now(),
                last_run_status = 'running',
                last_error = NULL,
                updated_at = now()
            FROM due
            WHERE job.id = due.id
            RETURNING job.*
        `
        return rows.map((row) => mapRoomCronJob(row as Record<string, unknown>))
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
        const rows = await sql`
            UPDATE room_cron_jobs
            SET
                running_at = NULL,
                locked_until = NULL,
                lock_token = NULL,
                next_run_at = ${input.nextRunAt},
                last_run_status = ${input.status},
                last_error = ${input.error},
                last_duration_ms = ${input.durationMs},
                updated_at = now()
            WHERE
                room_id = ${input.roomId}
                AND id = ${input.jobId}
                AND (${input.lockToken}::text IS NULL OR lock_token = ${input.lockToken})
            RETURNING *
        `
        return rows[0] ? mapRoomCronJob(rows[0] as Record<string, unknown>) : null
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
        const rows = await sql`
            INSERT INTO room_cron_runs (
                room_id,
                job_id,
                job_name,
                status,
                summary,
                error,
                session_key,
                session_id,
                provider,
                model,
                config_version
            )
            VALUES (
                ${input.roomId},
                ${input.jobId},
                ${input.jobName},
                ${input.status},
                ${input.summary},
                ${input.error},
                ${input.sessionKey},
                ${input.sessionId},
                ${input.provider},
                ${input.model},
                ${input.configVersion}
            )
            RETURNING *
        `
        return mapRoomCronRun(rows[0] as Record<string, unknown>)
    },

    async finishRun(input: {
        runId: string
        status: 'complete' | 'failed' | 'skipped'
        error: string | null
        nextRunAt: Date | null
    }): Promise<RoomCronRunRecord> {
        const rows = await sql`
            UPDATE room_cron_runs
            SET
                status = ${input.status},
                error = ${input.error},
                finished_at = now(),
                duration_ms = GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - started_at)) * 1000))::integer,
                next_run_at = ${input.nextRunAt}
            WHERE id = ${input.runId}
            RETURNING *
        `
        if (!rows[0]) {
            throw new Error(`Cron run ${input.runId} does not exist`)
        }
        return mapRoomCronRun(rows[0] as Record<string, unknown>)
    },

    async listRunsByRoomId(input: { roomId: string; limit: number }): Promise<RoomCronRunRecord[]> {
        const rows = await sql`
            SELECT *
            FROM room_cron_runs
            WHERE room_id = ${input.roomId}
            ORDER BY started_at DESC
            LIMIT ${input.limit}
        `
        return rows.map((row) => mapRoomCronRun(row as Record<string, unknown>))
    },
}
