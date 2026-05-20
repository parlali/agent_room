import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reconcileRoomAutostart } from './room-autostart'

const mocks = vi.hoisted(() => ({
    findRoomById: vi.fn(),
    appendEvent: vi.fn(),
    reconcileRoom: vi.fn(),
}))

vi.mock('../db/repositories', () => ({
    auditRepository: {
        appendEvent: mocks.appendEvent,
    },
    roomRepository: {
        findRoomById: mocks.findRoomById,
    },
}))

vi.mock('./runtime-manager', () => ({
    roomRuntimeManager: {
        reconcileRoom: mocks.reconcileRoom,
    },
}))

describe('reconcileRoomAutostart', () => {
    beforeEach(() => {
        mocks.findRoomById.mockReset()
        mocks.appendEvent.mockReset()
        mocks.reconcileRoom.mockReset()
        mocks.appendEvent.mockResolvedValue(undefined)
    })

    it('skips autostart when the operator paused the room', async () => {
        mocks.findRoomById.mockResolvedValue({
            id: 'room-1',
            desiredState: 'stopped',
            status: 'stopped',
        })

        const result = await reconcileRoomAutostart({
            roomId: 'room-1',
            actorUserId: 'user-1',
            trigger: 'room_config_saved',
        })

        expect(result).toEqual({ started: false, blocked: false, skipped: true })
        expect(mocks.reconcileRoom).not.toHaveBeenCalled()
    })

    it('reports blocked when runtime reconciliation is config-blocked', async () => {
        mocks.findRoomById.mockResolvedValue({
            id: 'room-1',
            desiredState: 'running',
            status: 'setup_required',
        })
        mocks.reconcileRoom.mockResolvedValue({
            started: false,
            restarted: false,
            blocked: true,
            skipped: false,
        })

        const result = await reconcileRoomAutostart({
            roomId: 'room-1',
            actorUserId: 'user-1',
            trigger: 'room_config_saved',
        })

        expect(result).toEqual({ started: false, blocked: true, skipped: false })
        expect(mocks.reconcileRoom).toHaveBeenCalledWith('room-1', 'user-1', {
            restartRunning: true,
            blockedTrigger: 'room_config_saved',
        })
    })

    it('reconciles a desired-running room after room config becomes startable', async () => {
        mocks.findRoomById.mockResolvedValue({
            id: 'room-1',
            desiredState: 'running',
            status: 'setup_required',
        })
        mocks.reconcileRoom.mockResolvedValue({
            started: true,
            restarted: false,
            blocked: false,
            skipped: false,
        })

        const result = await reconcileRoomAutostart({
            roomId: 'room-1',
            actorUserId: 'user-1',
            trigger: 'room_config_saved',
        })

        expect(result).toEqual({ started: true, blocked: false, skipped: false })
        expect(mocks.reconcileRoom).toHaveBeenCalledWith('room-1', 'user-1', {
            restartRunning: true,
            blockedTrigger: 'room_config_saved',
        })
        expect(mocks.appendEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'room.runtime_autostart',
                payload: {
                    trigger: 'room_config_saved',
                    restarted: false,
                },
            }),
        )
    })

    it('restarts a running room when room-scoped config changes', async () => {
        mocks.findRoomById.mockResolvedValue({
            id: 'room-1',
            desiredState: 'running',
            status: 'running',
        })
        mocks.reconcileRoom.mockResolvedValue({
            started: false,
            restarted: true,
            blocked: false,
            skipped: false,
        })

        const result = await reconcileRoomAutostart({
            roomId: 'room-1',
            actorUserId: 'user-1',
            trigger: 'room_config_saved',
        })

        expect(result).toEqual({ started: true, blocked: false, skipped: false })
        expect(mocks.appendEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'room.runtime_autostart',
                payload: {
                    trigger: 'room_config_saved',
                    restarted: true,
                },
            }),
        )
    })
})
