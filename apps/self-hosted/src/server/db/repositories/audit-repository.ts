import type { AuditEventRecord, JsonValue } from '#/domain/domain-types'
import { auditEvents } from '../schema'
import { mapAudit } from './row-mappers'
import { nowDate, repositoryDatabase } from './repository-utils'

export const auditRepository = {
    async appendEvent(input: {
        actorUserId: string | null
        roomId: string | null
        action: string
        payload: JsonValue
    }): Promise<AuditEventRecord> {
        const db = await repositoryDatabase()
        const [row] = await db
            .insert(auditEvents)
            .values({
                actorUserId: input.actorUserId,
                roomId: input.roomId,
                action: input.action,
                payload: input.payload,
                createdAt: nowDate(),
            })
            .returning()
        return mapAudit(row)
    },
}
