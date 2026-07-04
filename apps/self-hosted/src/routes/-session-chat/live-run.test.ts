import { describe, expect, it } from 'vitest'

import { emptyRuntimePart } from '#/domain/runtime-message'
import type { RoomRealtimeEvent, RoomSessionDisplayRow } from '#/domain/room-execution-types'

import {
    adoptLiveRunId,
    finishLiveRun,
    liveRunActive,
    liveRunFinished,
    persistedRunSettled,
    projectLiveRun,
    reduceLiveRunEvent,
    type LiveRun,
} from './live-run'

function realtime(event: string, payload: unknown, receivedAt: number): RoomRealtimeEvent {
    return {
        event,
        payload,
        seq: null,
        stateVersion: null,
        receivedAt,
    }
}

function runtimeEvent(event: Record<string, unknown>, receivedAt: number): RoomRealtimeEvent {
    return realtime('room-event', { event }, receivedAt)
}

function textDelta(delta: string, receivedAt: number, contentIndex = 0): RoomRealtimeEvent {
    return runtimeEvent(
        {
            type: 'message_update',
            assistantMessageEvent: {
                type: 'text_delta',
                delta,
                contentIndex,
            },
        },
        receivedAt,
    )
}

function thinkingDelta(delta: string, receivedAt: number): RoomRealtimeEvent {
    return runtimeEvent(
        {
            type: 'message_update',
            assistantMessageEvent: {
                type: 'thinking_delta',
                delta,
                contentIndex: 0,
            },
        },
        receivedAt,
    )
}

function toolStart(id: string, receivedAt: number): RoomRealtimeEvent {
    return runtimeEvent(
        {
            type: 'message_update',
            assistantMessageEvent: {
                type: 'toolcall_start',
                contentIndex: 1,
                toolCall: {
                    type: 'toolCall',
                    id,
                    name: 'read_file',
                    arguments: { path: 'a.txt' },
                },
            },
        },
        receivedAt,
    )
}

function acceptedRun(runId: string, receivedAt: number): LiveRun {
    const run = reduceLiveRunEvent(
        null,
        realtime('run.accepted', { runId, startedAtMs: receivedAt }, receivedAt),
    )
    if (!run) throw new Error('run.accepted must create a live run')
    return run
}

function userRow(id: string, seq: number): RoomSessionDisplayRow {
    return {
        type: 'user_message',
        id,
        seq,
        message: {
            id,
            role: 'user',
            text: 'prompt',
            parts: [emptyRuntimePart({ type: 'text', text: 'prompt' })],
            timestamp: 1000,
        },
        timestamp: 1000,
    }
}

describe('reduceLiveRunEvent', () => {
    it('keeps the run active with a stable transcript row when a tool call arrives', () => {
        let run: LiveRun | null = acceptedRun('run-1', 1000)
        run = reduceLiveRunEvent(run, thinkingDelta('planning', 1100))
        const beforeTool = projectLiveRun(run!)
        run = reduceLiveRunEvent(run, toolStart('tool-a', 1200))
        const afterTool = projectLiveRun(run!)

        expect(liveRunActive(run)).toBe(true)
        expect(run!.activity).toBe('working')
        expect(run!.runtimeMs).toBeNull()
        expect(afterTool[0]!.id).toBe(beforeTool[0]!.id)
        expect(afterTool[0]!.type).toBe('run_transcript')
        if (afterTool[0]!.type === 'run_transcript') {
            expect(afterTool[0]!.status).toBe('working')
            const kinds = afterTool[0]!.items.map((item) => item.type)
            expect(kinds).toContain('model_text')
            expect(kinds).toContain('tool_activity')
        }
    })

    it('reclassifies pre-tool text into the transcript without changing row identity', () => {
        let run: LiveRun | null = acceptedRun('run-1', 1000)
        run = reduceLiveRunEvent(run, textDelta('let me check that file', 1100))
        const before = projectLiveRun(run!)
        expect(before.map((row) => row.type)).toEqual(['run_transcript', 'assistant_final'])

        run = reduceLiveRunEvent(run, toolStart('tool-a', 1200))
        const after = projectLiveRun(run!)

        expect(after.map((row) => row.type)).toEqual(['run_transcript'])
        expect(after[0]!.id).toBe(before[0]!.id)
        if (after[0]!.type === 'run_transcript') {
            const texts = after[0]!.items.filter((item) => item.type === 'model_text')
            expect(texts.some((item) => item.markdown.includes('let me check'))).toBe(true)
        }
    })

    it('streams trailing text as the answer and freezes on finish', () => {
        let run: LiveRun | null = acceptedRun('run-1', 1000)
        run = reduceLiveRunEvent(run, toolStart('tool-a', 1100))
        run = reduceLiveRunEvent(run, textDelta('the answer is ', 1200))
        run = reduceLiveRunEvent(run, textDelta('42', 1250))

        const streaming = projectLiveRun(run!)
        const answer = streaming.find((row) => row.type === 'assistant_final')
        expect(answer).toBeDefined()
        if (answer?.type === 'assistant_final') {
            expect(answer.message.text).toBe('the answer is 42')
            expect(answer.id).toBe('live-final-run-1')
        }

        run = reduceLiveRunEvent(
            run,
            realtime('run.finished', { runId: 'run-1', durationMs: 900 }, 2000),
        )
        expect(liveRunFinished(run)).toBe(true)
        expect(run!.runtimeMs).toBe(900)
        const finished = projectLiveRun(run!)
        if (finished[0]!.type === 'run_transcript') {
            expect(finished[0]!.status).toBe('complete')
            expect(finished[0]!.runtimeMs).toBe(900)
        }
        const finishedAnswer = finished.find((row) => row.type === 'assistant_final')
        if (finishedAnswer?.type === 'assistant_final') {
            expect(finishedAnswer.streaming).toBe(false)
            expect(finishedAnswer.id).toBe('live-final-run-1')
        }
    })

    it('ignores further events after the run finished', () => {
        let run: LiveRun | null = acceptedRun('run-1', 1000)
        run = reduceLiveRunEvent(run, realtime('run.finished', { runId: 'run-1' }, 1500))
        const frozen = run
        run = reduceLiveRunEvent(run, textDelta('late token', 1600))
        expect(run).toBe(frozen)
    })

    it('creates an implicit run for events that arrive before run.accepted', () => {
        const run = reduceLiveRunEvent(null, thinkingDelta('early', 1000))
        expect(run).not.toBeNull()
        expect(run!.runId.startsWith('live-')).toBe(true)
        const adopted = adoptLiveRunId(run, 'run-real')
        expect(adopted!.runId).toBe('run-real')
        expect(projectLiveRun(adopted!)[0]!.id).toBe('run-transcript-run-real')
    })

    it('marks the run errored with a visible message on run.error', () => {
        let run: LiveRun | null = acceptedRun('run-1', 1000)
        run = reduceLiveRunEvent(
            run,
            realtime('run.error', { runId: 'run-1', message: 'boom' }, 1500),
        )
        expect(liveRunFinished(run)).toBe(true)
        expect(run!.outcome).toBe('error')
        const rows = projectLiveRun(run!)
        if (rows[0]!.type === 'run_transcript') {
            expect(rows[0]!.status).toBe('error')
            expect(
                rows[0]!.items.some(
                    (item) => item.type === 'model_text' && item.markdown.includes('boom'),
                ),
            ).toBe(true)
        }
    })

    it('stops running tools when the run is stopped', () => {
        let run: LiveRun | null = acceptedRun('run-1', 1000)
        run = reduceLiveRunEvent(run, toolStart('tool-a', 1100))
        const stopped = finishLiveRun(run!, 'stopped', 2000)
        expect(stopped.outcome).toBe('stopped')
        const rows = projectLiveRun(stopped)
        if (rows[0]!.type === 'run_transcript') {
            const tool = rows[0]!.items.find((item) => item.type === 'tool_activity')
            expect(tool?.type === 'tool_activity' && tool.task.status).toBe('stopped')
        }
    })
})

