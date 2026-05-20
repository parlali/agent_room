import { beforeEach, describe, expect, it, vi } from 'vitest'
import { markRoomSetupRequired } from './runtime-setup-state'

const mocks = vi.hoisted(() => ({
    appendEvent: vi.fn(),
    updateRoomStatus: vi.fn(),
    transactionClient: {},
    withTransaction: vi.fn(),
}))

vi.mock('../db/client', () => ({
    withTransaction: mocks.withTransaction,
}))

vi.mock('../db/repositories', () => ({
    auditRepository: {
        appendEvent: mocks.appendEvent,
    },
    roomRepository: {
        updateRoomStatus: mocks.updateRoomStatus,
    },
}))

describe('markRoomSetupRequired', () => {
    beforeEach(() => {
        mocks.appendEvent.mockReset()
        mocks.updateRoomStatus.mockReset()
        mocks.withTransaction.mockReset()
        mocks.appendEvent.mockResolvedValue(undefined)
        mocks.updateRoomStatus.mockResolvedValue(undefined)
        mocks.withTransaction.mockImplementation(async (work) => work(mocks.transactionClient))
    })

    it('updates room status and appends the audit event in one transaction', async () => {
        await markRoomSetupRequired({
            roomId: 'room-1',
            actorUserId: 'user-1',
            trigger: 'room_config_saved',
            error: 'missing provider',
        })

        expect(mocks.withTransaction).toHaveBeenCalledOnce()
        expect(mocks.updateRoomStatus).toHaveBeenCalledWith(
            'room-1',
            'setup_required',
            mocks.transactionClient,
        )
        expect(mocks.appendEvent).toHaveBeenCalledWith(
            {
                actorUserId: 'user-1',
                roomId: 'room-1',
                action: 'room.runtime_start_blocked',
                payload: {
                    trigger: 'room_config_saved',
                    error: 'missing provider',
                },
            },
            mocks.transactionClient,
        )
    })
})
