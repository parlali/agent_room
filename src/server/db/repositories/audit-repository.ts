import type { AuditEventRecord, JsonValue } from '../../domain/types'
import { sql, type DatabaseQuery } from '../client'
import { mapAudit } from './row-mappers'

export const auditRepository = {
    async appendEvent(
        input: {
            actorUserId: string | null
            roomId: string | null
            action: string
            payload: JsonValue
        },
        query: DatabaseQuery = sql,
    ): Promise<AuditEventRecord> {
        const rows = await query`
            INSERT INTO audit_events (actor_user_id, room_id, action, payload)
            VALUES (${input.actorUserId}, ${input.roomId}, ${input.action}, ${query.json(input.payload)})
            RETURNING *
        `
        return mapAudit(rows[0] as Record<string, unknown>)
    },
}
