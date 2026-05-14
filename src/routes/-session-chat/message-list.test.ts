import { describe, expect, it } from 'vitest'

import { createRunTranscriptRow } from '#/lib/message-list-model'
import { emptyRuntimePart } from '#/lib/runtime-message'
import type { ChatTimelineRow, RoomSessionDisplayRow } from '#/lib/room-execution-types'

import { buildTimelineRows } from './message-list'
import { emptyStreamTurnState, type StreamTurnState } from './stream-state'

describe('message list stream merge', () => {
    it('lets the live stream own the active run until static rows fully replace it', () => {
        const persistedRows: RoomSessionDisplayRow[] = [
            userRow('user-1', 1),
            createRunTranscriptRow({
                id: 'run-transcript-static',
                seq: 1,
                runId: 'static',
                status: 'complete',
                startedAt: 1,
                runtimeMs: null,
                collapsed: true,
                timestamp: 3,
                items: [],
            }),
            assistantFinalRow('static-final', 'Static final', 4),
        ]
        const stream = streamState([
            createRunTranscriptRow({
                id: 'run-transcript-live',
                seq: 1,
                runId: 'live',
                status: 'complete',
                startedAt: 2,
                runtimeMs: 2000,
                collapsed: true,
                timestamp: 4,
                items: [],
            }),
            assistantFinalRow('live-final', 'Live final', 4),
        ])

        const rows = buildTimelineRows(persistedRows, stream, true, 'session-1')

        expect(rows.map((row) => row.id)).toEqual(['user-1', 'run-transcript-live', 'live-final'])
    })

    it('suppresses current static final rows during a no-user live run', () => {
        const persistedRows: RoomSessionDisplayRow[] = [
            assistantFinalRow('old-final', 'Old final', 1),
            assistantFinalRow('static-final', 'Static final', 4),
        ]
        const stream = streamState([assistantFinalRow('live-final', 'Live final', 4)])

        const rows = buildTimelineRows(persistedRows, stream, true, 'session-1')

        expect(rows.map((row) => row.id)).toEqual(['old-final', 'live-final'])
    })
})

function streamState(rows: ChatTimelineRow[]): StreamTurnState {
    return {
        ...emptyStreamTurnState,
        runId: 'live',
        status: 'complete',
        rows,
        finished: true,
        startedAt: 2,
        updatedAt: 4,
    }
}

function userRow(id: string, timestamp: number): RoomSessionDisplayRow {
    return {
        type: 'user_message',
        id,
        seq: 0,
        timestamp,
        message: {
            id,
            role: 'user',
            text: 'Run',
            parts: [
                emptyRuntimePart({
                    type: 'text',
                    text: 'Run',
                }),
            ],
            timestamp,
        },
    }
}

function assistantFinalRow(id: string, text: string, timestamp: number): ChatTimelineRow {
    return {
        type: 'assistant_final',
        id,
        seq: 0,
        streaming: false,
        timestamp,
        message: {
            id,
            role: 'assistant',
            text,
            parts: [
                emptyRuntimePart({
                    type: 'text',
                    text,
                    textPhase: 'final_answer',
                }),
            ],
            timestamp,
        },
    }
}
