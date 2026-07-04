import { describe, expect, it } from 'vitest'

import { emptyRuntimePart } from '#/domain/runtime-message'
import type { RoomSessionDisplayRow, RunTranscriptRow } from '#/domain/room-execution-types'

import type { LiveRun } from './live-run'
import { buildTimelineRows } from './timeline-rows'

function userRow(id: string, seq: number, text: string): RoomSessionDisplayRow {
    return {
        type: 'user_message',
        id,
        seq,
        message: {
            id,
            role: 'user',
            text,
            parts: [emptyRuntimePart({ type: 'text', text })],
            timestamp: 1000,
        },
        timestamp: 1000,
    }
}

function assistantFinalRow(id: string, seq: number, text: string): RoomSessionDisplayRow {
    return {
        type: 'assistant_final',
        id,
        seq,
        message: {
            id,
            role: 'assistant',
            text,
            parts: [emptyRuntimePart({ type: 'text', text })],
            timestamp: 1100,
        },
        streaming: false,
        timestamp: 1100,
    }
}

function persistedTranscriptRow(
    runId: string,
    status: RunTranscriptRow['status'],
): RunTranscriptRow {
    return {
        type: 'run_transcript',
        id: `run-transcript-${runId}`,
        seq: 0,
        runId,
        status,
        startedAt: 1000,
        runtimeMs: status === 'complete' ? 1234 : null,
        collapsed: true,
        items: [],
        timestamp: 1200,
    }
}

function liveRunWith(overrides: Partial<LiveRun> = {}): LiveRun {
    return {
        runId: 'run-1',
        activity: 'thinking',
        outcome: null,
        startedAt: 1000,
        runtimeMs: null,
        updatedAt: 2000,
        turnIndex: 0,
        segments: [
            {
                kind: 'thinking',
                id: 'thinking-0-stream',
                turnIndex: 0,
                text: 'thinking about it',
                done: false,
                timestamp: 2000,
            },
        ],
        errorText: null,
        ...overrides,
    }
}

describe('buildTimelineRows ownership', () => {
    it('suppresses every persisted row after the last user message while a run is live', () => {
        const persisted = [
            userRow('user-1', 0, 'earlier'),
            assistantFinalRow('assistant-prior', 1, 'previous answer'),
            userRow('user-2', 2, 'current prompt'),
            persistedTranscriptRow('run-1', 'working'),
            assistantFinalRow('assistant-partial', 4, 'stale partial'),
        ]

        const rows = buildTimelineRows(persisted, liveRunWith(), true, 'session-1', [])

        expect(rows.map((row) => row.id)).toEqual([
            'user-1',
            'assistant-prior',
            'user-2',
            'run-transcript-run-1',
        ])
    })

    it('suppresses mid-run persisted rows even when their status looks terminal', () => {
        const persisted = [
            userRow('user-1', 0, 'prompt'),
            persistedTranscriptRow('run-1', 'complete'),
        ]

        const rows = buildTimelineRows(persisted, liveRunWith(), true, 'session-1', [])

        expect(rows.map((row) => row.id)).toEqual(['user-1', 'run-transcript-run-1'])
        const transcript = rows[1]
        expect(transcript.type).toBe('run_transcript')
        if (transcript.type === 'run_transcript') {
            expect(transcript.status).toBe('thinking')
        }
    })

    it('renders persisted rows untouched when no run is live', () => {
        const persisted = [
            userRow('user-1', 0, 'prompt'),
            persistedTranscriptRow('run-1', 'complete'),
            assistantFinalRow('assistant-1', 2, 'the answer'),
        ]

        const rows = buildTimelineRows(persisted, null, false, 'session-1', [])

        expect(rows.map((row) => row.id)).toEqual(['user-1', 'run-transcript-run-1', 'assistant-1'])
    })

    it('adds a pending placeholder when working with no live run and no active transcript', () => {
        const persisted = [userRow('user-1', 0, 'prompt')]

        const rows = buildTimelineRows(persisted, null, true, 'session-1', [])

        expect(rows.map((row) => row.id)).toEqual(['user-1', 'run-transcript-pending-session-1'])
    })
})

describe('buildTimelineRows reference stability', () => {
    it('keeps unchanged row identities when only the live run delta changes', () => {
        const persisted = [
            userRow('user-1', 0, 'hello'),
            assistantFinalRow('assistant-prior', 1, 'previous answer'),
            userRow('user-2', 2, 'current prompt'),
        ]

        const first = buildTimelineRows(persisted, liveRunWith(), true, 'session-1', [])
        const second = buildTimelineRows(
            persisted,
            liveRunWith({
                updatedAt: 2001,
                segments: [
                    {
                        kind: 'thinking',
                        id: 'thinking-0-stream',
                        turnIndex: 0,
                        text: 'thinking about it more',
                        done: false,
                        timestamp: 2001,
                    },
                ],
            }),
            true,
            'session-1',
            first,
        )

        expect(second[0]).toBe(first[0])
        expect(second[1]).toBe(first[1])
        expect(second[2]).toBe(first[2])
        expect(second[3]).not.toBe(first[3])
        expect(second.map((row) => row.id)).toEqual([
            'user-1',
            'assistant-prior',
            'user-2',
            'run-transcript-run-1',
        ])
    })

    it('reuses identities when nothing changed between rebuilds', () => {
        const persisted = [userRow('user-1', 0, 'hello')]
        const run = liveRunWith()

        const first = buildTimelineRows(persisted, run, true, 'session-1', [])
        const second = buildTimelineRows(persisted, run, true, 'session-1', first)

        expect(second[0]).toBe(first[0])
        expect(second[1]).toBe(first[1])
    })
})
