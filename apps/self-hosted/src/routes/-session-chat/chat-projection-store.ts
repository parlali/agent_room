import type { InfiniteData, QueryClient } from '@tanstack/react-query'

import {
    createPendingUserDisplayRows,
    createPendingUserMessageRow,
} from '#/domain/message-list-model'
import { roomQueryKey, roomQueryPolicy } from '#/lib/room-query-keys'
import type {
    RoomSessionDisplayRow,
    RoomSessionShellSnapshot,
    RoomSessionWindow,
} from '#/domain/room-execution-types'
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
    optimisticUserMessage?: {
        id: string
        text: string
        timestamp: number
    }
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
    const row = optimisticMessageRow(input)
    input.queryClient.setQueryData<InfiniteData<RoomSessionWindow, string | null>>(
        queryKey,
        (current) => appendOptimisticRow(current, input.sessionKey, row),
    )
    return {
        previous,
        optimisticUserMessage: {
            id: row.id,
            text: input.message,
            timestamp: input.timestamp,
        },
    }
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
        (current) => pruneAfterEditedMessage(current, input.messageId, input.message),
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

export function preserveUnsettledPendingUserRows(
    oldData: InfiniteData<RoomSessionWindow, string | null> | undefined,
    newData: InfiniteData<RoomSessionWindow, string | null>,
): InfiniteData<RoomSessionWindow, string | null> {
    if (!oldData) return newData
    const carried = collectUnsettledPendingUserRows(oldData, newData)
    if (carried.length === 0) return newData
    if (newData.pages.length === 0) {
        return {
            ...newData,
            pages: [
                {
                    sessionKey: carried[0]!.sessionKey,
                    rows: carried.map((entry) => entry.row),
                    beforeCursor: null,
                    afterCursor: null,
                    hasOlder: false,
                    hasNewer: false,
                    totalRows: carried.length,
                    artifacts: [],
                },
            ],
            pageParams: [null],
        }
    }
    const appended = carried.map((entry) => entry.row)
    const pages = [...newData.pages]
    const latestPage = pages[0]!
    pages[0] = {
        ...latestPage,
        rows: [...latestPage.rows, ...appended],
        totalRows: Math.max(
            latestPage.totalRows + appended.length,
            latestPage.rows.length + appended.length,
        ),
    }
    return {
        ...newData,
        pages,
    }
}

function collectUnsettledPendingUserRows(
    oldData: InfiniteData<RoomSessionWindow, string | null>,
    newData: InfiniteData<RoomSessionWindow, string | null>,
): Array<{ row: RoomSessionDisplayRow; sessionKey: string }> {
    const presentRowIds = new Set<string>()
    const settledUserTexts = new Set<string>()
    for (const page of newData.pages) {
        for (const row of page.rows) {
            presentRowIds.add(row.id)
            if (row.type === 'user_message' && row.pending !== true) {
                settledUserTexts.add(row.message.text.trim())
            }
        }
    }
    const carried: Array<{ row: RoomSessionDisplayRow; sessionKey: string }> = []
    const seen = new Set<string>()
    for (const page of oldData.pages) {
        for (const row of page.rows) {
            if (row.type !== 'user_message') continue
            if (row.pending !== true) continue
            if (!row.id.startsWith('pending-user-')) continue
            if (presentRowIds.has(row.id)) continue
            if (settledUserTexts.has(row.message.text.trim())) continue
            if (seen.has(row.id)) continue
            seen.add(row.id)
            carried.push({ row, sessionKey: page.sessionKey })
        }
    }
    return carried
}

