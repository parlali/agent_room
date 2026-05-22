import type { RoomOnboardingRecord, RoomOnboardingStatus } from '#/domain/domain-types'
import { sql } from '../client'
import { mapRoomOnboarding } from './row-mappers'

export const roomOnboardingRepository = {
    async getOrCreate(roomId: string): Promise<RoomOnboardingRecord> {
        const existing = await this.findByRoomId(roomId)
        if (existing) {
            return existing
        }
        const rows = await sql`
            INSERT INTO room_onboarding (room_id, status)
            VALUES (${roomId}, 'pending')
            ON CONFLICT (room_id) DO NOTHING
            RETURNING *
        `
        if (rows.length > 0) {
            return mapRoomOnboarding(rows[0] as Record<string, unknown>)
        }
        const fallback = await this.findByRoomId(roomId)
        if (!fallback) {
            throw new Error(`Room onboarding row missing for ${roomId}`)
        }
        return fallback
    },

    async findByRoomId(roomId: string): Promise<RoomOnboardingRecord | null> {
        const rows = await sql`SELECT * FROM room_onboarding WHERE room_id = ${roomId} LIMIT 1`
        if (rows.length === 0) {
            return null
        }
        return mapRoomOnboarding(rows[0] as Record<string, unknown>)
    },

    async update(input: {
        roomId: string
        status: RoomOnboardingStatus
        sessionKey?: string | null
        completedAt?: Date | null
        deferredAt?: Date | null
    }): Promise<RoomOnboardingRecord> {
        const hasSessionKey = Object.hasOwn(input, 'sessionKey')
        const hasCompletedAt = Object.hasOwn(input, 'completedAt')
        const hasDeferredAt = Object.hasOwn(input, 'deferredAt')
        const rows = await sql`
            UPDATE room_onboarding
            SET
                status = ${input.status},
                session_key = CASE
                    WHEN ${hasSessionKey} THEN ${input.sessionKey ?? null}
                    ELSE session_key
                END,
                completed_at = CASE
                    WHEN ${hasCompletedAt} THEN ${input.completedAt ?? null}
                    ELSE completed_at
                END,
                deferred_at = CASE
                    WHEN ${hasDeferredAt} THEN ${input.deferredAt ?? null}
                    ELSE deferred_at
                END,
                updated_at = now()
            WHERE room_id = ${input.roomId}
            RETURNING *
        `
        if (rows.length === 0) {
            throw new Error(`Room onboarding row missing for ${input.roomId}`)
        }
        return mapRoomOnboarding(rows[0] as Record<string, unknown>)
    },
}
