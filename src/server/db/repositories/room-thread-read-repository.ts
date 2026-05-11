import { sql } from '../client'

export interface RoomThreadReadRecord {
    sessionKey: string
    readAt: Date
}

export const roomThreadReadRepository = {
    async listForRoom(input: { userId: string; roomId: string }): Promise<RoomThreadReadRecord[]> {
        const rows = await sql`
            SELECT session_key, read_at
            FROM room_thread_read_state
            WHERE user_id = ${input.userId}
              AND room_id = ${input.roomId}
        `
        return rows.map((row) => ({
            sessionKey: String(row.session_key),
            readAt: new Date(String(row.read_at)),
        }))
    },

    async markRead(input: {
        userId: string
        roomId: string
        sessionKey: string
        readAt: Date
    }): Promise<void> {
        await sql`
            INSERT INTO room_thread_read_state (user_id, room_id, session_key, read_at)
            VALUES (${input.userId}, ${input.roomId}, ${input.sessionKey}, ${input.readAt})
            ON CONFLICT (user_id, room_id, session_key)
            DO UPDATE SET
                read_at = greatest(room_thread_read_state.read_at, excluded.read_at),
                updated_at = now()
        `
    },
}
