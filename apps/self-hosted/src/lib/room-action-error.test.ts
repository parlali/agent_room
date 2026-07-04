import { beforeEach, describe, expect, it, vi } from 'vitest'

const toastError = vi.fn()
const toastDismiss = vi.fn()

vi.mock('sonner', () => ({
    toast: {
        error: (...args: unknown[]) => toastError(...args),
        dismiss: (...args: unknown[]) => toastDismiss(...args),
    },
}))

const { dismissRoomActionErrors, reportRoomActionError } = await import('./room-action-error')

beforeEach(() => {
    toastError.mockClear()
    toastDismiss.mockClear()
})

describe('reportRoomActionError', () => {
    it('keeps recurring runtime conditions out of global toasts and clears any stale room toast', () => {
        reportRoomActionError({
            roomId: 'room-1',
            error: new Error('Hosted runtime state callback failed with status 429'),
            title: 'Could not change room state',
        })

        expect(toastError).not.toHaveBeenCalled()
        expect(toastDismiss).toHaveBeenCalledWith('room-error:quota:room-1')
        expect(toastDismiss).toHaveBeenCalledWith('room-error:runtime:room-1')
        expect(toastDismiss).toHaveBeenCalledWith('room-error:transient:room-1')
    })

    it('suppresses the toast for 5xx runtime callback failures as well', () => {
        reportRoomActionError({
            roomId: 'room-1',
            error: new Error('Hosted runtime state callback failed with status 500'),
            title: 'Could not start a new session',
        })

        expect(toastError).not.toHaveBeenCalled()
    })

    it('renders transient failures on a stable per-room id so repeats replace instead of stacking', () => {
        reportRoomActionError({
            roomId: 'room-1',
            error: new Error('Message could not be sent'),
            title: 'Could not change room state',
        })

        expect(toastError).toHaveBeenCalledWith('Could not change room state', {
            id: 'room-error:transient:room-1',
            description: 'Message could not be sent',
        })
    })

    it('routes jargon-laden transient messages through the plain-language mapper', () => {
        reportRoomActionError({
            roomId: 'room-1',
            error: new Error('pi runtime endpoint 1a2b3c4d-1234 returned an unexpected shape'),
            title: 'Could not save secret',
        })

        const call = toastError.mock.calls[0]!
        expect(call[1]).toMatchObject({ id: 'room-error:transient:room-1' })
        expect((call[1] as { description: string }).description).toBe(
            'Something went wrong. Try again in a moment.',
        )
    })
})

describe('dismissRoomActionErrors', () => {
    it('dismisses every per-room error class so recovery and navigation clear the surface', () => {
        dismissRoomActionErrors('room-9')

        expect(toastDismiss).toHaveBeenCalledWith('room-error:quota:room-9')
        expect(toastDismiss).toHaveBeenCalledWith('room-error:runtime:room-9')
        expect(toastDismiss).toHaveBeenCalledWith('room-error:transient:room-9')
    })
})
