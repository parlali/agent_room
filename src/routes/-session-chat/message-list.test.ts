import { describe, expect, it } from 'vitest'

import { createRunTranscriptRow } from '#/lib/message-list-model'
import { emptyRuntimePart } from '#/lib/runtime-message'
import type { ChatTimelineRow, RoomSessionDisplayRow } from '#/lib/room-execution-types'

import { buildTimelineRows, timelineRowKey } from './message-list'
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

    it('keeps queued pending user rows visible while an earlier run streams', () => {
        const persistedRows: RoomSessionDisplayRow[] = [
            userRow('user-1', 1),
            createRunTranscriptRow({
                id: 'run-transcript-static',
                seq: 1,
                runId: 'static',
                status: 'working',
                startedAt: 2,
                runtimeMs: null,
                collapsed: false,
                timestamp: 2,
                items: [],
            }),
            pendingUserRow('pending-user-run-2', 5),
            {
                ...createRunTranscriptRow({
                    id: 'pending-run-run-2',
                    seq: 3,
                    runId: 'run-2',
                    status: 'queued',
                    startedAt: 5,
                    runtimeMs: null,
                    collapsed: false,
                    timestamp: 5,
                    items: [],
                }),
                pending: true,
            },
        ]
        const stream = streamState([
            createRunTranscriptRow({
                id: 'run-transcript-live',
                seq: 1,
                runId: 'live',
                status: 'working',
                startedAt: 2,
                runtimeMs: null,
                collapsed: false,
                timestamp: 4,
                items: [],
            }),
        ])

        const rows = buildTimelineRows(persistedRows, stream, true, 'session-1')

        expect(rows.map((row) => row.id)).toEqual([
            'user-1',
            'run-transcript-live',
            'pending-user-run-2',
            'pending-run-run-2',
        ])
    })

    it('keeps queued rows visible by pending metadata instead of id prefix', () => {
        const persistedRows: RoomSessionDisplayRow[] = [
            userRow('user-1', 1),
            pendingUserRow('stable-user-message', 5),
            {
                ...createRunTranscriptRow({
                    id: 'stable-run-row',
                    seq: 2,
                    runId: 'run-2',
                    status: 'queued',
                    startedAt: 5,
                    runtimeMs: null,
                    collapsed: false,
                    timestamp: 5,
                    items: [],
                }),
                pending: true,
            },
        ]
        const stream = streamState([
            createRunTranscriptRow({
                id: 'run-transcript-live',
                seq: 1,
                runId: 'live',
                status: 'working',
                startedAt: 2,
                runtimeMs: null,
                collapsed: false,
                timestamp: 4,
                items: [],
            }),
        ])

        const rows = buildTimelineRows(persistedRows, stream, true, 'session-1')

        expect(rows.map((row) => row.id)).toEqual([
            'user-1',
            'run-transcript-live',
            'stable-user-message',
            'stable-run-row',
        ])
    })

    it('anchors a live stream on the matching pending run id', () => {
        const persistedRows: RoomSessionDisplayRow[] = [
            userRow('user-1', 1),
            createRunTranscriptRow({
                id: 'run-transcript-static',
                seq: 1,
                runId: 'static',
                status: 'complete',
                startedAt: 2,
                runtimeMs: 2000,
                collapsed: true,
                timestamp: 4,
                items: [],
            }),
            assistantFinalRow('static-final', 'Static final', 4),
            pendingUserRow('pending-user-run-2', 5),
            {
                ...createRunTranscriptRow({
                    id: 'pending-run-run-2',
                    seq: 4,
                    runId: 'run-2',
                    status: 'queued',
                    startedAt: 5,
                    runtimeMs: null,
                    collapsed: false,
                    timestamp: 5,
                    items: [],
                }),
                pending: true,
            },
        ]
        const stream = streamState(
            [
                createRunTranscriptRow({
                    id: 'run-transcript-live',
                    seq: 1,
                    runId: 'run-2',
                    status: 'working',
                    startedAt: 3,
                    runtimeMs: null,
                    collapsed: false,
                    timestamp: 6,
                    items: [],
                }),
            ],
            {
                runId: 'run-2',
                startedAt: 3,
            },
        )

        const rows = buildTimelineRows(persistedRows, stream, true, 'session-1')

        expect(rows.map((row) => row.id)).toEqual([
            'user-1',
            'run-transcript-static',
            'static-final',
            'pending-user-run-2',
            'run-transcript-live',
        ])
    })

    it('scopes virtual row keys to the session', () => {
        expect(timelineRowKey('session-1', assistantFinalRow('same-row', 'A', 1), 0)).toBe(
            'session-1:same-row',
        )
        expect(timelineRowKey('session-2', assistantFinalRow('same-row', 'A', 1), 0)).toBe(
            'session-2:same-row',
        )
    })
})

function streamState(
    rows: ChatTimelineRow[],
    options: {
        runId?: string
        startedAt?: number
        updatedAt?: number
    } = {},
): StreamTurnState {
    return {
        ...emptyStreamTurnState,
        runId: options.runId ?? 'live',
        status: 'complete',
        rows,
        finished: true,
        startedAt: options.startedAt ?? 2,
        updatedAt: options.updatedAt ?? 4,
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

function pendingUserRow(id: string, timestamp: number): RoomSessionDisplayRow {
    const row = userRow(id, timestamp) as Extract<
        RoomSessionDisplayRow,
        {
            type: 'user_message'
        }
    >
    return {
        ...row,
        id,
        pending: true,
        message: {
            ...row.message,
            id,
            text: 'Queued follow-up',
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
