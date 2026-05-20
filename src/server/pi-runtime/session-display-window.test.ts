import { describe, expect, it } from 'vitest'
import type { SessionEntry } from '@mariozechner/pi-coding-agent'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import type { RoomExecutionThread } from '../rooms/execution-types'
import { createSessionWindowStore } from './session-display-window'
import { hiddenProjectionEntryType } from './hidden-projection'
import type { ThreadRecord } from './thread-records'

const config = {
    paths: {
        workspaceDir: '/tmp/agent-room-workspace',
        storeDir: '/tmp/agent-room-store',
    },
} as PiRuntimeConfig

describe('createSessionWindowStore', () => {
    it('returns a latest display window without raw tool payloads', () => {
        const record = threadRecord('thread-a')
        const store = createSessionWindowStore({
            config,
            readThreadEntries: () => [
                messageEntry('u1', null, 'user', 'Check src/app.ts'),
                {
                    type: 'message',
                    id: 'a1',
                    parentId: 'u1',
                    timestamp: '2026-05-12T10:00:01.000Z',
                    message: {
                        role: 'assistant',
                        content: [
                            {
                                type: 'toolCall',
                                id: 'call-1',
                                name: 'agent_room_read',
                                arguments: {
                                    path: 'src/app.ts',
                                    token: 'secret-value-that-must-not-leak',
                                },
                            },
                        ],
                    },
                } as unknown as SessionEntry,
                {
                    type: 'message',
                    id: 't1',
                    parentId: 'a1',
                    timestamp: '2026-05-12T10:00:02.000Z',
                    message: {
                        role: 'toolResult',
                        toolCallId: 'call-1',
                        toolName: 'agent_room_read',
                        content: [
                            {
                                type: 'text',
                                text: 'very large file body that should not be in the display row',
                            },
                        ],
                    },
                } as unknown as SessionEntry,
                messageEntry('a2', 't1', 'assistant', 'Done'),
            ],
        })

        const window = store.window({
            record,
            thread: executionThread(record),
            limitRows: 10,
        })

        expect(window.rows.map((row) => row.type)).toEqual([
            'user_message',
            'run_transcript',
            'assistant_final',
        ])
        expect(JSON.stringify(window)).not.toContain('secret-value-that-must-not-leak')
        expect(JSON.stringify(window)).not.toContain('very large file body')
    })

    it('pages older rows by cursor', () => {
        const record = threadRecord('thread-b')
        const entries = Array.from({ length: 5 }, (_, index) =>
            messageEntry(
                `u${index}`,
                index === 0 ? null : `u${index - 1}`,
                'user',
                `Message ${index}`,
            ),
        )
        const store = createSessionWindowStore({
            config,
            readThreadEntries: () => entries,
        })

        const latest = store.window({
            record,
            thread: executionThread(record),
            limitRows: 2,
        })
        const older = store.window({
            record,
            thread: executionThread(record),
            before: latest.beforeCursor,
            limitRows: 2,
        })

        expect(latest.rows.map((row) => row.id)).toEqual(['u3', 'u4'])
        expect(latest.beforeCursor).toBe('3')
        expect(older.rows.map((row) => row.id)).toEqual(['u1', 'u2'])
        expect(older.beforeCursor).toBe('1')
    })

    it('keeps persisted assistant status text around tool rows', () => {
        const record = threadRecord('thread-c')
        const store = createSessionWindowStore({
            config,
            readThreadEntries: () => [
                messageEntry('u1', null, 'user', 'Fix the bug'),
                {
                    type: 'message',
                    id: 'a1',
                    parentId: 'u1',
                    timestamp: '2026-05-12T10:00:01.000Z',
                    message: {
                        role: 'assistant',
                        content: [
                            {
                                type: 'text',
                                text: 'Checking the failing path',
                                textSignature: '{"v":1,"id":"msg-status","phase":"commentary"}',
                            },
                            {
                                type: 'toolCall',
                                id: 'call-1',
                                name: 'agent_room_read',
                                arguments: {
                                    path: 'src/app.ts',
                                },
                            },
                        ],
                    },
                } as unknown as SessionEntry,
                {
                    type: 'message',
                    id: 't1',
                    parentId: 'a1',
                    timestamp: '2026-05-12T10:00:02.000Z',
                    message: {
                        role: 'toolResult',
                        toolCallId: 'call-1',
                        toolName: 'agent_room_read',
                        content: [
                            {
                                type: 'text',
                                text: 'file contents',
                            },
                        ],
                    },
                } as unknown as SessionEntry,
                {
                    type: 'message',
                    id: 'a2',
                    parentId: 't1',
                    timestamp: '2026-05-12T10:00:03.000Z',
                    message: {
                        role: 'assistant',
                        content: [
                            {
                                type: 'text',
                                text: 'Fixed and verified',
                                textSignature: '{"v":1,"id":"msg-final","phase":"final_answer"}',
                            },
                        ],
                    },
                } as unknown as SessionEntry,
            ],
        })

        const window = store.window({
            record,
            thread: executionThread(record),
            limitRows: 10,
        })

        expect(window.rows.map((row) => row.type)).toEqual([
            'user_message',
            'run_transcript',
            'assistant_final',
        ])
        expect(window.rows[1]).toMatchObject({
            type: 'run_transcript',
            items: [
                {
                    type: 'model_text',
                    markdown: 'Checking the failing path',
                    phase: 'commentary',
                    contentIndex: 0,
                },
                {
                    type: 'tool_activity',
                    toolCallId: 'call-1',
                },
            ],
        })
        expect(window.rows[2]).toMatchObject({
            type: 'assistant_final',
            message: {
                text: 'Fixed and verified',
                parts: [
                    {
                        textPhase: 'final_answer',
                    },
                ],
            },
        })
    })

    it('hides internal projected user messages from display windows', () => {
        const record = threadRecord('thread-hidden')
        const store = createSessionWindowStore({
            config,
            readThreadEntries: () => [
                messageEntry('u-hidden', null, 'user', 'internal onboarding instruction'),
                {
                    type: 'custom',
                    id: 'hide-1',
                    customType: hiddenProjectionEntryType,
                    data: { hiddenEntryId: 'u-hidden' },
                    parentId: 'u-hidden',
                    timestamp: '2026-05-12T10:00:00.500Z',
                } as unknown as SessionEntry,
                messageEntry('a1', 'hide-1', 'assistant', 'What should this room help with?'),
            ],
        })

        const window = store.window({
            record,
            thread: executionThread(record),
            limitRows: 10,
        })

        expect(JSON.stringify(window.rows)).not.toContain('internal onboarding instruction')
        expect(window.rows.map((row) => row.type)).toEqual(['assistant_final'])
    })
})

