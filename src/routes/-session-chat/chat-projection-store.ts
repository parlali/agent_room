import type { InfiniteData, QueryClient } from '@tanstack/react-query'

import { roomQueryKey, roomQueryPolicy } from '#/lib/room-query-keys'
import type {
    RoomExecutionMessage,
    RoomSessionDisplayRow,
    RoomSessionShellSnapshot,
    RoomSessionWindow,
} from '#/lib/room-execution-types'
import {
    getRoomSessionShellServer,
    getRoomSessionWindowServer,
} from '#/routes/-room-runtime-server'

export interface SessionDetailPrewarmTarget {
    roomId: string
    sessionKey: string
}

export interface OptimisticWindowRollback {
    previous: InfiniteData<RoomSessionWindow, string | null> | undefined
}

export async function prewarmSessionDetail(
    queryClient: QueryClient,
    target: SessionDetailPrewarmTarget,
): Promise<void> {
    await Promise.all([
        queryClient.prefetchQuery({
            queryKey: roomQueryKey.sessionShell(target.roomId, target.sessionKey),
            queryFn: () =>
                getRoomSessionShellServer({
                    data: {
                        roomId: target.roomId,
                        sessionKey: target.sessionKey,
                    },
                }),
            staleTime: roomQueryPolicy.hotStaleMs,
            gcTime: roomQueryPolicy.retainedSessionMs,
        }),
        queryClient.prefetchInfiniteQuery({
            queryKey: roomQueryKey.sessionWindow(target.roomId, target.sessionKey),
            initialPageParam: null as string | null,
            queryFn: ({ pageParam }) =>
                getRoomSessionWindowServer({
                    data: {
                        roomId: target.roomId,
                        sessionKey: target.sessionKey,
                        before: pageParam,
                        limitRows: 8,
                    },
                }),
            getNextPageParam: (lastPage: RoomSessionWindow) => lastPage.beforeCursor ?? undefined,
            staleTime: roomQueryPolicy.hotStaleMs,
            gcTime: roomQueryPolicy.retainedSessionMs,
        }),
    ])
}

export async function addOptimisticUserMessage(input: {
    queryClient: QueryClient
    roomId: string
    sessionKey: string
    message: string
    timestamp: number
}): Promise<OptimisticWindowRollback> {
    const queryKey = roomQueryKey.sessionWindow(input.roomId, input.sessionKey)
    await input.queryClient.cancelQueries({ queryKey })
    const previous =
        input.queryClient.getQueryData<InfiniteData<RoomSessionWindow, string | null>>(queryKey)
    input.queryClient.setQueryData<InfiniteData<RoomSessionWindow, string | null>>(
        queryKey,
        (current) => appendOptimisticRow(current, input.sessionKey, optimisticMessageRow(input)),
    )
    return { previous }
}

export async function editOptimisticUserMessage(input: {
    queryClient: QueryClient
    roomId: string
    sessionKey: string
    messageId: string
    message: string
}): Promise<OptimisticWindowRollback> {
    const queryKey = roomQueryKey.sessionWindow(input.roomId, input.sessionKey)
    await input.queryClient.cancelQueries({ queryKey })
    const previous =
        input.queryClient.getQueryData<InfiniteData<RoomSessionWindow, string | null>>(queryKey)
    input.queryClient.setQueryData<InfiniteData<RoomSessionWindow, string | null>>(
        queryKey,
        (current) => updateMessageRow(current, input.messageId, input.message),
    )
    return { previous }
}

export function rollbackOptimisticWindow(input: {
    queryClient: QueryClient
    roomId: string
    sessionKey: string
    rollback: OptimisticWindowRollback | undefined
}): void {
    if (!input.rollback) return
    input.queryClient.setQueryData(
        roomQueryKey.sessionWindow(input.roomId, input.sessionKey),
        input.rollback.previous,
    )
}

export function seedSessionShellFromSidebar(input: {
    queryClient: QueryClient
    roomId: string
    sessionKey: string
}): RoomSessionShellSnapshot | undefined {
    return input.queryClient.getQueryData<RoomSessionShellSnapshot>(
        roomQueryKey.sessionShell(input.roomId, input.sessionKey),
    )
}

function appendOptimisticRow(
    current: InfiniteData<RoomSessionWindow, string | null> | undefined,
    sessionKey: string,
    row: RoomSessionDisplayRow,
): InfiniteData<RoomSessionWindow, string | null> | undefined {
    if (!current || current.pages.length === 0) {
        return {
            pages: [
                {
                    sessionKey,
                    rows: [row],
                    beforeCursor: null,
                    afterCursor: String(row.seq),
                    hasOlder: false,
                    hasNewer: false,
                    totalRows: 1,
                    artifacts: [],
                },
            ],
            pageParams: [null],
        }
    }
    const pages = [...current.pages]
    const latestPage = pages[0]!
    const nextRows = [...latestPage.rows.filter((candidate) => candidate.id !== row.id), row]
    pages[0] = {
        ...latestPage,
        rows: nextRows,
        totalRows: Math.max(latestPage.totalRows, nextRows.length),
    }
    return {
        ...current,
        pages,
    }
}

function updateMessageRow(
    current: InfiniteData<RoomSessionWindow, string | null> | undefined,
    messageId: string,
    text: string,
): InfiniteData<RoomSessionWindow, string | null> | undefined {
    if (!current) return current
    return {
        ...current,
        pages: current.pages.map((page) => ({
            ...page,
            rows: page.rows.map((row) => {
                if (row.type !== 'message' || row.message.id !== messageId) return row
                return {
                    ...row,
                    message: {
                        ...row.message,
                        text,
                    },
                }
            }),
        })),
    }
}

function optimisticMessageRow(input: {
    sessionKey: string
    message: string
    timestamp: number
}): RoomSessionDisplayRow {
    const message: RoomExecutionMessage = {
        id: `optimistic-${input.sessionKey}-${input.timestamp}`,
        role: 'user',
        text: input.message,
        parts: [
            {
                type: 'text',
                text: input.message,
                toolName: null,
                toolCallId: null,
                status: null,
                input: null,
                result: null,
                rawType: null,
                contentIndex: null,
                textPhase: null,
            },
        ],
        timestamp: input.timestamp,
    }
    return {
        type: 'message',
        id: message.id,
        seq: input.timestamp,
        message,
        timestamp: input.timestamp,
    }
}
