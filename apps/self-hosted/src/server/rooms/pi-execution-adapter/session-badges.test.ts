import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = {
    roomRepository: {
        findRoomById: vi.fn(),
    },
    roomRuntimeMetadataRepository: {
        findByRoomId: vi.fn(),
    },
    roomConfigRepository: {
        getOrCreate: vi.fn(),
    },
    roomSessionBadgeRepository: {
        listForRoom: vi.fn(),
        clearCompleted: vi.fn(),
    },
    roomOnboardingRepository: {
        findByRoomId: vi.fn(),
    },
    usageRepository: {},
    roomCronRepository: {},
    requestPiRuntime: vi.fn(),
}

vi.mock('../../db/repositories', () => ({
    roomRepository: mocks.roomRepository,
    roomRuntimeMetadataRepository: mocks.roomRuntimeMetadataRepository,
    roomConfigRepository: mocks.roomConfigRepository,
    roomSessionBadgeRepository: mocks.roomSessionBadgeRepository,
    roomOnboardingRepository: mocks.roomOnboardingRepository,
    usageRepository: mocks.usageRepository,
    roomCronRepository: mocks.roomCronRepository,
}))

vi.mock('../pi-runtime-client', () => ({
    requestPiRuntime: mocks.requestPiRuntime,
}))

const roomId = 'room-1'
const actorUserId = 'user-1'

function thread(input: {
    key: string
    status: string
    updatedAt: number
    preview?: string | null
}) {
    return {
        key: input.key,
        sessionId: null,
        agentId: 'main',
        kind: 'main' as const,
        parentThreadKey: null,
        title: input.key,
        lastMessagePreview: input.preview === undefined ? 'Done' : input.preview,
        status: input.status,
        updatedAt: input.updatedAt,
        runStartedAt: null,
        runtimeMs: null,
        model: null,
        modelProvider: null,
        totalTokens: null,
        estimatedCostUsd: null,
        badgeState: {
            completedClearedAt: null,
            completed: false,
        },
        compaction: {
            enabled: false,
            compacting: false,
            count: 0,
            lastCompactedAt: null,
            lastTokensBefore: null,
            lastError: null,
        },
    }
}

describe('session completed badge projection', () => {
    beforeEach(() => {
        mocks.roomRepository.findRoomById.mockResolvedValue({
            id: roomId,
            slug: 'ops',
            displayName: 'Ops',
            status: 'running',
            desiredState: 'running',
        })
        mocks.roomRuntimeMetadataRepository.findByRoomId.mockResolvedValue({
            port: 3001,
            pid: 123,
            healthStatus: 'healthy',
            lastHealthAt: new Date('2026-05-20T10:00:00.000Z'),
            lastError: null,
        })
        mocks.roomConfigRepository.getOrCreate.mockResolvedValue({
            roomMode: 'coworker',
        })
        mocks.roomSessionBadgeRepository.listForRoom.mockReset()
        mocks.roomSessionBadgeRepository.clearCompleted.mockReset()
        mocks.roomOnboardingRepository.findByRoomId.mockResolvedValue({
            roomId,
            status: 'completed',
            sessionKey: 'onboarding-session',
            completedAt: new Date('2026-05-20T09:00:00.000Z'),
        })
        mocks.requestPiRuntime.mockReset()
    })

    it('does not clear completed badges while loading a selected session snapshot', async () => {
        mocks.roomSessionBadgeRepository.listForRoom.mockResolvedValue([])
        mocks.requestPiRuntime.mockResolvedValue({
            roomAgent: null,
            extraAgentIds: [],
            threads: [thread({ key: 'session-1', status: 'complete', updatedAt: 2000 })],
            selectedThreadKey: 'session-1',
            selectedThreadModel: null,
            selectedThreadMessages: [],
            selectedThreadArtifacts: [],
            recentActivity: [],
            browserSession: null,
        })

        const { getRoomExecutionSnapshot } = await import('./runtime-snapshots')
        const snapshot = await getRoomExecutionSnapshot({
            roomId,
            selectedThreadKey: 'session-1',
            messageLimit: 0,
            actorUserId,
        })

        expect(mocks.roomSessionBadgeRepository.clearCompleted).not.toHaveBeenCalled()
        expect(snapshot.threads[0]?.badgeState).toEqual({
            completedClearedAt: null,
            completed: true,
        })
    })

    it('projects working for active sessions and completed only after terminal activity newer than the explicit clear', async () => {
        mocks.roomSessionBadgeRepository.listForRoom.mockResolvedValue([
            {
                sessionKey: 'old-complete',
                completedClearedAt: new Date(2500),
            },
        ])
        mocks.requestPiRuntime.mockResolvedValue({
            roomAgent: null,
            extraAgentIds: [],
            threads: [
                thread({ key: 'queued', status: 'queued', updatedAt: 3000 }),
                thread({ key: 'old-complete', status: 'complete', updatedAt: 2000 }),
                thread({ key: 'new-complete', status: 'complete', updatedAt: 3000 }),
                thread({
                    key: 'empty-terminal',
                    status: 'complete',
                    updatedAt: 3000,
                    preview: null,
                }),
                thread({
                    key: 'empty-idle',
                    status: 'idle',
                    updatedAt: 3000,
                    preview: null,
                }),
                thread({
                    key: 'idle-with-preview',
                    status: 'idle',
                    updatedAt: 3000,
                    preview: 'Done',
                }),
            ],
            selectedThreadKey: null,
            selectedThreadModel: null,
            selectedThreadMessages: [],
            selectedThreadArtifacts: [],
            recentActivity: [],
            browserSession: null,
        })

        const { getRoomExecutionSnapshot } = await import('./runtime-snapshots')
        const snapshot = await getRoomExecutionSnapshot({
            roomId,
            messageLimit: 0,
            actorUserId,
        })

        expect(snapshot.threads.map((item) => [item.key, item.badgeState.completed])).toEqual([
            ['queued', false],
            ['old-complete', false],
            ['new-complete', true],
            ['empty-terminal', true],
            ['empty-idle', false],
            ['idle-with-preview', true],
        ])
    })
})
