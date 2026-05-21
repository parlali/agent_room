import { auditRepository, roomRepository } from '../db/repositories'
import { roomRuntimeManager } from './runtime-manager'

export type RoomAutostartTrigger =
    | 'room_config_saved'
    | 'room_created'
    | 'supervisor_reconcile'
    | 'runtime_recovered'
    | 'codex_oauth_completed'

export async function reconcileRoomAutostart(input: {
    roomId: string
    actorUserId: string | null
    trigger: RoomAutostartTrigger
}): Promise<{ started: boolean; blocked: boolean; skipped: boolean }> {
    const room = await roomRepository.findRoomById(input.roomId)
    if (!room) {
        throw new Error(`Room ${input.roomId} not found`)
    }

    if (room.desiredState !== 'running') {
        return { started: false, blocked: false, skipped: true }
    }

    try {
        const result = await roomRuntimeManager.reconcileRoom(input.roomId, input.actorUserId, {
            restartRunning: input.trigger === 'room_config_saved',
            blockedTrigger: input.trigger,
        })
        if (result.blocked) {
            return { started: false, blocked: true, skipped: false }
        }
        const changedRuntime = result.started || result.restarted
        if (changedRuntime) {
            await auditRepository.appendEvent({
                actorUserId: input.actorUserId,
                roomId: input.roomId,
                action: 'room.runtime_autostart',
                payload: {
                    trigger: input.trigger,
                    restarted: result.restarted,
                },
            })
        }
        return { started: changedRuntime, blocked: false, skipped: !changedRuntime }
    } catch (error) {
        const originalError = error
        const message = error instanceof Error ? error.message : 'runtime autostart failed'
        try {
            await auditRepository.appendEvent({
                actorUserId: input.actorUserId,
                roomId: input.roomId,
                action: 'room.runtime_autostart_failed',
                payload: {
                    trigger: input.trigger,
                    error: message,
                },
            })
        } catch (auditError) {
            console.error(
                `Failed to audit runtime autostart failure for room ${input.roomId}`,
                auditError instanceof Error ? auditError.message : auditError,
            )
        }
        throw originalError
    }
}
