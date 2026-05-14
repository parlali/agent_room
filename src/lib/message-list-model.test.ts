import { describe, expect, it } from 'vitest'
import { emptyRuntimePart } from './runtime-message'
import type { RoomExecutionMessage } from './room-execution-types'
import {
    buildChatTimelineRows,
    createRunTranscriptRow,
    settleTranscriptItems,
} from './message-list-model'

describe('message list model', () => {
    it('renders assistant work as one transcript followed by final text', () => {
        const rows = buildChatTimelineRows(
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

        expect(rows.map((row) => row.type)).toEqual([
            'user_message',
            'run_transcript',
            'assistant_final',
        ])
        expect(rows[1]).toMatchObject({
            type: 'run_transcript',
            startedAt: 1,
            runtimeMs: 3,
            collapsed: true,
            items: [
                {
                    type: 'model_text',
                    markdown: 'Checking logs',
                    phase: 'commentary',
                    contentIndex: 0,
                },
                {
                    type: 'tool_activity',
                    toolCallId: 'call-1',
                    task: {
                        id: 'call-1',
                        status: 'complete',
                    },
                },
            ],
        })
        expect(rows[2]).toMatchObject({
            type: 'assistant_final',
            message: {
                text: 'Done',
                parts: [
                    {
                        textPhase: 'final_answer',
                    },
                ],
            },
        })
    })

    it('settles a persisted transcript once final text exists even if the room status is stale', () => {
        const rows = buildChatTimelineRows(
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
                    ],
                },
                {
                    id: 'a2',
                    role: 'assistant',
                    text: 'Done',
                    timestamp: 3,
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
            true,
            null,
        )

        expect(rows[1]).toMatchObject({
            type: 'run_transcript',
            status: 'complete',
            startedAt: 1,
            runtimeMs: 2,
            collapsed: true,
        })
        expect(rows[2]).toMatchObject({
            type: 'assistant_final',
        })
    })

    it('renders persisted thinking as transcript model text before final text', () => {
        const rows = buildChatTimelineRows(
            [
                message('u1', 'user', 'Think first'),
                {
                    id: 'a1',
                    role: 'assistant',
                    text: 'Answer',
                    timestamp: 2,
                    parts: [
                        emptyRuntimePart({
                            type: 'thinking',
                            text: 'raw thought',
                            status: 'complete',
                            contentIndex: 0,
                        }),
                        emptyRuntimePart({
                            type: 'text',
                            text: 'Answer',
                            contentIndex: 1,
                            textPhase: 'final_answer',
                        }),
                    ],
                },
            ],
            false,
            null,
        )

        expect(rows.map((row) => row.type)).toEqual([
            'user_message',
            'run_transcript',
            'assistant_final',
        ])
        expect(rows[1]).toMatchObject({
            type: 'run_transcript',
            items: [
                {
                    type: 'model_text',
                    markdown: 'raw thought',
                    phase: 'thinking',
                },
            ],
        })
    })

    it('keeps parallel tools in source order when results arrive out of order', () => {
        const rows = buildChatTimelineRows(
            [
                message('u1', 'user', 'Check two files'),
                {
                    id: 'a1',
                    role: 'assistant',
                    text: 'Checking',
                    timestamp: 2,
                    parts: [
                        emptyRuntimePart({
                            type: 'text',
                            text: 'Checking',
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
                                path: 'a.ts',
                            },
                        }),
                        emptyRuntimePart({
                            type: 'tool_call',
                            text: 'agent_room_read',
                            toolName: 'agent_room_read',
                            toolCallId: 'call-2',
                            status: 'running',
                            contentIndex: 2,
                            input: {
                                path: 'b.ts',
                            },
                        }),
                    ],
                },
                toolResult('t2', 'call-2'),
                toolResult('t1', 'call-1'),
                {
                    id: 'a2',
                    role: 'assistant',
                    text: 'Done',
                    timestamp: 5,
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

        const transcript = rows[1]
        expect(transcript).toMatchObject({
            type: 'run_transcript',
        })
        if (transcript.type !== 'run_transcript') throw new Error('Expected transcript')
        expect(
            transcript.items
                .filter((item) => item.type === 'tool_activity')
                .map((item) => (item.type === 'tool_activity' ? item.toolCallId : null)),
        ).toEqual(['call-1', 'call-2'])
    })

    it('moves unknown assistant status text into the transcript when later tool work appears', () => {
        const rows = buildChatTimelineRows(
            [
                message('u1', 'user', 'Inspect the file'),
                {
                    id: 'a1',
                    role: 'assistant',
                    text: 'I will inspect the file',
                    timestamp: 2,
                    parts: [
                        emptyRuntimePart({
                            type: 'text',
                            text: 'I will inspect the file',
                            contentIndex: 0,
                        }),
                    ],
                },
                {
                    id: 'a2',
                    role: 'assistant',
                    text: 'agent_room_read',
                    timestamp: 3,
                    parts: [
                        emptyRuntimePart({
                            type: 'tool_call',
                            text: 'agent_room_read',
                            toolName: 'agent_room_read',
                            toolCallId: 'call-1',
                            status: 'running',
                            contentIndex: 0,
                            input: {
                                path: 'src/app.ts',
                            },
                        }),
                    ],
                },
                toolResult('t1', 'call-1'),
            ],
            false,
            null,
        )

        expect(rows.map((row) => row.type)).toEqual(['user_message', 'run_transcript'])
        expect(rows[1]).toMatchObject({
            type: 'run_transcript',
            items: [
                {
                    type: 'model_text',
                    markdown: 'I will inspect the file',
                    phase: 'unknown',
                },
                {
                    type: 'tool_activity',
                    toolCallId: 'call-1',
                    task: {
                        status: 'complete',
                    },
                },
            ],
        })
    })

    it('marks streaming model text complete when a transcript settles', () => {
        const row = createRunTranscriptRow({
            id: 'run-transcript-run-1',
            seq: 0,
            runId: 'run-1',
            status: 'responding',
            startedAt: 1,
            runtimeMs: null,
            collapsed: false,
            timestamp: 2,
            items: [
                {
                    type: 'model_text',
                    id: 'thinking-1',
                    turnIndex: 0,
                    contentIndex: 0,
                    markdown: 'Still streaming',
                    complete: false,
                    phase: 'thinking',
                    timestamp: 2,
                },
            ],
        })

        const settled = settleTranscriptItems(row, 'stopped')

        expect(settled.items[0]).toMatchObject({
            type: 'model_text',
            complete: true,
        })
    })

    it('replaces non-terminal tool detail when settling a completed transcript', () => {
        const row = createRunTranscriptRow({
            id: 'run-transcript-run-1',
            seq: 0,
            runId: 'run-1',
            status: 'working',
            startedAt: 1,
            runtimeMs: null,
            collapsed: false,
            timestamp: 2,
            items: [
                {
                    type: 'tool_activity',
                    id: 'tool-call-1',
                    turnIndex: 0,
                    contentIndex: 0,
                    toolCallId: 'call-1',
                    task: {
                        id: 'call-1',
                        title: 'Checked files',
                        action: 'read',
                        status: 'in_progress',
                        detail: 'File: src/app.ts',
                        result: 'Working',
                    },
                    timestamp: 2,
                },
            ],
        })

        const settled = settleTranscriptItems(row, 'complete')

        expect(settled.items[0]).toMatchObject({
            type: 'tool_activity',
            task: {
                status: 'complete',
                result: 'Workspace information was provided to the agent',
            },
        })
    })

    it('replaces non-terminal tool detail when settling a failed transcript', () => {
        const row = createRunTranscriptRow({
            id: 'run-transcript-run-1',
            seq: 0,
            runId: 'run-1',
            status: 'working',
            startedAt: 1,
            runtimeMs: null,
            collapsed: false,
            timestamp: 2,
            items: [
                {
                    type: 'tool_activity',
                    id: 'tool-call-1',
                    turnIndex: 0,
                    contentIndex: 0,
                    toolCallId: 'call-1',
                    task: {
                        id: 'call-1',
                        title: 'Checked files',
                        action: 'read',
                        status: 'in_progress',
                        detail: 'File: src/app.ts',
                        result: 'Working',
                    },
                    timestamp: 2,
                },
            ],
        })

        const settled = settleTranscriptItems(row, 'error')

        expect(settled.items[0]).toMatchObject({
            type: 'tool_activity',
            task: {
                status: 'error',
                result: 'The tool did not finish',
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

function toolResult(id: string, toolCallId: string): RoomExecutionMessage {
    return {
        id,
        role: 'tool',
        text: 'file contents',
        timestamp: 3,
        parts: [
            emptyRuntimePart({
                type: 'tool_result',
                toolName: 'agent_room_read',
                toolCallId,
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
    }
}