function messageEntry(
    id: string,
    parentId: string | null,
    role: 'user' | 'assistant',
    text: string,
): SessionEntry {
    return {
        type: 'message',
        id,
        parentId,
        timestamp: '2026-05-12T10:00:00.000Z',
        message: {
            role,
            content: text,
        },
    } as unknown as SessionEntry
}

function threadRecord(key: string): ThreadRecord {
    return {
        key,
        sessionFile: `/tmp/${key}.jsonl`,
        sessionId: key,
        title: key,
        titleSource: 'initial',
        status: 'idle',
        createdAt: 1,
        updatedAt: Date.now(),
        lastMessagePreview: null,
        modelProvider: null,
        model: null,
        thinkingLevel: null,
        speedMode: null,
        activeRunId: null,
        activeRunKind: null,
        heartbeatAt: null,
        runStartedAt: null,
        runBudgetExpiresAt: null,
        idleTimeoutExpiresAt: null,
        activeDurationMs: 0,
        idleDurationMs: 0,
        lastError: null,
        kind: 'main',
        parentThreadKey: null,
        parentRunId: null,
        subagentRunId: null,
        subagentName: null,
        subagentTask: null,
        deepWorkRunId: null,
        deepWorkObjective: null,
        completedAt: null,
    }
}

function executionThread(record: ThreadRecord): RoomExecutionThread {
    return {
        key: record.key,
        sessionId: record.sessionId,
        agentId: 'main',
        kind: record.kind,
        parentThreadKey: record.parentThreadKey,
        title: record.title,
        lastMessagePreview: null,
        status: record.status,
        updatedAt: record.updatedAt,
        runStartedAt: record.runStartedAt,
        runtimeMs: null,
        model: null,
        modelProvider: null,
        totalTokens: null,
        estimatedCostUsd: null,
        readState: {
            readAt: null,
            unread: false,
        },
        compaction: {
            enabled: true,
            compacting: false,
            count: 0,
            lastCompactedAt: null,
            lastTokensBefore: null,
            lastError: null,
        },
    }
}
