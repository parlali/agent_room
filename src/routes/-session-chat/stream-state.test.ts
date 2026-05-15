import { describe, expect, it } from 'vitest'
import type { RoomRealtimeEvent, RunTranscriptRow } from '#/lib/room-execution-types'
import { emptyStreamTurnState, reduceRoomStreamEvent, stopStreamTurn } from './stream-state'

describe('stream turn reducer', () => {
    it('uses server run start time from accepted events', () => {
        const state = reduceRoomStreamEvent(
            emptyStreamTurnState,
            realtimeAt(
                'run.accepted',
                {
                    runId: 'run-1',
                    startedAt: '2026-05-14T21:00:00.000Z',
                    startedAtMs: 1_000,
                },
                5_000,
            ),
        )

        expect(state.startedAt).toBe(1_000)
        expect(transcriptRow(state).startedAt).toBe(1_000)
    })

    it('settles provider rejection events as visible transcript errors', () => {
        const state = reduceRoomStreamEvent(
            emptyStreamTurnState,
            realtimeAt(
                'run.error',
                {
                    runId: 'run-1',
                    message: 'cyber_policy rejected the request',
                    startedAtMs: 1_000,
                },
                4_000,
            ),
        )
        const transcript = transcriptRow(state)

        expect(state).toMatchObject({
            status: 'error',
            finished: true,
        })
        expect(transcript).toMatchObject({
            status: 'error',
            runtimeMs: 3_000,
        })
        expect(transcript.items[0]).toMatchObject({
            type: 'model_text',
            markdown: 'Run failed: cyber_policy rejected the request',
            complete: true,
        })
    })

    it('keeps commentary text ordered around tool activity and final text', () => {
        let state = reduceRoomStreamEvent(
            emptyStreamTurnState,
            realtime('run.accepted', {
                runId: 'run-1',
            }),
        )

        state = reduceRoomStreamEvent(
            state,
            assistantUpdate({
                type: 'text_delta',
                contentIndex: 0,
                delta: 'Checking logs',
                partial: assistantPartial([textBlock('Checking logs', 'commentary')]),
            }),
        )
        state = reduceRoomStreamEvent(
            state,
            assistantUpdate({
                type: 'text_end',
                contentIndex: 0,
                content: 'Checking logs',
                partial: assistantPartial([textBlock('Checking logs', 'commentary')]),
            }),
        )
        state = reduceRoomStreamEvent(
            state,
            assistantUpdate({
                type: 'toolcall_start',
                contentIndex: 1,
                partial: assistantPartial([
                    textBlock('Checking logs', 'commentary'),
                    toolBlock('call-1', 'src/app.ts'),
                ]),
            }),
        )
        state = reduceRoomStreamEvent(
            state,
            runtimeEvent('tool_execution_end', {
                type: 'tool_execution_end',
                toolCallId: 'call-1',
                toolName: 'agent_room_read',
                result: {
                    content: [
                        {
                            type: 'text',
                            text: 'file contents',
                        },
                    ],
                },
            }),
        )
        state = reduceRoomStreamEvent(
            state,
            runtimeEvent('turn_end', {
                type: 'turn_end',
                message: {
                    role: 'assistant',
                    content: [
                        textBlock('Checking logs', 'commentary'),
                        toolBlock('call-1', 'src/app.ts'),
                        textBlock('Done', 'final_answer'),
                    ],
                },
            }),
        )

        expect(state.rows.map((row) => row.type)).toEqual(['run_transcript', 'assistant_final'])
        const transcript = transcriptRow(state)
        expect(transcript.items.map((item) => item.type)).toEqual(['model_text', 'tool_activity'])
        expect(transcript.items[0]).toMatchObject({
            type: 'model_text',
            markdown: 'Checking logs',
            phase: 'commentary',
        })
        expect(transcript.items[1]).toMatchObject({
            type: 'tool_activity',
            toolCallId: 'call-1',
            task: {
                status: 'complete',
            },
        })
        expect(state.rows[1]).toMatchObject({
            type: 'assistant_final',
            message: {
                text: 'Done',
            },
        })
    })

    it('keeps text phase from compacted text delta payloads', () => {
        let state = reduceRoomStreamEvent(
            emptyStreamTurnState,
            realtime('run.accepted', {
                runId: 'run-1',
            }),
        )
        state = reduceRoomStreamEvent(
            state,
            assistantUpdate({
                type: 'toolcall_start',
                contentIndex: 0,
                partial: assistantPartial([toolBlock('call-1', 'src/app.ts')]),
            }),
        )
        state = reduceRoomStreamEvent(
            state,
            assistantUpdate({
                type: 'text_delta',
                contentIndex: 1,
                delta: 'Done',
                partial: assistantPartial([
                    toolBlock('call-1', 'src/app.ts'),
                    {
                        type: 'text',
                        textSignature: `{"v":1,"id":"final-delta","phase":"final_answer"}`,
                    },
                ]),
            }),
        )

        expect(state.rows.map((row) => row.type)).toEqual(['run_transcript', 'assistant_final'])
        expect(state.rows[1]).toMatchObject({
            type: 'assistant_final',
            message: {
                text: 'Done',
            },
        })
    })

    it('preserves commentary between two tool turns', () => {
        let state = reduceRoomStreamEvent(
            emptyStreamTurnState,
            realtime('run.accepted', {
                runId: 'run-1',
            }),
        )
        state = reduceRoomStreamEvent(
            state,
            runtimeEvent('turn_end', {
                type: 'turn_end',
                message: {
                    role: 'assistant',
                    content: [
                        textBlock('Checking first path', 'commentary'),
                        toolBlock('call-1', 'a.ts'),
                    ],
                },
            }),
        )
        state = reduceRoomStreamEvent(
            state,
            runtimeEvent('tool_execution_end', {
                type: 'tool_execution_end',
                toolCallId: 'call-1',
                toolName: 'agent_room_read',
                result: {
                    content: [
                        {
                            type: 'text',
                            text: 'first contents',
                        },
                    ],
                },
            }),
        )
        state = reduceRoomStreamEvent(
            state,
            runtimeEvent('turn_end', {
                type: 'turn_end',
                message: {
                    role: 'assistant',
                    content: [
                        textBlock('Now checking the second path', 'commentary'),
                        toolBlock('call-2', 'b.ts'),
                    ],
                },
            }),
        )

        const transcript = transcriptRow(state)
        expect(transcript.items.map((item) => item.type)).toEqual([
            'model_text',
            'tool_activity',
            'model_text',
            'tool_activity',
        ])
        expect(transcript.items[2]).toMatchObject({
            type: 'model_text',
            markdown: 'Now checking the second path',
        })
    })

    it('moves unknown live text into the transcript if a tool call starts later in the turn', () => {
        let state = reduceRoomStreamEvent(
            emptyStreamTurnState,
            realtime('run.accepted', {
                runId: 'run-1',
            }),
        )
        state = reduceRoomStreamEvent(
            state,
            assistantUpdate({
                type: 'text_delta',
                contentIndex: 0,
                delta: 'I will inspect the file',
                partial: assistantPartial([
                    {
                        type: 'text',
                        text: 'I will inspect the file',
                    },
                ]),
            }),
        )
        expect(state.rows.map((row) => row.type)).toEqual(['run_transcript', 'assistant_final'])

        state = reduceRoomStreamEvent(
            state,
            assistantUpdate({
                type: 'toolcall_start',
                contentIndex: 1,
                partial: assistantPartial([
                    {
                        type: 'text',
                        text: 'I will inspect the file',
                    },
                    toolBlock('call-1', 'src/app.ts'),
                ]),
            }),
        )

        expect(state.rows.map((row) => row.type)).toEqual(['run_transcript'])
        expect(transcriptRow(state).items).toMatchObject([
            {
                type: 'model_text',
                markdown: 'I will inspect the file',
            },
            {
                type: 'tool_activity',
                toolCallId: 'call-1',
            },
        ])
    })

    it('streams thinking deltas as visible model text in the transcript', () => {
        let state = reduceRoomStreamEvent(
            emptyStreamTurnState,
            realtime('run.accepted', {
                runId: 'run-1',
            }),
        )
        state = reduceRoomStreamEvent(
            state,
            assistantUpdate({
                type: 'thinking_delta',
                contentIndex: 0,
                delta: 'hidden',
                partial: assistantPartial([
                    {
                        type: 'thinking',
                        thinking: 'hidden',
                    },
                ]),
            }),
        )
        state = reduceRoomStreamEvent(
            state,
            assistantUpdate({
                type: 'thinking_end',
                contentIndex: 0,
                content: 'hidden',
                partial: assistantPartial([
                    {
                        type: 'thinking',
                        thinking: 'hidden',
                    },
                ]),
            }),
        )

        expect(transcriptRow(state).items).toEqual([
            expect.objectContaining({
                type: 'model_text',
                markdown: 'hidden',
                complete: true,
                phase: 'thinking',
                contentIndex: 0,
            }),
        ])
    })

    it('keeps thinking, tool chunks, interim text, and final text in run order', () => {
        let state = reduceRoomStreamEvent(
            emptyStreamTurnState,
            realtime('run.accepted', {
                runId: 'run-1',
            }),
        )
        state = reduceRoomStreamEvent(
            state,
            assistantUpdate({
                type: 'thinking_delta',
                contentIndex: 0,
                delta: 'Thinking through sources',
                partial: assistantPartial([thinkingBlock('Thinking through sources')]),
            }),
        )
        state = reduceRoomStreamEvent(
            state,
            runtimeEvent('turn_end', {
                type: 'turn_end',
                message: {
                    role: 'assistant',
                    content: [
                        thinkingBlock('Thinking through sources'),
                        toolBlock('call-1', 'a.ts'),
                        toolBlock('call-2', 'b.ts'),
                        toolBlock('call-3', 'c.ts'),
                    ],
                },
            }),
        )
        state = reduceRoomStreamEvent(
            state,
            runtimeEvent('turn_end', {
                type: 'turn_end',
                message: {
                    role: 'assistant',
                    content: [
                        textBlock('Reading those results', 'commentary'),
                        toolBlock('call-4', 'd.ts'),
                        toolBlock('call-5', 'e.ts'),
                    ],
                },
            }),
        )
        state = reduceRoomStreamEvent(
            state,
            runtimeEvent('turn_end', {
                type: 'turn_end',
                message: {
                    role: 'assistant',
                    content: [
                        textBlock('Checking final sources', 'commentary'),
                        toolBlock('call-6', 'f.ts'),
                        toolBlock('call-7', 'g.ts'),
                        toolBlock('call-8', 'h.ts'),
                        toolBlock('call-9', 'i.ts'),
                        toolBlock('call-10', 'j.ts'),
                    ],
                },
            }),
        )
        state = reduceRoomStreamEvent(
            state,
            runtimeEvent('turn_end', {
                type: 'turn_end',
                message: {
                    role: 'assistant',
                    content: [textBlock('Final answer', 'final_answer')],
                },
            }),
        )

        expect(state.rows.map((row) => row.type)).toEqual(['run_transcript', 'assistant_final'])
        const transcript = transcriptRow(state)
        expect(transcript.items.map((item) => item.type)).toEqual([
            'model_text',
            'tool_activity',
            'tool_activity',
            'tool_activity',
            'model_text',
            'tool_activity',
            'tool_activity',
            'model_text',
            'tool_activity',
            'tool_activity',
            'tool_activity',
            'tool_activity',
            'tool_activity',
        ])
        expect(
            transcript.items
                .filter((item) => item.type === 'model_text')
                .map((item) => (item.type === 'model_text' ? [item.phase, item.markdown] : null)),
        ).toEqual([
            ['thinking', 'Thinking through sources'],
            ['commentary', 'Reading those results'],
            ['commentary', 'Checking final sources'],
        ])
        expect(state.rows[1]).toMatchObject({
            type: 'assistant_final',
            message: {
                text: 'Final answer',
            },
        })
    })

    it('keeps parallel tool calls in source order while completions arrive out of order', () => {
        let state = reduceRoomStreamEvent(
            emptyStreamTurnState,
            realtime('run.accepted', {
                runId: 'run-1',
            }),
        )
        state = reduceRoomStreamEvent(
            state,
            runtimeEvent('turn_end', {
                type: 'turn_end',
                message: {
                    role: 'assistant',
                    content: [
                        textBlock('Checking both', 'commentary'),
                        toolBlock('call-1', 'a.ts'),
                        toolBlock('call-2', 'b.ts'),
                    ],
                },
            }),
        )
        state = reduceRoomStreamEvent(
            state,
            runtimeEvent('tool_execution_end', {
                type: 'tool_execution_end',
                toolCallId: 'call-2',
                toolName: 'agent_room_read',
                result: {
                    content: [{ type: 'text', text: 'b' }],
                },
            }),
        )
        state = reduceRoomStreamEvent(
            state,
            runtimeEvent('tool_execution_end', {
                type: 'tool_execution_end',
                toolCallId: 'call-1',
                toolName: 'agent_room_read',
                result: {
                    content: [{ type: 'text', text: 'a' }],
                },
            }),
        )

        expect(
            transcriptRow(state)
                .items.filter((item) => item.type === 'tool_activity')
                .map((item) => (item.type === 'tool_activity' ? item.toolCallId : null)),
        ).toEqual(['call-1', 'call-2'])
    })

    it('settles a stopped live run so active timers and tool spinners stop', () => {
        let state = reduceRoomStreamEvent(
            emptyStreamTurnState,
            realtimeAt(
                'run.accepted',
                {
                    runId: 'run-1',
                },
                1_000,
            ),
        )
        state = reduceRoomStreamEvent(
            state,
            runtimeEventAt(
                'tool_execution_start',
                {
                    type: 'tool_execution_start',
                    toolCallId: 'call-1',
                    toolName: 'agent_room_read',
                    args: {
                        path: 'src/app.ts',
                    },
                },
                1_200,
            ),
        )

        const stopped = stopStreamTurn(state, 4_000)
        const transcript = transcriptRow(stopped)

        expect(stopped).toMatchObject({
            status: 'stopped',
            finished: true,
        })
        expect(transcript).toMatchObject({
            status: 'stopped',
            runtimeMs: 3_000,
        })
        expect(transcript.items[0]).toMatchObject({
            type: 'tool_activity',
            task: {
                status: 'stopped',
                result: 'The tool was stopped',
            },
        })

        const lateUpdate = reduceRoomStreamEvent(
            stopped,
            runtimeEventAt(
                'tool_execution_end',
                {
                    type: 'tool_execution_end',
                    toolCallId: 'call-1',
                    toolName: 'agent_room_read',
                    result: {
                        content: [{ type: 'text', text: 'late result' }],
                    },
                },
                4_100,
            ),
        )

        expect(lateUpdate).toBe(stopped)
    })
})

