import { describe, expect, it, vi } from 'vitest'
import type { RoomExecutionThread, RoomSessionArtifact } from '#/domain/room-execution-types'
import type { RoomViewThreadReadModel } from '../rooms/room-view-readmodel-contract'

const mocks = vi.hoisted(() => {
    return {
        requireHostedExecutionContext: vi.fn(),
        readRoomViewThreads: vi.fn(),
        readRoomViewThread: vi.fn(),
    }
})

vi.mock('./hosted-execution-context', () => ({
    requireHostedExecutionContext: mocks.requireHostedExecutionContext,
    assertHostedRunAllowed: vi.fn(),
}))

vi.mock('./hosted-room-view-store', () => ({
    readRoomViewThreads: mocks.readRoomViewThreads,
    readRoomViewThread: mocks.readRoomViewThread,
}))

const { getRoomSessionWindow } = await import('./hosted-execution-adapter')

function makeThread(overrides: Partial<RoomExecutionThread> = {}): RoomExecutionThread {
    return {
        key: 'main',
        sessionId: 'session-1',
        agentId: 'main',
        kind: 'main',
        parentThreadKey: null,
        title: 'Conversation',
        lastMessagePreview: null,
        status: 'idle',
        activeRunId: null,
        updatedAt: 3000,
        runStartedAt: null,
        runtimeMs: null,
        model: null,
        modelProvider: null,
        totalTokens: null,
        estimatedCostUsd: null,
        badgeState: { completedClearedAt: null, completed: false },
        compaction: {
            enabled: false,
            compacting: false,
            count: 0,
            lastCompactedAt: null,
            lastTokensBefore: null,
            lastError: null,
        },
        ...overrides,
    }
}

const createdArtifact: RoomSessionArtifact = {
    id: 'workspace:deliverables/report.pdf',
    name: 'report.pdf',
    surface: 'workspace',
    relativePath: 'deliverables/report.pdf',
    kind: 'created',
    source: 'Created by write',
    toolName: 'agent_room_write',
    operation: 'create',
    artifactId: null,
    byteLength: 2048,
    timestamp: 1000,
    messageId: 'assistant-1',
}

function armContext(): void {
    mocks.requireHostedExecutionContext.mockResolvedValue({
        context: { env: {} as never, request: null },
        actor: { workspaceId: 'workspace-1', userId: 'user-1' },
    })
}

describe('hosted session window surfaces read-model artifacts', () => {
    it('returns the thread read-model artifacts for the session window', async () => {
        armContext()
        mocks.readRoomViewThreads.mockResolvedValue({
            roomAgent: null,
            threads: [makeThread()],
            extraAgentIds: [],
        })
        const model: RoomViewThreadReadModel = {
            messages: [],
            artifacts: [createdArtifact],
        }
        mocks.readRoomViewThread.mockResolvedValue(model)

        const window = await getRoomSessionWindow({
            roomId: 'room-1',
            sessionKey: 'main',
        })

        expect(window.artifacts).toEqual([createdArtifact])
    })

    it('returns an empty artifact list when the thread has no artifacts', async () => {
        armContext()
        mocks.readRoomViewThreads.mockResolvedValue({
            roomAgent: null,
            threads: [makeThread()],
            extraAgentIds: [],
        })
        mocks.readRoomViewThread.mockResolvedValue({
            messages: [],
            artifacts: [],
        } satisfies RoomViewThreadReadModel)

        const window = await getRoomSessionWindow({
            roomId: 'room-1',
            sessionKey: 'main',
        })

        expect(window.artifacts).toEqual([])
    })

    it('returns an empty artifact list for a thread that does not exist', async () => {
        armContext()
        mocks.readRoomViewThreads.mockResolvedValue({
            roomAgent: null,
            threads: [],
            extraAgentIds: [],
        })
        mocks.readRoomViewThread.mockResolvedValue(null)

        const window = await getRoomSessionWindow({
            roomId: 'room-1',
            sessionKey: 'missing',
        })

        expect(window.artifacts).toEqual([])
    })
})