describe('persistedRunSettled', () => {
    it('stays false while persisted rows for the run are pending or active', () => {
        const run = finishLiveRun(acceptedRun('run-1', 1000), 'complete', 2000)
        const rows: RoomSessionDisplayRow[] = [
            userRow('user-1', 0),
            {
                type: 'run_transcript',
                id: 'run-transcript-run-1',
                seq: 1,
                runId: 'run-1',
                status: 'working',
                startedAt: 1000,
                runtimeMs: null,
                collapsed: false,
                items: [],
                timestamp: 1500,
            },
        ]
        expect(persistedRunSettled(rows, run)).toBe(false)
    })

    it('requires the persisted answer when the live run produced one', () => {
        let live: LiveRun | null = acceptedRun('run-1', 1000)
        live = reduceLiveRunEvent(live, textDelta('final answer', 1100))
        live = reduceLiveRunEvent(live, realtime('run.finished', { runId: 'run-1' }, 1500))
        const settledTranscriptOnly: RoomSessionDisplayRow[] = [
            userRow('user-1', 0),
            {
                type: 'run_transcript',
                id: 'run-transcript-run-1',
                seq: 1,
                runId: 'run-1',
                status: 'complete',
                startedAt: 1000,
                runtimeMs: 500,
                collapsed: true,
                items: [],
                timestamp: 1500,
            },
        ]
        expect(persistedRunSettled(settledTranscriptOnly, live!)).toBe(false)
        const withAnswer: RoomSessionDisplayRow[] = [
            ...settledTranscriptOnly,
            {
                type: 'assistant_final',
                id: 'assistant-1',
                seq: 2,
                message: {
                    id: 'assistant-1',
                    role: 'assistant',
                    text: 'final answer',
                    parts: [emptyRuntimePart({ type: 'text', text: 'final answer' })],
                    timestamp: 1500,
                },
                streaming: false,
                timestamp: 1500,
            },
        ]
        expect(persistedRunSettled(withAnswer, live!)).toBe(true)
    })

    it('settles a tool-only run on a terminal transcript row', () => {
        let live: LiveRun | null = acceptedRun('run-1', 1000)
        live = reduceLiveRunEvent(live, toolStart('tool-a', 1100))
        live = reduceLiveRunEvent(live, realtime('run.finished', { runId: 'run-1' }, 1500))
        const rows: RoomSessionDisplayRow[] = [
            userRow('user-1', 0),
            {
                type: 'run_transcript',
                id: 'run-transcript-run-1',
                seq: 1,
                runId: 'run-1',
                status: 'complete',
                startedAt: 1000,
                runtimeMs: 500,
                collapsed: true,
                items: [],
                timestamp: 1500,
            },
        ]
        expect(persistedRunSettled(rows, live!)).toBe(true)
    })
})
