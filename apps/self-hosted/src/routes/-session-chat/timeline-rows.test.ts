import { describe, expect, it } from 'vitest'

import { emptyRuntimePart } from '#/domain/runtime-message'
import type {
    ChatTimelineRow,
    RoomSessionDisplayRow,
    RunTranscriptRow,
} from '#/domain/room-execution-types'

import { emptyStreamTurnState, type StreamTurnState } from './stream-state'
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

function transcriptRow(runId: string, markdown: string, updatedAt: number): RunTranscriptRow {
    return {
        type: 'run_transcript',
        id: `run-transcript-${runId}`,
        seq: 0,
        runId,
        status: 'responding',
        startedAt: 1000,
        runtimeMs: null,
        collapsed: false,
        items: [
            {
                type: 'model_text',
                id: 'model-text-0-thinking-0',
                turnIndex: 0,
                contentIndex: 0,
                markdown,
                complete: false,
                phase: 'thinking',
                timestamp: updatedAt,
            },
        ],
        timestamp: updatedAt,
    }
}

function streamWith(rows: ChatTimelineRow[], updatedAt: number): StreamTurnState {
    return {
        ...emptyStreamTurnState,
        runId: 'live-run-1',
        status: 'responding',
        rows,
        startedAt: 1000,
        updatedAt,
    }
}

describe('buildTimelineRows reference stability', () => {
    it('keeps unchanged row identities when only the live transcript delta changes', () => {
        const persisted = [
            userRow('user-1', 0, 'hello'),
            assistantFinalRow('assistant-prior', 1, 'previous answer'),
        ]

        const first = buildTimelineRows(
            persisted,
            streamWith([transcriptRow('live-run-1', 'thinking about', 2000)], 2000),
            true,
            'session-1',
            [],
        )

        const second = buildTimelineRows(
            persisted,
            streamWith([transcriptRow('live-run-1', 'thinking about it', 2001)], 2001),
            true,
            'session-1',
            first,
        )

        expect(second[0]).toBe(first[0])
        expect(second[1]).toBe(first[1])
        expect(second[2]).not.toBe(first[2])
        expect(second.map((row) => row.id)).toEqual([
            'user-1',
            'assistant-prior',
            'run-transcript-live-run-1',
        ])
    })

    it('reuses identities when nothing changed between rebuilds', () => {
        const persisted = [userRow('user-1', 0, 'hello')]
        const stream = streamWith([transcriptRow('live-run-1', 'steady', 2000)], 2000)

        const first = buildTimelineRows(persisted, stream, true, 'session-1', [])
        const second = buildTimelineRows(persisted, stream, true, 'session-1', first)

        expect(second[0]).toBe(first[0])
        expect(second[1]).toBe(first[1])
    })
})
