import type { RoomDesiredState, RoomRecord, RoomStatus } from '#/domain/domain-types'
import { sql, type DatabaseQuery } from '../client'
import { mapRoom } from './row-mappers'

export const roomRepository = {
    async createRoom(input: {
        slug: string
        displayName: string
        desiredState: RoomDesiredState
        createdByUserId: string
    }): Promise<RoomRecord> {
        const rows = await sql`
            INSERT INTO rooms (slug, display_name, status, desired_state, created_by_user_id)
            VALUES (${input.slug}, ${input.displayName}, 'stopped', ${input.desiredState}, ${input.createdByUserId})
            RETURNING *
        `
        const room = mapRoom(rows[0] as Record<string, unknown>)
        await sql`INSERT INTO room_runtime_metadata (room_id) VALUES (${room.id}) ON CONFLICT (room_id) DO NOTHING`
        return room
    },

    async listRooms(): Promise<RoomRecord[]> {
        const rows = await sql`SELECT * FROM rooms ORDER BY created_at DESC`
        return rows.map((row) => mapRoom(row as Record<string, unknown>))
    },

    async findRoomById(roomId: string): Promise<RoomRecord | null> {
        const rows = await sql`SELECT * FROM rooms WHERE id = ${roomId} LIMIT 1`
        if (rows.length === 0) {
            return null
        }
        return mapRoom(rows[0] as Record<string, unknown>)
    },

    async deleteRoom(roomId: string): Promise<void> {
        await sql`DELETE FROM rooms WHERE id = ${roomId}`
    },

    async updateRoomIdentity(input: {
        roomId: string
        slug: string
        displayName: string
    }): Promise<RoomRecord> {
        const rows = await sql`
            UPDATE rooms
            SET slug = ${input.slug}, display_name = ${input.displayName}, updated_at = now()
            WHERE id = ${input.roomId}
            RETURNING *
        `
        if (rows.length === 0) {
            throw new Error('Room not found')
        }
        return mapRoom(rows[0] as Record<string, unknown>)
    },

    async updateRoomStatus(
        roomId: string,
        status: RoomStatus,
        query: DatabaseQuery = sql,
    ): Promise<void> {
        await query`UPDATE rooms SET status = ${status}, updated_at = now() WHERE id = ${roomId}`
    },

    async updateRoomDesiredState(roomId: string, desiredState: RoomDesiredState): Promise<void> {
        await sql`UPDATE rooms SET desired_state = ${desiredState}, updated_at = now() WHERE id = ${roomId}`
    },
}
