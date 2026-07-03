import { describe, expect, it } from 'vitest'

import type { RoomRealtimeEvent, RunTranscriptRow } from '#/domain/room-execution-types'

import {
    adoptRealRunId,
    emptyStreamTurnState,
    reduceRoomStreamEvent,
    type StreamTurnState,
} from './stream-state'

function realtimeEvent(event: string, payload: unknown, receivedAt: number): RoomRealtimeEvent {
    return {
        event,
        payload,
        seq: null,
        stateVersion: null,
        receivedAt,
    }
}

function transcriptOf(state: StreamTurnState): RunTranscriptRow {
    const row = state.rows.find((candidate) => candidate.type === 'run_transcript')
    if (!row || row.type !== 'run_transcript') {
        throw new Error('expected a transcript row')
    }
    return row
}

describe('adoptRealRunId', () => {
    it('rewrites a fabricated run id and its transcript row id to the authoritative id', () => {
        const accepted = reduceRoomStreamEvent(
            emptyStreamTurnState,
            realtimeEvent('run.accepted', {}, 1000),
        )
        expect(accepted.runId).toMatch(/^live-/)
        expect(transcriptOf(accepted).id).toBe(`run-transcript-${accepted.runId}`)

        const adopted = adoptRealRunId(accepted, 'real-run-9')
        expect(adopted.runId).toBe('real-run-9')
        const transcript = transcriptOf(adopted)
        expect(transcript.id).toBe('run-transcript-real-run-9')
        expect(transcript.runId).toBe('real-run-9')
    })

    it('does not clobber an already authoritative run id', () => {
        const accepted = reduceRoomStreamEvent(
            emptyStreamTurnState,
            realtimeEvent('run.accepted', { runId: 'real-run-9' }, 1000),
        )
        expect(accepted.runId).toBe('real-run-9')
        expect(adoptRealRunId(accepted, 'a-different-run')).toBe(accepted)
        expect(adoptRealRunId(accepted, 'real-run-9')).toBe(accepted)
    })

    it('keeps the transcript row id stable across later events once adopted', () => {
        let state = emptyStreamTurnState
        const feed = (event: RoomRealtimeEvent) => {
            state = adoptRealRunId(reduceRoomStreamEvent(state, event), 'real-run-9')
        }

        feed(realtimeEvent('run.accepted', {}, 1000))
        const idAfterAccept = transcriptOf(state).id
        expect(idAfterAccept).toBe('run-transcript-real-run-9')

        feed(realtimeEvent('agent_event', { event: { type: 'agent_start' } }, 1001))
        expect(transcriptOf(state).id).toBe(idAfterAccept)
        expect(state.runId).toBe('real-run-9')
    })
})
