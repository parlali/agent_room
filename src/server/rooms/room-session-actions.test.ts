import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    findOnboardingByRoomId: vi.fn(),
    createRoomThread: vi.fn(),
    sendRoomThreadMessage: vi.fn(),
    scheduleOnboardingCompletionCheck: vi.fn(),
    syncRoomOnboardingCompletion: vi.fn(),
}))

vi.mock('../db/repositories', () => ({
    roomOnboardingRepository: {
        findByRoomId: mocks.findOnboardingByRoomId,
    },
}))

vi.mock('./execution-engine', () => ({
    createRoomThread: mocks.createRoomThread,
    sendRoomThreadMessage: mocks.sendRoomThreadMessage,
}))

vi.mock('./room-onboarding', () => ({
    scheduleOnboardingCompletionCheck: mocks.scheduleOnboardingCompletionCheck,
    syncRoomOnboardingCompletion: mocks.syncRoomOnboardingCompletion,
}))

describe('room session actions', () => {
    beforeEach(() => {
        mocks.findOnboardingByRoomId.mockReset()
        mocks.createRoomThread.mockReset()
        mocks.sendRoomThreadMessage.mockReset()
        mocks.scheduleOnboardingCompletionCheck.mockReset()
        mocks.syncRoomOnboardingCompletion.mockReset()
        mocks.syncRoomOnboardingCompletion.mockResolvedValue({ completed: false })
        mocks.sendRoomThreadMessage.mockResolvedValue({
            runId: 'run-1',
            status: 'accepted',
            messageSeq: null,
            interruptedActiveRun: false,
            error: null,
        })
        mocks.createRoomThread.mockResolvedValue({ key: 'thread-1' })
    })

    it('sends onboarding replies asynchronously and schedules completion reconciliation', async () => {
        mocks.findOnboardingByRoomId.mockResolvedValue({
            roomId: 'room-1',
            status: 'pending',
            sessionKey: 'onboarding-thread',
        })
        const { sendRoomSessionMessage } = await import('./room-session-actions')

        const result = await sendRoomSessionMessage({
            roomId: 'room-1',
            sessionKey: 'onboarding-thread',
            message: 'Here is how this room should work.',
        })

        expect(result.status).toBe('accepted')
        expect(mocks.sendRoomThreadMessage).toHaveBeenCalledWith({
            roomId: 'room-1',
            sessionKey: 'onboarding-thread',
            message: 'Here is how this room should work.',
            awaitCompletion: false,
        })
        expect(mocks.scheduleOnboardingCompletionCheck).toHaveBeenCalledWith({
            roomId: 'room-1',
            sessionKey: 'onboarding-thread',
            runId: 'run-1',
        })
    })

    it('blocks regular thread creation while onboarding is pending', async () => {
        mocks.findOnboardingByRoomId.mockResolvedValue({
            roomId: 'room-1',
            status: 'pending',
            sessionKey: 'onboarding-thread',
        })
        const { createRegularRoomThread } = await import('./room-session-actions')

        await expect(
            createRegularRoomThread({
                roomId: 'room-1',
            }),
        ).rejects.toThrow('Complete the room intro before starting a new session')
        expect(mocks.createRoomThread).not.toHaveBeenCalled()
    })

    it('blocks regular session messages while onboarding is pending', async () => {
        mocks.findOnboardingByRoomId.mockResolvedValue({
            roomId: 'room-1',
            status: 'pending',
            sessionKey: 'onboarding-thread',
        })
        const { sendRoomSessionMessage } = await import('./room-session-actions')

        await expect(
            sendRoomSessionMessage({
                roomId: 'room-1',
                sessionKey: 'regular-thread',
                message: 'Do normal work',
            }),
        ).rejects.toThrow('Complete the room intro before continuing regular sessions')
        expect(mocks.sendRoomThreadMessage).not.toHaveBeenCalled()
        expect(mocks.scheduleOnboardingCompletionCheck).not.toHaveBeenCalled()
    })

    it('creates regular threads after onboarding is complete', async () => {
        mocks.findOnboardingByRoomId.mockResolvedValue({
            roomId: 'room-1',
            status: 'completed',
            sessionKey: 'onboarding-thread',
        })
        const { createRegularRoomThread } = await import('./room-session-actions')

        await expect(createRegularRoomThread({ roomId: 'room-1' })).resolves.toEqual({
            key: 'thread-1',
        })
    })
})
