import { auditRepository, roomRepository } from '../db/repositories'
import { assertRoomConfigurationStartable } from '../configuration/operator-configuration'
import { markRoomSetupRequired } from './runtime-setup-state'
import { ensureRoomOnboardingStarted } from './room-onboarding'
import { roomProcessSnapshot, startRoomProcess, stopRoomProcess } from './runtime-lifecycle'

export interface RuntimeReconcileResult {
    started: boolean
    restarted: boolean
    blocked: boolean
    skipped: boolean
}

export const roomRuntimeManager = {
    async reconcileRoom(
        roomId: string,
        actorUserId: string | null,
        options: {
            restartRunning?: boolean
            blockedTrigger?: string
        } = {},
    ): Promise<RuntimeReconcileResult> {
        const room = await roomRepository.findRoomById(roomId)
        if (!room) {
            throw new Error(`Room ${roomId} not found`)
        }

        if (room.desiredState !== 'running') {
            await stopRoomProcess(room.id, actorUserId)
            await auditRepository.appendEvent({
                actorUserId,
                roomId,
                action: 'room.runtime_reconciled_stopped',
                payload: {},
            })
            return { started: false, restarted: false, blocked: false, skipped: false }
        }

        try {
            await assertRoomConfigurationStartable(roomId)
        } catch (error) {
            const process = await roomProcessSnapshot(roomId)
            if (process.running) {
                await stopRoomProcess(roomId, actorUserId, {
                    restartIfDesired: false,
                })
            }
            await markRoomSetupRequired({
                roomId,
                actorUserId,
                trigger: options.blockedTrigger ?? 'runtime_start',
                error: error instanceof Error ? error.message : 'room configuration is blocked',
            })
            return { started: false, restarted: false, blocked: true, skipped: false }
        }

        if (room.status === 'setup_required') {
            await roomRepository.updateRoomStatus(roomId, 'stopped')
        }

        const latest = await roomRepository.findRoomById(roomId)
        if (!latest) {
            return { started: false, restarted: false, blocked: false, skipped: true }
        }

        const process = await roomProcessSnapshot(roomId)
        let started = false
        let restarted = false
        if (process.running && options.restartRunning === true) {
            await stopRoomProcess(roomId, actorUserId, {
                restartIfDesired: false,
            })
            const afterStop = await roomRepository.findRoomById(roomId)
            if (afterStop) {
                await startRoomProcess(afterStop)
                restarted = true
            }
        } else if (!process.running) {
            await startRoomProcess(latest)
            started = true
        }

        await auditRepository.appendEvent({
            actorUserId,
            roomId,
            action: 'room.runtime_reconciled_running',
            payload: {},
        })

        void ensureRoomOnboardingStarted(roomId).catch((error) => {
            console.error(
                `Failed to start onboarding for room ${roomId}`,
                error instanceof Error ? error.message : error,
            )
        })

        return {
            started,
            restarted,
            blocked: false,
            skipped: process.running && !restarted,
        }
    },

    async startRoom(roomId: string, actorUserId: string | null) {
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
