import { eq } from 'drizzle-orm'
import { auditEvents, rooms } from '../db/schema'
import { nowDate, repositoryBatch, repositoryDatabase } from '../db/repositories/repository-utils'

export async function markRoomSetupRequired(input: {
    roomId: string
    actorUserId: string | null
    trigger: string
    error?: string | null
}): Promise<void> {
    const db = await repositoryDatabase()
    const now = nowDate()
    await repositoryBatch([
        db
            .update(rooms)
            .set({
                status: 'setup_required',
                updatedAt: now,
            })
            .where(eq(rooms.id, input.roomId)),
        db.insert(auditEvents).values({
            actorUserId: input.actorUserId,
            roomId: input.roomId,
            action: 'room.runtime_start_blocked',
            payload: {
                trigger: input.trigger,
                ...(input.error ? { error: input.error } : {}),
            },
            createdAt: now,
        }),
    ])
}
