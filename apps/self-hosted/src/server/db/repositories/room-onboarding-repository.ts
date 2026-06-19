import { eq } from 'drizzle-orm'
import type { RoomOnboardingRecord, RoomOnboardingStatus } from '#/domain/domain-types'
import { roomOnboarding } from '../schema'
import { mapRoomOnboarding } from './row-mappers'
import { nowDate, repositoryDatabase } from './repository-utils'

export const roomOnboardingRepository = {
    async getOrCreate(roomId: string): Promise<RoomOnboardingRecord> {
        const existing = await this.findByRoomId(roomId)
        if (existing) {
            return existing
        }

        const db = await repositoryDatabase()
        const now = nowDate()
        const [created] = await db
            .insert(roomOnboarding)
            .values({
                roomId,
                status: 'pending',
                createdAt: now,
                updatedAt: now,
            })
            .onConflictDoNothing()
            .returning()
        if (created) {
            return mapRoomOnboarding(created)
        }

        const fallback = await this.findByRoomId(roomId)
        if (!fallback) {
            throw new Error(`Room onboarding row missing for ${roomId}`)
        }
        return fallback
    },

    async findByRoomId(roomId: string): Promise<RoomOnboardingRecord | null> {
        const db = await repositoryDatabase()
        const [row] = await db
            .select()
            .from(roomOnboarding)
            .where(eq(roomOnboarding.roomId, roomId))
            .limit(1)
        return row ? mapRoomOnboarding(row) : null
    },

    async update(input: {
        roomId: string
        status: RoomOnboardingStatus
        sessionKey?: string | null
        completedAt?: Date | null
        deferredAt?: Date | null
    }): Promise<RoomOnboardingRecord> {
        const values: Partial<typeof roomOnboarding.$inferInsert> = {
            status: input.status,
            updatedAt: nowDate(),
        }
        if (Object.hasOwn(input, 'sessionKey')) {
            values.sessionKey = input.sessionKey ?? null
        }
        if (Object.hasOwn(input, 'completedAt')) {
            values.completedAt = input.completedAt ?? null
        }
        if (Object.hasOwn(input, 'deferredAt')) {
            values.deferredAt = input.deferredAt ?? null
        }

        const db = await repositoryDatabase()
        const [row] = await db
            .update(roomOnboarding)
            .set(values)
            .where(eq(roomOnboarding.roomId, input.roomId))
            .returning()
        if (!row) {
            throw new Error(`Room onboarding row missing for ${input.roomId}`)
        }
        return mapRoomOnboarding(row)
    },
}
