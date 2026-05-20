import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as RuntimeManager from './runtime-manager'

const mocks = vi.hoisted(() => ({
    appendEvent: vi.fn(),
    findRoomById: vi.fn(),
    updateRoomDesiredState: vi.fn(),
    updateRoomStatus: vi.fn(),
    assertRoomConfigurationStartable: vi.fn(),
    markRoomSetupRequired: vi.fn(),
    startRoomProcess: vi.fn(),
    stopRoomProcess: vi.fn(),
    roomProcessSnapshot: vi.fn(),
}))

const runningRoom = {
    id: 'room-1',
    slug: 'ops',
    displayName: 'Ops',
    status: 'stopped' as const,
    desiredState: 'running' as const,
    createdByUserId: 'user-1',
    createdAt: new Date('2026-04-24T00:00:00.000Z'),
    updatedAt: new Date('2026-04-24T00:00:00.000Z'),
}

vi.mock('../db/repositories', () => ({
    auditRepository: {
        appendEvent: mocks.appendEvent,
    },
    roomRepository: {
        findRoomById: mocks.findRoomById,
        updateRoomDesiredState: mocks.updateRoomDesiredState,
        updateRoomStatus: mocks.updateRoomStatus,
    },
}))

vi.mock('../configuration/operator-configuration', () => ({
    assertRoomConfigurationStartable: mocks.assertRoomConfigurationStartable,
}))

vi.mock('./runtime-setup-state', () => ({
    markRoomSetupRequired: mocks.markRoomSetupRequired,
}))

vi.mock('./runtime-lifecycle', () => ({
    roomProcessSnapshot: mocks.roomProcessSnapshot,
    startRoomProcess: mocks.startRoomProcess,
    stopRoomProcess: mocks.stopRoomProcess,
}))

vi.mock('./room-onboarding', () => ({
    ensureRoomOnboardingStarted: vi.fn().mockResolvedValue({ sessionKey: null, started: false }),
}))

describe('room runtime manager', () => {
    let roomRuntimeManager: typeof RuntimeManager.roomRuntimeManager

    beforeEach(async () => {
        vi.resetModules()
        mocks.appendEvent.mockReset()
        mocks.findRoomById.mockReset()
        mocks.updateRoomDesiredState.mockReset()
        mocks.updateRoomStatus.mockReset()
        mocks.assertRoomConfigurationStartable.mockReset()
        mocks.markRoomSetupRequired.mockReset()
        mocks.startRoomProcess.mockReset()
        mocks.stopRoomProcess.mockReset()
        mocks.roomProcessSnapshot.mockReset()

        mocks.appendEvent.mockResolvedValue(undefined)
        mocks.findRoomById.mockResolvedValue(runningRoom)
        mocks.updateRoomDesiredState.mockResolvedValue(undefined)
        mocks.updateRoomStatus.mockResolvedValue(undefined)
        mocks.startRoomProcess.mockResolvedValue(undefined)
        mocks.stopRoomProcess.mockResolvedValue(undefined)
        mocks.roomProcessSnapshot.mockResolvedValue({ running: false })
        mocks.markRoomSetupRequired.mockImplementation(async (input) => {
            await mocks.updateRoomStatus(input.roomId, 'setup_required')
            await mocks.appendEvent({
                actorUserId: input.actorUserId,
                roomId: input.roomId,
                action: 'room.runtime_start_blocked',
                payload: {
                    trigger: input.trigger,
                    ...(input.error ? { error: input.error } : {}),
                },
            })
        })

        const runtimeManagerModule = await import('./runtime-manager')
        roomRuntimeManager = runtimeManagerModule.roomRuntimeManager
    })

    it('preserves running intent and marks setup required when configuration is blocked', async () => {
        mocks.assertRoomConfigurationStartable.mockRejectedValue(
            new Error('Room configuration is blocked: missing provider'),
        )
        mocks.roomProcessSnapshot.mockResolvedValue({ running: false })

        await roomRuntimeManager.startRoom('room-1', 'user-1')

        expect(mocks.updateRoomDesiredState).toHaveBeenCalledWith('room-1', 'running')
        expect(mocks.startRoomProcess).not.toHaveBeenCalled()
        expect(mocks.updateRoomStatus).toHaveBeenCalledWith('room-1', 'setup_required')
    })

    it('stops a live runtime without restart when configuration becomes blocked', async () => {
        mocks.findRoomById.mockResolvedValue({
            ...runningRoom,
            status: 'running',
        })
        mocks.assertRoomConfigurationStartable.mockRejectedValue(
            new Error('Room configuration is blocked: missing provider'),
        )
        mocks.roomProcessSnapshot.mockResolvedValue({ running: true, pid: 123, port: 4567 })

        const result = await roomRuntimeManager.reconcileRoom('room-1', 'user-1', {
            blockedTrigger: 'room_config_saved',
        })

        expect(result).toEqual({
            started: false,
            restarted: false,
            blocked: true,
            skipped: false,
        })
        expect(mocks.stopRoomProcess).toHaveBeenCalledWith('room-1', 'user-1', {
            restartIfDesired: false,
        })
        expect(mocks.updateRoomStatus).toHaveBeenCalledWith('room-1', 'setup_required')
    })

    it('restarts a live desired-running room when requested after config changes', async () => {
        mocks.findRoomById.mockResolvedValue({
            ...runningRoom,
            status: 'running',
        })
        mocks.assertRoomConfigurationStartable.mockResolvedValue(undefined)
        mocks.roomProcessSnapshot.mockResolvedValue({ running: true, pid: 123, port: 4567 })

        const result = await roomRuntimeManager.reconcileRoom('room-1', 'user-1', {
            restartRunning: true,
        })

        expect(result).toEqual({
            started: false,
            restarted: true,
            blocked: false,
            skipped: false,
        })
        expect(mocks.stopRoomProcess).toHaveBeenCalledWith('room-1', 'user-1', {
            restartIfDesired: false,
        })
        expect(mocks.startRoomProcess).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'room-1',
            }),
        )
    })
})
