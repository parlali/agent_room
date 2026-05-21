import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    reconcileRoomAutostart: vi.fn(),
}))

vi.mock('../../rooms/room-autostart', () => ({
    reconcileRoomAutostart: mocks.reconcileRoomAutostart,
}))

describe('room config save runtime reconciliation', () => {
    beforeEach(() => {
        mocks.reconcileRoomAutostart.mockReset()
    })

    it('does not fail the saved configuration when post-save runtime reconciliation fails', async () => {
        mocks.reconcileRoomAutostart.mockRejectedValue(new Error('runtime stream closed'))
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        const { __testing } = await import('./room-config-save')

        await expect(
            __testing.reconcileRuntimeAfterRoomConfigSave({
                roomId: 'room-1',
                actorUserId: 'user-1',
            }),
        ).resolves.toBeUndefined()

        expect(mocks.reconcileRoomAutostart).toHaveBeenCalledWith({
            roomId: 'room-1',
            actorUserId: 'user-1',
            trigger: 'room_config_saved',
        })
        expect(errorSpy).toHaveBeenCalledWith(
            'Room configuration saved but runtime autostart reconciliation failed for room-1',
            'runtime stream closed',
        )
        errorSpy.mockRestore()
    })
})
