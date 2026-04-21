import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as RoomService from './room-service'

const mocks = vi.hoisted(() => ({
    auditAppendEvent: vi.fn(),
    roomCreate: vi.fn(),
    roomDelete: vi.fn(),
    startRoom: vi.fn(),
    archiveFailedRoomFilesystemLayout: vi.fn(),
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
    },
}))

vi.mock('../configuration/operator-configuration', () => ({
    saveRoomConfig: mocks.saveRoomConfig,
}))

vi.mock('./runtime-manager', () => ({
    roomRuntimeManager: {
        startRoom: mocks.startRoom,
    },
}))

vi.mock('./room-paths', () => ({
    archiveFailedRoomFilesystemLayout: mocks.archiveFailedRoomFilesystemLayout,
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
        mocks.startRoom.mockReset()
        mocks.archiveFailedRoomFilesystemLayout.mockReset()
        mocks.assertRoomSetupReady.mockReset()
        mocks.saveRoomConfig.mockReset()

        mocks.auditAppendEvent.mockResolvedValue(undefined)
        mocks.roomCreate.mockResolvedValue(createRoomRecord)
        mocks.roomDelete.mockResolvedValue(undefined)
        mocks.archiveFailedRoomFilesystemLayout.mockResolvedValue(
            '/tmp/failed-room-startups/room-1',
        )
        mocks.assertRoomSetupReady.mockReturnValue(undefined)
        mocks.saveRoomConfig.mockResolvedValue(undefined)

        const roomServiceModule = await import('./room-service')
        createRoom = roomServiceModule.createRoom
    })

    it('fails closed and cleans up room provisioning when runtime startup fails', async () => {
        mocks.startRoom.mockRejectedValue(new Error('Initial runtime health check failed'))

        await expect(
            createRoom({
                displayName: 'Marketing',
                createdByUserId: 'user-1',
                startImmediately: true,
            }),
        ).rejects.toThrow(
            'Room startup failed: Initial runtime health check failed. Diagnostic files were preserved for support review.',
        )

        expect(mocks.assertRoomSetupReady).toHaveBeenCalledOnce()
        expect(mocks.roomCreate).toHaveBeenCalledOnce()
        expect(mocks.startRoom).toHaveBeenCalledWith('room-1', 'user-1')
        expect(mocks.saveRoomConfig).toHaveBeenCalledWith(
            expect.objectContaining({
                roomId: 'room-1',
                providerMode: 'app_default',
            }),
            'user-1',
        )
        expect(mocks.archiveFailedRoomFilesystemLayout).toHaveBeenCalledWith('room-1')
        expect(mocks.roomDelete).toHaveBeenCalledWith('room-1')
        expect(mocks.auditAppendEvent).toHaveBeenCalledTimes(2)
        expect(mocks.auditAppendEvent).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                roomId: 'room-1',
                action: 'room.create_failed',
                payload: expect.objectContaining({
                    diagnosticsPath: '/tmp/failed-room-startups/room-1',
                }),
            }),
        )
    })
})
