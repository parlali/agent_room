import type { HealthStatus, RoomRuntimeMetadataRecord } from '../../domain/types'
import { sql } from '../client'
import { mapRuntimeMetadata } from './row-mappers'

export const roomRuntimeMetadataRepository = {
    async findByRoomId(roomId: string): Promise<RoomRuntimeMetadataRecord | null> {
        const rows =
            await sql`SELECT * FROM room_runtime_metadata WHERE room_id = ${roomId} LIMIT 1`
        if (rows.length === 0) {
            return null
        }
        return mapRuntimeMetadata(rows[0] as Record<string, unknown>)
    },

    async upsert(input: {
        roomId: string
        port: number | null
        pid: number | null
        sandboxUid?: number | null
        sandboxGid?: number | null
        sandboxUserName?: string | null
        sandboxGroupName?: string | null
        configVersion: number
        tokenVersion: number
        healthStatus: HealthStatus
        startedAt: Date | null
        lastHealthAt: Date | null
        lastError: string | null
    }): Promise<RoomRuntimeMetadataRecord> {
        const rows = await sql`
            INSERT INTO room_runtime_metadata (
                room_id,
                port,
                pid,
                sandbox_uid,
                sandbox_gid,
                sandbox_user_name,
                sandbox_group_name,
                config_version,
                token_version,
                health_status,
                started_at,
                last_health_at,
                last_error,
                updated_at
            )
            VALUES (
                ${input.roomId},
                ${input.port},
                ${input.pid},
                ${input.sandboxUid ?? null},
                ${input.sandboxGid ?? null},
                ${input.sandboxUserName ?? null},
                ${input.sandboxGroupName ?? null},
                ${input.configVersion},
                ${input.tokenVersion},
                ${input.healthStatus},
                ${input.startedAt},
                ${input.lastHealthAt},
                ${input.lastError},
                now()
            )
            ON CONFLICT (room_id)
            DO UPDATE SET
                port = excluded.port,
                pid = excluded.pid,
                sandbox_uid = COALESCE(excluded.sandbox_uid, room_runtime_metadata.sandbox_uid),
                sandbox_gid = COALESCE(excluded.sandbox_gid, room_runtime_metadata.sandbox_gid),
                sandbox_user_name = COALESCE(excluded.sandbox_user_name, room_runtime_metadata.sandbox_user_name),
                sandbox_group_name = COALESCE(excluded.sandbox_group_name, room_runtime_metadata.sandbox_group_name),
                config_version = excluded.config_version,
                token_version = excluded.token_version,
                health_status = excluded.health_status,
                started_at = excluded.started_at,
                last_health_at = excluded.last_health_at,
                last_error = excluded.last_error,
                updated_at = now()
            RETURNING *
        `
        return mapRuntimeMetadata(rows[0] as Record<string, unknown>)
    },

    async deleteByRoomId(roomId: string): Promise<void> {
        await sql`DELETE FROM room_runtime_metadata WHERE room_id = ${roomId}`
    },

    async clearLastError(roomId: string): Promise<void> {
        await sql`
            UPDATE room_runtime_metadata
            SET last_error = NULL, health_status = 'unknown', updated_at = now()
            WHERE room_id = ${roomId}
        `
    },
}
