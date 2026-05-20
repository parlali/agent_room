import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as RoomService from './room-service'

const mocks = vi.hoisted(() => ({
    auditAppendEvent: vi.fn(),
    roomCreate: vi.fn(),
    roomDelete: vi.fn(),
    roomFindById: vi.fn(),
    roomUpdateDesiredState: vi.fn(),
    roomUpdateStatus: vi.fn(),
    runtimeMetadataUpsert: vi.fn(),
    startRoom: vi.fn(),
    assertRoomSetupReady: vi.fn(),
    saveRoomConfig: vi.fn(),
}))

const createRoomRecord = {
    id: 'room-1',
    slug: 'marketing',
    displayName: 'Marketing',
    status: 'stopped' as const,
    desiredState: 'running' as const,
    createdByUserId: 'user-1',
    createdAt: new Date('2026-04-21T00:00:00.000Z'),
    updatedAt: new Date('2026-04-21T00:00:00.000Z'),
}

vi.mock('../db/repositories', () => ({
    auditRepository: {
        appendEvent: mocks.auditAppendEvent,
    },
    roomRepository: {
        createRoom: mocks.roomCreate,
        deleteRoom: mocks.roomDelete,
        findRoomById: mocks.roomFindById,
        updateRoomDesiredState: mocks.roomUpdateDesiredState,
        updateRoomStatus: mocks.roomUpdateStatus,
    },
    roomRuntimeMetadataRepository: {
        upsert: mocks.runtimeMetadataUpsert,
    },
}))

vi.mock('../configuration/operator-configuration', () => ({
    saveRoomConfig: mocks.saveRoomConfig,
}))

vi.mock('./room-autostart', () => ({
    reconcileRoomAutostart: mocks.startRoom,
}))

vi.mock('./room-onboarding', () => ({
    beginRoomOnboarding: vi.fn().mockResolvedValue(undefined),
    seedDefaultRoomMemory: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('./room-paths', () => ({
    getRoomPaths: vi.fn(),
}))

vi.mock('./runtime-readiness', () => ({
    assertRoomSetupReady: mocks.assertRoomSetupReady,
}))

describe('room service', () => {
    let createRoom: typeof RoomService.createRoom

    beforeEach(async () => {
        mocks.auditAppendEvent.mockReset()
        mocks.roomCreate.mockReset()
        mocks.roomDelete.mockReset()
        mocks.roomFindById.mockReset()
        mocks.roomUpdateDesiredState.mockReset()
        mocks.roomUpdateStatus.mockReset()
        mocks.runtimeMetadataUpsert.mockReset()
        mocks.startRoom.mockReset()
        mocks.assertRoomSetupReady.mockReset()
        mocks.saveRoomConfig.mockReset()

        mocks.auditAppendEvent.mockResolvedValue(undefined)
        mocks.roomCreate.mockResolvedValue(createRoomRecord)
        mocks.roomDelete.mockResolvedValue(undefined)
        mocks.roomUpdateDesiredState.mockResolvedValue(undefined)
        mocks.roomUpdateStatus.mockResolvedValue(undefined)
        mocks.runtimeMetadataUpsert.mockResolvedValue(undefined)
        mocks.assertRoomSetupReady.mockReturnValue(undefined)
        mocks.saveRoomConfig.mockResolvedValue(undefined)
        mocks.roomFindById.mockResolvedValue({
            ...createRoomRecord,
            status: 'failed',
            desiredState: 'running',
        })
        const roomServiceModule = await import('./room-service')
        createRoom = roomServiceModule.createRoom
    })

    it('creates the room but fails closed for execution when runtime startup fails', async () => {
        mocks.startRoom.mockRejectedValue(new Error('Initial runtime health check failed'))

        const result = await createRoom({
            displayName: 'Marketing',
            createdByUserId: 'user-1',
            startImmediately: true,
        })

        expect(result).toEqual({
            ...createRoomRecord,
            status: 'failed',
            desiredState: 'running',
        })

        expect(mocks.assertRoomSetupReady).toHaveBeenCalledOnce()
        expect(mocks.roomCreate).toHaveBeenCalledOnce()
        expect(mocks.startRoom).toHaveBeenCalledWith(
            expect.objectContaining({
                roomId: 'room-1',
                actorUserId: 'user-1',
                trigger: 'room_created',
            }),
        )
        expect(mocks.saveRoomConfig).toHaveBeenCalledWith(
            expect.objectContaining({
                roomId: 'room-1',
                providerMode: 'app_default',
            }),
            'user-1',
            {
                reconcileAutostart: false,
            },
        )
        expect(mocks.roomUpdateDesiredState).not.toHaveBeenCalled()
        expect(mocks.roomUpdateStatus).toHaveBeenCalledWith('room-1', 'failed')
        expect(mocks.runtimeMetadataUpsert).toHaveBeenCalledWith(
            expect.objectContaining({
                roomId: 'room-1',
                healthStatus: 'unhealthy',
                lastError: 'Initial runtime health check failed',
            }),
        )
        expect(mocks.roomDelete).not.toHaveBeenCalled()
        expect(mocks.auditAppendEvent).toHaveBeenCalledTimes(2)
        expect(mocks.auditAppendEvent).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                roomId: 'room-1',
                action: 'room.start_after_create_failed',
                payload: expect.objectContaining({
                    error: 'Initial runtime health check failed',
                }),
            }),
        )
    })
})
