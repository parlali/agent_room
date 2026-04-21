import { auditRepository, roomRepository } from '../db/repositories'
import { assertRoomConfigurationStartable } from '../configuration/operator-configuration'
import { roomProcessSnapshot, startRoomProcess, stopRoomProcess } from './runtime-lifecycle'

async function assertRoomStartable(roomId: string, actorUserId: string | null): Promise<void> {
    try {
        await assertRoomConfigurationStartable(roomId)
    } catch (error) {
        const message = error instanceof Error ? error.message : 'room configuration is blocked'
        await roomRepository.updateRoomStatus(roomId, 'failed')
        await auditRepository.appendEvent({
            actorUserId,
            roomId,
            action: 'room.runtime_start_blocked',
            payload: {
                error: message,
            },
        })
        throw error
    }
}

export const roomRuntimeManager = {
    async reconcileRoom(roomId: string, actorUserId: string | null) {
        const room = await roomRepository.findRoomById(roomId)
        if (!room) {
            throw new Error(`Room ${roomId} not found`)
        }

        if (room.desiredState === 'running') {
            await assertRoomStartable(roomId, actorUserId)
            await startRoomProcess(room)
            await auditRepository.appendEvent({
                actorUserId,
                roomId,
                action: 'room.runtime_reconciled_running',
                payload: {},
            })
            return
        }

        await stopRoomProcess(room.id, actorUserId)
        await auditRepository.appendEvent({
            actorUserId,
            roomId,
            action: 'room.runtime_reconciled_stopped',
            payload: {},
        })
    },

    async startRoom(roomId: string, actorUserId: string | null) {
        await assertRoomStartable(roomId, actorUserId)
        await roomRepository.updateRoomDesiredState(roomId, 'running')
        await roomRuntimeManager.reconcileRoom(roomId, actorUserId)
    },

    async stopRoom(roomId: string, actorUserId: string | null) {
        await roomRepository.updateRoomDesiredState(roomId, 'stopped')
        await roomRuntimeManager.reconcileRoom(roomId, actorUserId)
    },

    async roomProcessSnapshot(roomId: string) {
        return roomProcessSnapshot(roomId)
    },
}
