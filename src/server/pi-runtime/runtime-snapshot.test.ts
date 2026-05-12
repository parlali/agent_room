import { describe, expect, it } from 'vitest'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import type { RoomExecutionMessage, RoomSessionArtifact } from '../rooms/execution-types'
import { buildRuntimeSnapshot } from './runtime-snapshot'
import { normalizeThreadRecord } from './thread-records'

const record = normalizeThreadRecord({
    key: 'session-a',
    sessionFile: 'session-a.jsonl',
    sessionId: 'session-a',
    title: 'Session A',
    status: 'idle',
    createdAt: 1000,
    updatedAt: 2000,
})

const messages: RoomExecutionMessage[] = [
    {
        id: 'message-one',
        role: 'user',
        text: 'one',
        parts: [],
        timestamp: 1000,
    },
    {
        id: 'message-two',
        role: 'assistant',
        text: 'two',
        parts: [],
        timestamp: 2000,
    },
]

const artifacts: RoomSessionArtifact[] = [
    {
        id: 'artifact-one',
        name: 'artifact.txt',
        surface: 'workspace',
        relativePath: 'artifact.txt',
        kind: 'created',
        source: 'tool',
        toolName: null,
        operation: null,
        artifactId: null,
        byteLength: 12,
        timestamp: 2000,
        messageId: 'message-two',
    },
]

describe('Pi runtime snapshot payload shaping', () => {
    it('can return a room summary without selected transcript payloads', () => {
        const result = snapshotWithLimit(0)

        expect(result.snapshot.threads).toHaveLength(1)
        expect(result.snapshot.selectedThreadKey).toBe('session-a')
        expect(result.snapshot.selectedThreadMessages).toHaveLength(0)
        expect(result.snapshot.selectedThreadArtifacts).toHaveLength(0)
        expect(result.messageReads).toBe(0)
        expect(result.artifactReads).toBe(0)
    })

    it('limits selected session messages when a transcript window is requested', () => {
        const result = snapshotWithLimit(1)

        expect(result.snapshot.selectedThreadMessages.map((message) => message.id)).toEqual([
            'message-two',
        ])
        expect(result.snapshot.selectedThreadArtifacts).toHaveLength(1)
        expect(result.messageReads).toBe(1)
        expect(result.artifactReads).toBe(1)
    })
})

function snapshotWithLimit(messageLimit: number) {
    let messageReads = 0
    let artifactReads = 0
    const snapshot = buildRuntimeSnapshot({
        config: minimalConfig(),
        records: [record],
        selectedThreadKey: 'session-a',
        messageLimit,
        findThread: (key) => (key === record.key ? record : null),
        readThreadMessages: (_record, limit) => {
            messageReads += 1
            return messages.slice(-limit)
        },
        readThreadArtifacts: () => {
            artifactReads += 1
            return artifacts
        },
        compactionStats: () => ({
            enabled: false,
            compacting: false,
            count: 0,
            lastCompactedAt: null,
            lastTokensBefore: null,
            lastError: null,
        }),
        selectedThreadModelState: () => null,
    })

    return {
        snapshot,
        messageReads,
        artifactReads,
    }
}

function minimalConfig(): PiRuntimeConfig {
    return {
        runtime: {
            displayName: 'Room',
            roomId: 'room-a',
        },
        paths: {
            workspaceDir: '/tmp/agent-room-workspace',
        },
        provider: {
            piProvider: 'openai',
            piModel: 'gpt-5',
            fallbackModels: [],
        },
    } as unknown as PiRuntimeConfig
}
