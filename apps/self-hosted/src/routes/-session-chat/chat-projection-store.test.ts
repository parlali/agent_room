import { QueryClient, type InfiniteData } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { emptyRuntimePart } from '#/domain/runtime-message'
import { roomQueryKey } from '#/lib/room-query-keys'
import type {
    RoomExecutionMessage,
    RoomSessionDisplayRow,
    RoomSessionWindow,
} from '#/domain/room-execution-types'
import {
    addOptimisticUserMessage,
    editOptimisticUserMessage,
    promoteOptimisticUserMessageToPendingRun,
} from './chat-projection-store'

describe('chat projection store', () => {
    it('optimistically prunes rows after an edited user message', async () => {
        const queryClient = new QueryClient()
        const queryKey = roomQueryKey.sessionWindow('room-1', 'session-1')
        const initial: InfiniteData<RoomSessionWindow, string | null> = {
            pages: [
                {
                    sessionKey: 'session-1',
                    rows: [
                        userRow('user-1', 'First', 1),
                        assistantRow('assistant-1', 'Old first reply', 2),
                        userRow('user-2', 'Original second', 3),
                        assistantRow('assistant-2', 'Stale reply', 4),
                    ],
                    beforeCursor: null,
                    afterCursor: '3',
                    hasOlder: false,
                    hasNewer: false,
                    totalRows: 4,
                    artifacts: [],
                },
            ],
            pageParams: [null],
        }
        queryClient.setQueryData(queryKey, initial)

        await editOptimisticUserMessage({
            queryClient,
            roomId: 'room-1',
            sessionKey: 'session-1',
            messageId: 'user-2',
            message: 'Edited second',
        })

        const next =
            queryClient.getQueryData<InfiniteData<RoomSessionWindow, string | null>>(queryKey)
        expect(next?.pages[0]?.rows.map((row) => row.id)).toEqual([
            'user-1',
            'assistant-1',
            'user-2',
        ])
        const edited = next?.pages[0]?.rows[2]
        expect(edited).toMatchObject({
            type: 'user_message',
            message: {
                text: 'Edited second',
            },
        })
        expect(JSON.stringify(edited)).not.toContain('Original second')
    })

    it('marks optimistic user messages as pending', async () => {
        const queryClient = new QueryClient()

        await addOptimisticUserMessage({
            queryClient,
            roomId: 'room-1',
            sessionKey: 'session-1',
            message: 'Queued follow-up',
            timestamp: 10,
        })

        const next = queryClient.getQueryData<InfiniteData<RoomSessionWindow, string | null>>(
            roomQueryKey.sessionWindow('room-1', 'session-1'),
        )
        expect(next?.pages[0]?.rows[0]).toMatchObject({
            type: 'user_message',
            id: 'optimistic-session-1-10',
            pending: true,
            message: {
                text: 'Queued follow-up',
            },
        })
    })

    it('promotes optimistic user messages to canonical pending run rows', async () => {
        const queryClient = new QueryClient()
        const rollback = await addOptimisticUserMessage({
            queryClient,
            roomId: 'room-1',
            sessionKey: 'session-1',
            message: 'Queued follow-up',
            timestamp: 10,
        })

        promoteOptimisticUserMessageToPendingRun({
            queryClient,
            roomId: 'room-1',
            sessionKey: 'session-1',
            rollback,
            runId: 'run-1',
        })

        const next = queryClient.getQueryData<InfiniteData<RoomSessionWindow, string | null>>(
            roomQueryKey.sessionWindow('room-1', 'session-1'),
        )
        expect(next?.pages[0]?.rows.map((row) => row.id)).toEqual([
            'pending-user-run-1',
            'pending-run-run-1',
        ])
        expect(next?.pages[0]?.rows[1]).toMatchObject({
            type: 'run_transcript',
            runId: 'run-1',
            pending: true,
        })
    })
})

function userRow(id: string, text: string, timestamp: number): RoomSessionDisplayRow {
    const message: RoomExecutionMessage = {
        id,
        role: 'user',
        text,
        parts: [
            emptyRuntimePart({
                type: 'text',
                text,
            }),
        ],
        timestamp,
    }
    return {
        type: 'user_message',
        id,
        seq: timestamp,
        message,
        timestamp,
    }
}

function assistantRow(id: string, text: string, timestamp: number): RoomSessionDisplayRow {
    const message: RoomExecutionMessage = {
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
    }
    return {
        type: 'assistant_final',
        id,
        seq: timestamp,
        message,
        streaming: false,
        timestamp,
    }
}