export function promoteOptimisticUserMessageToPendingRun(input: {
    queryClient: QueryClient
    roomId: string
    sessionKey: string
    rollback: OptimisticWindowRollback | undefined
    runId: string | null
}): void {
    const optimistic = input.rollback?.optimisticUserMessage
    const runId = input.runId
    if (!optimistic || !runId) return
    input.queryClient.setQueryData<InfiniteData<RoomSessionWindow, string | null>>(
        roomQueryKey.sessionWindow(input.roomId, input.sessionKey),
        (current) => promoteOptimisticRow(current, optimistic, runId),
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

function promoteOptimisticRow(
    current: InfiniteData<RoomSessionWindow, string | null> | undefined,
    optimistic: NonNullable<OptimisticWindowRollback['optimisticUserMessage']>,
    runId: string,
): InfiniteData<RoomSessionWindow, string | null> | undefined {
    if (!current || current.pages.length === 0) return current
    const [pendingUserRow, pendingRunRow] = createPendingUserDisplayRows({
        messageId: runId,
        runId,
        text: optimistic.text,
        queuedAt: optimistic.timestamp,
        startSeq: optimistic.timestamp,
    })
    const hasPendingUser = windowHasRow(current, pendingUserRow.id)
    const hasPendingRun = windowHasRow(current, pendingRunRow.id)
    let insertedUser = hasPendingUser
    let insertedRun = hasPendingRun
    let foundOptimistic = false
    const pages = current.pages.map((page) => {
        const rows: RoomSessionDisplayRow[] = []
        for (const row of page.rows) {
            if (row.id === optimistic.id) {
                foundOptimistic = true
                if (!insertedUser) {
                    rows.push({
                        ...pendingUserRow,
                        seq: row.seq,
                    })
                    insertedUser = true
                }
                if (!insertedRun) {
                    rows.push({
                        ...pendingRunRow,
                        seq: row.seq + 1,
                    })
                    insertedRun = true
                }
                continue
            }
            rows.push(row)
            if (row.id === pendingUserRow.id && !insertedRun) {
                rows.push({
                    ...pendingRunRow,
                    seq: row.seq + 1,
                })
                insertedRun = true
            }
        }
        return {
            ...page,
            rows,
            totalRows: Math.max(page.totalRows + rows.length - page.rows.length, rows.length),
        }
    })
    if (foundOptimistic || insertedUser) {
        return {
            ...current,
            pages,
        }
    }
    const latestPage = pages[0]!
    const appendedRows: RoomSessionDisplayRow[] = []
    if (!insertedUser) appendedRows.push(pendingUserRow)
    if (!insertedRun) appendedRows.push(pendingRunRow)
    pages[0] = {
        ...latestPage,
        rows: [...latestPage.rows, ...appendedRows],
        totalRows: Math.max(
            latestPage.totalRows + appendedRows.length,
            latestPage.rows.length + appendedRows.length,
        ),
    }
    return {
        ...current,
        pages,
    }
}

function windowHasRow(
    current: InfiniteData<RoomSessionWindow, string | null>,
    rowId: string,
): boolean {
    return current.pages.some((page) => page.rows.some((row) => row.id === rowId))
}

function pruneAfterEditedMessage(
    current: InfiniteData<RoomSessionWindow, string | null> | undefined,
    messageId: string,
    text: string,
): InfiniteData<RoomSessionWindow, string | null> | undefined {
    if (!current) return current
    const chronological = current.pages.map((page, index) => ({
        page,
        pageParam: current.pageParams[index] ?? null,
    }))
    chronological.reverse()

    const nextChronological: typeof chronological = []
    let found = false
    for (const pair of chronological) {
        if (found) break
        const rowIndex = pair.page.rows.findIndex(
            (row) => row.type === 'user_message' && row.message.id === messageId,
        )
        if (rowIndex < 0) {
            nextChronological.push(pair)
            continue
        }
        const editedRows = pair.page.rows.slice(0, rowIndex + 1).map((row) => {
            if (row.type !== 'user_message' || row.message.id !== messageId) return row
            return {
                ...row,
                message: {
                    ...row.message,
                    text,
                    parts: row.message.parts.map((part) =>
                        part.type === 'text'
                            ? {
                                  ...part,
                                  text,
                              }
                            : part,
                    ),
                },
            }
        })
        nextChronological.push({
            page: {
                ...pair.page,
                rows: editedRows,
                afterCursor:
                    editedRows.length > 0 ? String(editedRows[editedRows.length - 1]!.seq) : null,
                hasNewer: false,
                totalRows: Math.min(
                    pair.page.totalRows,
                    loadedRowCount(nextChronological) + editedRows.length,
                ),
            },
            pageParam: pair.pageParam,
        })
        found = true
    }

    if (!found) return current
    nextChronological.reverse()
    return {
        ...current,
        pages: nextChronological.map((pair) => pair.page),
        pageParams: nextChronological.map((pair) => pair.pageParam),
    }
}

function loadedRowCount(
    pages: Array<{ page: RoomSessionWindow; pageParam: string | null }>,
): number {
    return pages.reduce((total, pair) => total + pair.page.rows.length, 0)
}

function optimisticMessageRow(input: {
    sessionKey: string
    message: string
    timestamp: number
}): RoomSessionDisplayRow {
    return createPendingUserMessageRow({
        id: `optimistic-${input.sessionKey}-${input.timestamp}`,
        text: input.message,
        timestamp: input.timestamp,
        seq: input.timestamp,
    })
}
