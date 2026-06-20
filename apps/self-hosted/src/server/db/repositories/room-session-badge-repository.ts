import { and, eq, sql } from 'drizzle-orm'
import { roomSessionBadgeState } from '../schema'
import { nowDate, repositoryDatabase } from './repository-utils'

export interface RoomSessionBadgeRecord {
    sessionKey: string
    completedClearedAt: Date
}

export const roomSessionBadgeRepository = {
    async listForRoom(input: {
        userId: string
        roomId: string
    }): Promise<RoomSessionBadgeRecord[]> {
        const db = await repositoryDatabase()
        const rows = await db
            .select({
                sessionKey: roomSessionBadgeState.sessionKey,
                completedClearedAt: roomSessionBadgeState.completedClearedAt,
            })
            .from(roomSessionBadgeState)
            .where(
                and(
                    eq(roomSessionBadgeState.userId, input.userId),
                    eq(roomSessionBadgeState.roomId, input.roomId),
                ),
            )

        return rows
    },

    async clearCompleted(input: {
        userId: string
        roomId: string
        sessionKey: string
        clearedAt: Date
    }): Promise<void> {
        const db = await repositoryDatabase()
        const now = nowDate()
        await db
            .insert(roomSessionBadgeState)
            .values({
                userId: input.userId,
                roomId: input.roomId,
                sessionKey: input.sessionKey,
                completedClearedAt: input.clearedAt,
                updatedAt: now,
            })
            .onConflictDoUpdate({
                target: [
                    roomSessionBadgeState.userId,
                    roomSessionBadgeState.roomId,
                    roomSessionBadgeState.sessionKey,
                ],
                set: {
                    completedClearedAt: sql`max(${roomSessionBadgeState.completedClearedAt}, excluded.completed_cleared_at)`,
                    updatedAt: now,
                },
            })
    },
}
