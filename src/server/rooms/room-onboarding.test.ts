import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    appendAuditEvent: vi.fn(),
    createRoomThread: vi.fn(),
    findRoomById: vi.fn(),
    getOrCreateConfig: vi.fn(),
    getOrCreateOnboarding: vi.fn(),
    getRoomSessionWindow: vi.fn(),
    roomProcessSnapshot: vi.fn(),
    sendRoomThreadMessage: vi.fn(),
    updateOnboarding: vi.fn(),
}))

vi.mock('../db/repositories', () => ({
    auditRepository: {
        appendEvent: mocks.appendAuditEvent,
    },
    roomConfigRepository: {
        getOrCreate: mocks.getOrCreateConfig,
    },
    roomOnboardingRepository: {
        getOrCreate: mocks.getOrCreateOnboarding,
        update: mocks.updateOnboarding,
    },
    roomRepository: {
        findRoomById: mocks.findRoomById,
    },
}))

vi.mock('./pi-execution-adapter/runtime-snapshots', () => ({
    getRoomSessionWindow: mocks.getRoomSessionWindow,
}))

vi.mock('./pi-execution-adapter/thread-operations', () => ({
    createRoomThread: mocks.createRoomThread,
    sendRoomThreadMessage: mocks.sendRoomThreadMessage,
}))

vi.mock('./runtime-lifecycle', () => ({
    roomProcessSnapshot: mocks.roomProcessSnapshot,
}))

describe('room onboarding startup', () => {
    beforeEach(() => {
        mocks.appendAuditEvent.mockReset()
        mocks.createRoomThread.mockReset()
        mocks.findRoomById.mockReset()
        mocks.getOrCreateConfig.mockReset()
        mocks.getOrCreateOnboarding.mockReset()
        mocks.getRoomSessionWindow.mockReset()
        mocks.roomProcessSnapshot.mockReset()
        mocks.sendRoomThreadMessage.mockReset()
        mocks.updateOnboarding.mockReset()
        mocks.roomProcessSnapshot.mockResolvedValue({ running: true })
        mocks.findRoomById.mockResolvedValue({ displayName: 'Room One' })
        mocks.getOrCreateConfig.mockResolvedValue({ instructions: 'Prefer short updates.' })
        mocks.createRoomThread.mockResolvedValue({ key: 'onboarding-thread' })
        mocks.sendRoomThreadMessage.mockResolvedValue({
            runId: 'run-1',
            status: 'accepted',
            messageSeq: null,
            interruptedActiveRun: false,
            error: null,
        })
    })

    it('creates the intro thread without waiting for the model opener to finish', async () => {
        mocks.getOrCreateOnboarding.mockResolvedValue({
            roomId: 'room-1',
            status: 'pending',
            sessionKey: null,
        })
        const { ensureRoomOnboardingStarted } = await import('./room-onboarding')

        await expect(ensureRoomOnboardingStarted('room-1')).resolves.toEqual({
            sessionKey: 'onboarding-thread',
            started: true,
        })

        expect(mocks.createRoomThread).toHaveBeenCalledWith(
            expect.objectContaining({
                roomId: 'room-1',
                title: 'Getting to know this room',
                kind: 'onboarding',
                hideUserMessage: true,
                awaitInitialRun: false,
            }),
        )
        expect(mocks.updateOnboarding).toHaveBeenCalledWith({
            roomId: 'room-1',
            status: 'pending',
            sessionKey: 'onboarding-thread',
        })
    })

    it('replays a missing intro opener asynchronously for an existing intro thread', async () => {
        mocks.getOrCreateOnboarding.mockResolvedValue({
            roomId: 'room-1',
            status: 'pending',
            sessionKey: 'onboarding-thread',
        })
        mocks.getRoomSessionWindow.mockResolvedValue({
            rows: [],
        })
        const { ensureRoomOnboardingStarted } = await import('./room-onboarding')

        await expect(ensureRoomOnboardingStarted('room-1')).resolves.toEqual({
            sessionKey: 'onboarding-thread',
            started: true,
        })

        expect(mocks.sendRoomThreadMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                roomId: 'room-1',
                sessionKey: 'onboarding-thread',
                hideUserMessage: true,
                awaitCompletion: false,
            }),
        )
        expect(mocks.createRoomThread).not.toHaveBeenCalled()
    })
})
