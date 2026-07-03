import { describe, expect, it } from 'vitest'
import { buildChatTimelineRows } from './message-list-model'
import { emptyRuntimePart } from './runtime-message'
import type {
    RoomExecutionMessage,
    RoomExecutionThread,
    RunTranscriptRow,
} from './room-execution-types'
import { mapThread } from '../server/pi-runtime/runtime-snapshot'
import { normalizeThreadRecord } from '../server/pi-runtime/thread-records'

function userMessage(id: string, timestamp: number | null, text = id): RoomExecutionMessage {
    return {
        id,
        role: 'user',
        text,
        parts: [emptyRuntimePart({ type: 'text', text })],
        timestamp,
    }
}

function assistantFinal(id: string, timestamp: number, text: string): RoomExecutionMessage {
    return {
        id,
        role: 'assistant',
        text,
        parts: [emptyRuntimePart({ type: 'text', text, textPhase: 'final_answer' })],
        timestamp,
    }
}

function assistantToolCall(id: string, timestamp: number, toolName: string): RoomExecutionMessage {
    return {
        id,
        role: 'assistant',
        text: '',
        parts: [
            emptyRuntimePart({
                type: 'tool_call',
                text: toolName,
                toolName,
                toolCallId: `${id}-call`,
                status: 'complete',
                result: 'ok',
            }),
        ],
        timestamp,
    }
}

function thread(overrides: Partial<RoomExecutionThread>): RoomExecutionThread {
    return {
        key: 'thread-1',
        sessionId: 'session-1',
        agentId: 'main',
        kind: 'main',
        parentThreadKey: null,
        title: 'Conversation',
        lastMessagePreview: null,
        status: 'running',
        activeRunId: null,
        updatedAt: 3000,
        runStartedAt: 2000,
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

function transcripts(rows: ReturnType<typeof buildChatTimelineRows>): RunTranscriptRow[] {
    return rows.filter((row): row is RunTranscriptRow => row.type === 'run_transcript')
}

describe('buildChatTimelineRows run/thread binding', () => {
    it('keeps a completed run terminal and frozen while a newer run is active', () => {
        const messages = [
            userMessage('user-1', 100),
            assistantToolCall('assistant-1-tool', 150, 'Read'),
            assistantFinal('assistant-1', 200, 'answer one'),
            userMessage('user-2', 2000),
        ]
        const rows = buildChatTimelineRows(
            messages,
            true,
            thread({ activeRunId: 'run-2', runStartedAt: 2000 }),
        )
        const runs = transcripts(rows)
        const firstRun = runs.find((row) => row.runId === 'run-user-1')
        const secondRun = runs.find((row) => row.runId === 'run-user-2')

        expect(firstRun?.status).toBe('complete')
        expect(firstRun?.startedAt).toBe(100)
        expect(firstRun?.runtimeMs).toBe(100)

        expect(secondRun?.status).toBe('working')
        expect(secondRun?.startedAt).toBe(2000)
    })

    it('does not resurrect a completed run when the active run message has not materialized', () => {
        const messages = [
            userMessage('user-1', 100),
            assistantToolCall('assistant-1-tool', 150, 'Read'),
        ]
        const rows = buildChatTimelineRows(
            messages,
            true,
            thread({ activeRunId: 'run-2', runStartedAt: 2000 }),
        )
        const firstRun = transcripts(rows).find((row) => row.runId === 'run-user-1')

        expect(firstRun?.status).toBe('complete')
        expect(firstRun?.startedAt).toBe(100)
        expect(firstRun?.runtimeMs).toBe(50)
    })

    it('activates the latest run when its user message belongs to the active run', () => {
        const messages = [userMessage('user-2', 2000)]
        const rows = buildChatTimelineRows(
            messages,
            true,
            thread({ activeRunId: 'run-2', runStartedAt: 2000 }),
        )
        const run = transcripts(rows).find((row) => row.runId === 'run-user-2')

        expect(run?.status).toBe('working')
        expect(run?.startedAt).toBe(2000)
    })

    it('falls back to latest-run behavior when the read model omits activeRunId', () => {
        const legacyThread = thread({ runStartedAt: 2000 })
        delete (legacyThread as { activeRunId?: string | null }).activeRunId
        const messages = [userMessage('user-1', 100)]
        const rows = buildChatTimelineRows(messages, true, legacyThread)
        const run = transcripts(rows).find((row) => row.runId === 'run-user-1')

        expect(run?.status).toBe('working')
        expect(run?.startedAt).toBe(2000)
    })

    it('never reactivates a terminal run through the legacy fallback', () => {
        const legacyThread = thread({ runStartedAt: 2000 })
        delete (legacyThread as { activeRunId?: string | null }).activeRunId
        const messages = [
            userMessage('user-1', 100),
            assistantToolCall('assistant-1-tool', 150, 'Read'),
            assistantFinal('assistant-1', 200, 'answer one'),
        ]
        const rows = buildChatTimelineRows(messages, true, legacyThread)
        const run = transcripts(rows).find((row) => row.runId === 'run-user-1')

        expect(run?.status).toBe('complete')
    })
})

describe('buildChatTimelineRows duration pills', () => {
    it('keeps a duration pill on every completed run, including tool-free answers', () => {
        const messages = [
            userMessage('user-1', 1000),
            assistantToolCall('assistant-1-tool', 1200, 'Read'),
            assistantFinal('assistant-1', 1500, 'one'),
            userMessage('user-2', 2000),
            assistantFinal('assistant-2', 2400, 'two'),
            userMessage('user-3', 3000),
            assistantFinal('assistant-3', 3600, 'three'),
        ]
        const runs = transcripts(buildChatTimelineRows(messages, false, thread({ status: 'idle' })))
        const runtimeById = new Map(runs.map((run) => [run.runId, run.runtimeMs]))

        expect(runtimeById.get('run-user-1')).toBe(500)
        expect(runtimeById.get('run-user-2')).toBe(400)
        expect(runtimeById.get('run-user-3')).toBe(600)
    })

    it('derives a duration from run content when the user message has no timestamp', () => {
        const messages = [
            userMessage('user-1', null),
            assistantToolCall('assistant-1-tool', 1200, 'Read'),
            assistantFinal('assistant-1', 1700, 'one'),
        ]
        const run = transcripts(
            buildChatTimelineRows(messages, false, thread({ status: 'idle' })),
        ).find((row) => row.runId === 'run-user-1')

        expect(run?.runtimeMs).toBe(500)
    })
})

describe('pi runtime producer activeRunId binding', () => {
    const compaction = {
        enabled: false,
        compacting: false,
        count: 0,
        lastCompactedAt: null,
        lastTokensBefore: null,
        lastError: null,
    }

    it('materializes activeRunId while a run is active', () => {
        const record = normalizeThreadRecord({
            key: 'thread-1',
            sessionFile: '/tmp/session.jsonl',
            sessionId: 'session-1',
            title: 'Conversation',
            status: 'running',
            createdAt: 0,
            updatedAt: 10,
            activeRunId: 'run-active',
            runStartedAt: 5,
        })
        expect(mapThread(record, () => compaction).activeRunId).toBe('run-active')
    })

    it('clears activeRunId when the run is terminal', () => {
        const record = normalizeThreadRecord({
            key: 'thread-1',
            sessionFile: '/tmp/session.jsonl',
            sessionId: 'session-1',
            title: 'Conversation',
            status: 'idle',
            createdAt: 0,
            updatedAt: 10,
            activeRunId: null,
            runStartedAt: null,
        })
        expect(mapThread(record, () => compaction).activeRunId).toBeNull()
    })
})
