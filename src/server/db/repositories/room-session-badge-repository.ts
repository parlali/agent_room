import { sql } from '../client'

export interface RoomSessionBadgeRecord {
    sessionKey: string
    completedClearedAt: Date
}

export const roomSessionBadgeRepository = {
    async listForRoom(input: {
        userId: string
        roomId: string
    }): Promise<RoomSessionBadgeRecord[]> {
        const rows = await sql`
            SELECT session_key, completed_cleared_at
            FROM room_session_badge_state
            WHERE user_id = ${input.userId}
              AND room_id = ${input.roomId}
        `
        return rows.map((row) => ({
            sessionKey: String(row.session_key),
            completedClearedAt: new Date(String(row.completed_cleared_at)),
        }))
    },

    async clearCompleted(input: {
        userId: string
        roomId: string
        sessionKey: string
        clearedAt: Date
    }): Promise<void> {
        await sql`
            INSERT INTO room_session_badge_state (user_id, room_id, session_key, completed_cleared_at)
            VALUES (${input.userId}, ${input.roomId}, ${input.sessionKey}, ${input.clearedAt})
            ON CONFLICT (user_id, room_id, session_key)
            DO UPDATE SET
                completed_cleared_at = greatest(room_session_badge_state.completed_cleared_at, excluded.completed_cleared_at),
                updated_at = now()
        `
    },
}
