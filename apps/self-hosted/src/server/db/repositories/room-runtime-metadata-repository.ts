import { eq, sql } from 'drizzle-orm'
import type { HealthStatus, RoomRuntimeMetadataRecord } from '#/domain/domain-types'
import { roomRuntimeMetadata } from '../schema'
import { mapRuntimeMetadata } from './row-mappers'
import { excluded, nowDate, repositoryDatabase } from './repository-utils'

export const roomRuntimeMetadataRepository = {
    async findByRoomId(roomId: string): Promise<RoomRuntimeMetadataRecord | null> {
        const db = await repositoryDatabase()
        const [row] = await db
            .select()
            .from(roomRuntimeMetadata)
            .where(eq(roomRuntimeMetadata.roomId, roomId))
            .limit(1)
        return row ? mapRuntimeMetadata(row) : null
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
        const db = await repositoryDatabase()
        const now = nowDate()
        const [row] = await db
            .insert(roomRuntimeMetadata)
            .values({
                roomId: input.roomId,
                port: input.port,
                pid: input.pid,
                sandboxUid: input.sandboxUid ?? null,
                sandboxGid: input.sandboxGid ?? null,
                sandboxUserName: input.sandboxUserName ?? null,
                sandboxGroupName: input.sandboxGroupName ?? null,
                configVersion: input.configVersion,
                tokenVersion: input.tokenVersion,
                healthStatus: input.healthStatus,
                startedAt: input.startedAt,
                lastHealthAt: input.lastHealthAt,
                lastError: input.lastError,
                updatedAt: now,
            })
            .onConflictDoUpdate({
                target: roomRuntimeMetadata.roomId,
                set: {
                    port: excluded('port'),
                    pid: excluded('pid'),
                    sandboxUid: sql`COALESCE(excluded.sandbox_uid, ${roomRuntimeMetadata.sandboxUid})`,
                    sandboxGid: sql`COALESCE(excluded.sandbox_gid, ${roomRuntimeMetadata.sandboxGid})`,
                    sandboxUserName: sql`COALESCE(excluded.sandbox_user_name, ${roomRuntimeMetadata.sandboxUserName})`,
                    sandboxGroupName: sql`COALESCE(excluded.sandbox_group_name, ${roomRuntimeMetadata.sandboxGroupName})`,
                    configVersion: excluded('config_version'),
                    tokenVersion: excluded('token_version'),
                    healthStatus: excluded('health_status'),
                    startedAt: excluded('started_at'),
                    lastHealthAt: excluded('last_health_at'),
                    lastError: excluded('last_error'),
                    updatedAt: now,
                },
            })
            .returning()
        return mapRuntimeMetadata(row)
    },

    async deleteByRoomId(roomId: string): Promise<void> {
        const db = await repositoryDatabase()
        await db.delete(roomRuntimeMetadata).where(eq(roomRuntimeMetadata.roomId, roomId))
    },

    async clearLastError(roomId: string): Promise<void> {
        const db = await repositoryDatabase()
        await db
            .update(roomRuntimeMetadata)
            .set({
                lastError: null,
                healthStatus: 'unknown',
                updatedAt: nowDate(),
            })
            .where(eq(roomRuntimeMetadata.roomId, roomId))
    },
}
