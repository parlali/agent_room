import { describe, expect, it } from 'vitest'
import type { RoomRealtimeEvent } from '#/lib/room-execution-types'
import { emptyStreamTurnState, reduceRoomStreamEvent } from './stream-state'

describe('stream turn reducer', () => {
    it('keeps assistant status text ordered around tool activity', () => {
        let state = reduceRoomStreamEvent(
            emptyStreamTurnState,
            realtime('run.accepted', {
                runId: 'run-1',
            }),
        )

        state = reduceRoomStreamEvent(
            state,
            runtimeEvent('message_update', {
                type: 'message_update',
                assistantMessageEvent: {
                    type: 'text_delta',
                    contentIndex: 0,
                    delta: 'Checking logs',
                    partial: {
                        role: 'assistant',
                        content: [
                            {
                                type: 'text',
                                text: 'Checking logs',
                            },
                        ],
                    },
                },
            }),
        )
        state = reduceRoomStreamEvent(
            state,
            runtimeEvent('message_update', {
                type: 'message_update',
                assistantMessageEvent: {
                    type: 'text_end',
                    contentIndex: 0,
                    content: 'Checking logs',
                    partial: {
                        role: 'assistant',
                        content: [
                            {
                                type: 'text',
                                text: 'Checking logs',
                                textSignature: '{"v":1,"id":"msg-status","phase":"commentary"}',
                            },
                        ],
                    },
                },
            }),
        )
        state = reduceRoomStreamEvent(
            state,
            runtimeEvent('message_update', {
                type: 'message_update',
                assistantMessageEvent: {
                    type: 'toolcall_start',
                    contentIndex: 1,
                    partial: {
                        role: 'assistant',
                        content: [
                            {
                                type: 'text',
                                text: 'Checking logs',
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
                        {
                            type: 'text',
                            text: 'Checking logs',
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
                        {
                            type: 'text',
                            text: 'Done',
                            textSignature: '{"v":1,"id":"msg-final","phase":"final_answer"}',
                        },
                    ],
                },
            }),
        )

        expect(state.items.map((item) => item.type)).toEqual(['assistant', 'tools', 'assistant'])
        expect(
            state.items.map((item) =>
                item.type === 'assistant' ? [item.markdown, item.textPhase] : item.tasks[0],
            ),
        ).toEqual([
            ['Checking logs', 'commentary'],
            expect.objectContaining({
                id: 'call-1',
                status: 'complete',
            }),
            ['Done', 'final_answer'],
        ])
    })
})

function runtimeEvent(event: string, payload: Record<string, unknown>): RoomRealtimeEvent {
    return realtime(event, {
        event: payload,
    })
}

function realtime(event: string, payload: unknown): RoomRealtimeEvent {
    return {
        event,
        payload,
        seq: null,
        stateVersion: null,
        receivedAt: 1,
    }
}