function transcriptRow(state: { rows: Array<{ type: string }> }): RunTranscriptRow {
    const row = state.rows.find(
        (candidate): candidate is RunTranscriptRow => candidate.type === 'run_transcript',
    )
    if (!row) throw new Error('Expected transcript row')
    return row
}

function assistantUpdate(assistantMessageEvent: Record<string, unknown>): RoomRealtimeEvent {
    return runtimeEvent('message_update', {
        type: 'message_update',
        assistantMessageEvent,
    })
}

function runtimeEvent(event: string, payload: Record<string, unknown>): RoomRealtimeEvent {
    return realtime(event, {
        event: payload,
    })
}

function runtimeEventAt(
    event: string,
    payload: Record<string, unknown>,
    receivedAt: number,
): RoomRealtimeEvent {
    return realtimeAt(
        event,
        {
            event: payload,
        },
        receivedAt,
    )
}

function realtime(event: string, payload: unknown): RoomRealtimeEvent {
    return realtimeAt(event, payload, 1)
}

function realtimeAt(event: string, payload: unknown, receivedAt: number): RoomRealtimeEvent {
    return {
        event,
        payload,
        seq: null,
        stateVersion: null,
        receivedAt,
    }
}

function assistantPartial(content: Array<Record<string, unknown>>): Record<string, unknown> {
    return {
        role: 'assistant',
        content,
    }
}

function textBlock(text: string, phase: 'commentary' | 'final_answer'): Record<string, unknown> {
    return {
        type: 'text',
        text,
        textSignature: `{"v":1,"id":"${phase}-${text}","phase":"${phase}"}`,
    }
}

function toolBlock(id: string, path: string): Record<string, unknown> {
    return {
        type: 'toolCall',
        id,
        name: 'agent_room_read',
        arguments: {
            path,
        },
    }
}

function thinkingBlock(thinking: string): Record<string, unknown> {
    return {
        type: 'thinking',
        thinking,
    }
}
