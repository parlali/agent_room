import type { RoomEntitlementRecord } from '../../domain/types'
import { sql } from '../client'
import { mapEntitlement } from './row-mappers'

export const roomEntitlementRepository = {
    async listActiveByRoomId(roomId: string): Promise<RoomEntitlementRecord[]> {
        const rows = await sql`
            SELECT *
            FROM room_entitlements
            WHERE room_id = ${roomId}
              AND status = 'active'
            ORDER BY created_at ASC
        `
        return rows.map((row) => mapEntitlement(row as Record<string, unknown>))
    },
}
