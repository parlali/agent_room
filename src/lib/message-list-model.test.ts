import { describe, expect, it } from 'vitest'
import { emptyRuntimePart } from './runtime-message'
import type { RoomExecutionMessage } from './room-execution-types'
import { buildDisplayItems } from './message-list-model'

describe('message list model', () => {
    it('renders assistant status, tools, and final text in persisted order', () => {
        const items = buildDisplayItems(
            [
                message('u1', 'user', 'Inspect the file'),
                {
                    id: 'a1',
                    role: 'assistant',
                    text: 'Checking logs',
                    timestamp: 2,
                    parts: [
                        emptyRuntimePart({
                            type: 'text',
                            text: 'Checking logs',
                            contentIndex: 0,
                            textPhase: 'commentary',
                        }),
                        emptyRuntimePart({
                            type: 'tool_call',
                            text: 'agent_room_read',
                            toolName: 'agent_room_read',
                            toolCallId: 'call-1',
                            status: 'running',
                            contentIndex: 1,
                            input: {
                                path: 'src/app.ts',
                            },
                        }),
                    ],
                },
                {
                    id: 't1',
                    role: 'tool',
                    text: 'file contents',
                    timestamp: 3,
                    parts: [
                        emptyRuntimePart({
                            type: 'tool_result',
                            toolName: 'agent_room_read',
                            toolCallId: 'call-1',
                            status: 'complete',
                            text: 'file contents',
                            result: [
                                {
                                    type: 'text',
                                    text: 'file contents',
                                },
                            ],
                        }),
                    ],
                },
                {
                    id: 'a2',
                    role: 'assistant',
                    text: 'Done',
                    timestamp: 4,
                    parts: [
                        emptyRuntimePart({
                            type: 'text',
                            text: 'Done',
                            contentIndex: 0,
                            textPhase: 'final_answer',
                        }),
                    ],
                },
            ],
            false,
            null,
        )

        expect(items.map((item) => item.type)).toEqual(['message', 'message', 'tools', 'message'])
        expect(items[1]).toMatchObject({
            type: 'message',
            message: {
                id: 'a1:part:0',
                text: 'Checking logs',
                parts: [
                    {
                        textPhase: 'commentary',
                    },
                ],
            },
        })
        expect(items[2]).toMatchObject({
            type: 'tools',
            tasks: [
                {
                    id: 'call-1',
                    status: 'complete',
                },
            ],
        })
        expect(items[3]).toMatchObject({
            type: 'message',
            message: {
                id: 'a2',
                text: 'Done',
                parts: [
                    {
                        textPhase: 'final_answer',
                    },
                ],
            },
        })
    })
})

function message(
    id: string,
    role: RoomExecutionMessage['role'],
    text: string,
): RoomExecutionMessage {
    return {
        id,
        role,
        text,
        timestamp: 1,
        parts: [
            emptyRuntimePart({
                type: 'text',
                text,
            }),
        ],
    }
}
