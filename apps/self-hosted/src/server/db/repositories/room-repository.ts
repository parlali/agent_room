import { desc, eq } from 'drizzle-orm'
import type { RoomDesiredState, RoomRecord, RoomStatus } from '#/domain/domain-types'
import { roomRuntimeMetadata, rooms } from '../schema'
import { mapRoom } from './row-mappers'
import { createDatabaseId, nowDate, repositoryBatch, repositoryDatabase } from './repository-utils'

export const roomRepository = {
    async createRoom(input: {
        slug: string
        displayName: string
        desiredState: RoomDesiredState
        createdByUserId: string
    }): Promise<RoomRecord> {
        const db = await repositoryDatabase()
        const id = createDatabaseId()
        const now = nowDate()
        const [roomRows] = await repositoryBatch([
            db
                .insert(rooms)
                .values({
                    id,
                    slug: input.slug,
                    displayName: input.displayName,
                    status: 'stopped',
                    desiredState: input.desiredState,
                    createdByUserId: input.createdByUserId,
                    createdAt: now,
                    updatedAt: now,
                })
                .returning(),
            db
                .insert(roomRuntimeMetadata)
                .values({ roomId: id, updatedAt: now })
                .onConflictDoNothing(),
        ])
        const [row] = roomRows as Array<typeof rooms.$inferSelect>
        return mapRoom(row)
    },

    async listRooms(): Promise<RoomRecord[]> {
        const db = await repositoryDatabase()
        const rows = await db.select().from(rooms).orderBy(desc(rooms.createdAt))
        return rows.map(mapRoom)
    },

    async findRoomById(roomId: string): Promise<RoomRecord | null> {
        const db = await repositoryDatabase()
        const [row] = await db.select().from(rooms).where(eq(rooms.id, roomId)).limit(1)
        return row ? mapRoom(row) : null
    },

    async deleteRoom(roomId: string): Promise<void> {
        const db = await repositoryDatabase()
        await db.delete(rooms).where(eq(rooms.id, roomId))
    },

    async updateRoomIdentity(input: {
        roomId: string
        slug: string
        displayName: string
    }): Promise<RoomRecord> {
        const db = await repositoryDatabase()
        const [row] = await db
            .update(rooms)
            .set({
                slug: input.slug,
                displayName: input.displayName,
                updatedAt: nowDate(),
            })
            .where(eq(rooms.id, input.roomId))
            .returning()
        if (!row) {
            throw new Error('Room not found')
        }
        return mapRoom(row)
    },

    async updateRoomStatus(roomId: string, status: RoomStatus): Promise<void> {
        const db = await repositoryDatabase()
        await db
            .update(rooms)
            .set({
                status,
                updatedAt: nowDate(),
            })
            .where(eq(rooms.id, roomId))
    },

    async updateRoomDesiredState(roomId: string, desiredState: RoomDesiredState): Promise<void> {
        const db = await repositoryDatabase()
        await db
            .update(rooms)
            .set({
                desiredState,
                updatedAt: nowDate(),
            })
            .where(eq(rooms.id, roomId))
    },
}
