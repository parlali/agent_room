import { auditRepository, roomRepository } from '../db/repositories'

export async function markRoomSetupRequired(input: {
    roomId: string
    actorUserId: string | null
    trigger: string
    error?: string | null
}): Promise<void> {
    await roomRepository.updateRoomStatus(input.roomId, 'setup_required')
    await auditRepository.appendEvent({
        actorUserId: input.actorUserId,
        roomId: input.roomId,
        action: 'room.runtime_start_blocked',
        payload: {
            trigger: input.trigger,
            ...(input.error ? { error: input.error } : {}),
        },
    })
}
