import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as RuntimeManager from './runtime-manager'

const mocks = vi.hoisted(() => ({
    appendEvent: vi.fn(),
    findRoomById: vi.fn(),
    updateRoomDesiredState: vi.fn(),
    updateRoomStatus: vi.fn(),
    assertRoomConfigurationStartable: vi.fn(),
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

vi.mock('./runtime-lifecycle', () => ({
    roomProcessSnapshot: mocks.roomProcessSnapshot,
    startRoomProcess: mocks.startRoomProcess,
    stopRoomProcess: mocks.stopRoomProcess,
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
        mocks.startRoomProcess.mockReset()
        mocks.stopRoomProcess.mockReset()
        mocks.roomProcessSnapshot.mockReset()

        mocks.appendEvent.mockResolvedValue(undefined)
        mocks.findRoomById.mockResolvedValue(runningRoom)
        mocks.updateRoomDesiredState.mockResolvedValue(undefined)
        mocks.updateRoomStatus.mockResolvedValue(undefined)
        mocks.startRoomProcess.mockResolvedValue(undefined)
        mocks.stopRoomProcess.mockResolvedValue(undefined)

        const runtimeManagerModule = await import('./runtime-manager')
        roomRuntimeManager = runtimeManagerModule.roomRuntimeManager
    })

    it('fails closed before changing desired state when effective config is blocked', async () => {
        mocks.assertRoomConfigurationStartable.mockRejectedValue(
            new Error('Room configuration is blocked: missing provider'),
        )

        await expect(roomRuntimeManager.startRoom('room-1', 'user-1')).rejects.toThrow(
            'Room configuration is blocked: missing provider',
        )

        expect(mocks.updateRoomDesiredState).not.toHaveBeenCalled()
        expect(mocks.startRoomProcess).not.toHaveBeenCalled()
        expect(mocks.updateRoomStatus).toHaveBeenCalledWith('room-1', 'failed')
        expect(mocks.appendEvent).toHaveBeenCalledWith({
            actorUserId: 'user-1',
            roomId: 'room-1',
            action: 'room.runtime_start_blocked',
            payload: {
                error: 'Room configuration is blocked: missing provider',
            },
        })
    })
})
