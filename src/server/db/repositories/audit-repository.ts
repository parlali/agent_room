import type { AuditEventRecord, JsonValue } from '../../domain/types'
import { sql } from '../client'
import { mapAudit } from './row-mappers'

export const auditRepository = {
    async appendEvent(input: {
        actorUserId: string | null
        roomId: string | null
        action: string
        payload: JsonValue
    }): Promise<AuditEventRecord> {
        const rows = await sql`
            INSERT INTO audit_events (actor_user_id, room_id, action, payload)
            VALUES (${input.actorUserId}, ${input.roomId}, ${input.action}, ${sql.json(input.payload)})
            RETURNING *
        `
        return mapAudit(rows[0] as Record<string, unknown>)
    },
}
