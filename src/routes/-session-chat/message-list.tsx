import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { MessageSquareIcon } from 'lucide-react'

import { EmptyState, LoadingRows } from '#/components/agent-room'
import type {
    ChatTimelineRow,
    RoomSessionDisplayRow,
    RoomRuntimeOverview,
    RunTranscriptRow,
} from '#/lib/room-execution-types'

import type { EditingMessageDraft } from '#/lib/message-list-model'
import { createRunTranscriptRow } from '#/lib/message-list-model'
import { DisplayRow } from './message-rows'
import { recordClientPerformance } from '#/lib/browser-performance'
import type { StreamTurnState } from './stream-state'
import { streamTurnHasContent } from './stream-state'
import { cn } from '#/lib/utils'

/**
 * Render a virtualized, scrollable chat timeline that supports streaming updates, loading older messages, transcript collapsing, and in-place message editing.
 *
 * @param sessionKey - Stable key for the current chat session; used to generate stable virtual row keys and client telemetry.
 * @param room - Room metadata used for rendering and telemetry (e.g., displayName, roomId).
 * @param rows - Persisted session rows to display (will be merged with `stream` rows).
 * @param totalRows - Total number of rows in the session (used for performance telemetry).
 * @param stream - Current streaming turn state; streaming rows are merged into the timeline when present.
 * @param isWorking - Whether a live run is currently producing content; affects fallback row insertion.
 * @param loadingInitialRows - When true, shows an initial loading state for the timeline.
 * @param hasOlderRows - When true, indicates there are earlier rows to load and shows a top hint; triggers `onLoadOlderRows` when scrolled near the top.
 * @param loadingOlderRows - When true, shows the "loading earlier messages" indicator while older rows are being fetched.
 * @param onLoadOlderRows - Callback invoked to load older rows (pagination).
 * @param canEditMessages - Enables per-row editing controls when true.
 * @param editingMessage - Current editing draft, or `null` when no message is being edited.
 * @param editPending - When true, indicates the edit submission is in progress.
 * @param onEditMessage - Begin editing the provided draft.
 * @param onChangeEditingMessageText - Update the text of the current editing draft.
 * @param onSubmitEditingMessage - Submit the current editing draft.
 * @param onCancelEditingMessage - Cancel the current editing session.
 *
 * @returns The React element tree for the virtualized message list.
 */
export function MessageList({
    sessionKey,
    room,
    rows,
    totalRows,
    stream,
    isWorking,
    loadingInitialRows,
    hasOlderRows,
    loadingOlderRows,
    onLoadOlderRows,
    canEditMessages,
    editingMessage,
    editPending,
    onEditMessage,
    onChangeEditingMessageText,
    onSubmitEditingMessage,
    onCancelEditingMessage,
}: {
    sessionKey: string
    room: RoomRuntimeOverview
    rows: RoomSessionDisplayRow[]
    totalRows: number
    stream: StreamTurnState
    isWorking: boolean
    loadingInitialRows: boolean
    hasOlderRows: boolean
    loadingOlderRows: boolean
    onLoadOlderRows: () => void
    canEditMessages: boolean
    editingMessage: EditingMessageDraft | null
    editPending: boolean
    onEditMessage: (input: EditingMessageDraft) => void
    onChangeEditingMessageText: (text: string) => void
    onSubmitEditingMessage: () => void
    onCancelEditingMessage: () => void
}) {
    const containerRef = useRef<HTMLDivElement | null>(null)
    const stickToBottomRef = useRef(true)
    const mountedAtRef = useRef(performance.now())
    const renderLoggedSessionRef = useRef<string | null>(null)
    const pendingPrependRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null)
    const [collapsedByRunId, setCollapsedByRunId] = useState<Map<string, boolean>>(() => new Map())
    const timelineRows = useMemo(
        () => buildTimelineRows(rows, stream, isWorking, sessionKey),
        [isWorking, rows, sessionKey, stream],
    )
    const editingMeasurementKey = editingMessage
        ? `${editingMessage.id}:${editingMessage.text}:${editingMessage.attachments.length}`
        : null
    const rowVirtualizer = useVirtualizer({
        count: timelineRows.length,
        getScrollElement: () => containerRef.current,
        getItemKey: (index) => timelineRowKey(sessionKey, timelineRows[index], index),
        estimateSize: (index) => estimateTimelineRowSize(timelineRows[index]),
        overscan: 5,
        useAnimationFrameWithResizeObserver: true,
    })

    const handleScroll = useCallback(() => {
        const node = containerRef.current
        if (!node) return
        const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight
        stickToBottomRef.current = distanceFromBottom < 120
        if (node.scrollTop < 320 && hasOlderRows && !loadingOlderRows) {
            pendingPrependRef.current = {
                scrollHeight: node.scrollHeight,
                scrollTop: node.scrollTop,
            }
            onLoadOlderRows()
        }
    }, [hasOlderRows, loadingOlderRows, onLoadOlderRows])

    const scrollToBottom = useCallback(() => {
        const node = containerRef.current
        if (!node) return
        node.scrollTop = node.scrollHeight
    }, [])

    useLayoutEffect(() => {
        stickToBottomRef.current = true
        mountedAtRef.current = performance.now()
        renderLoggedSessionRef.current = null
        scrollToBottom()
    }, [sessionKey, scrollToBottom])

    useEffect(() => {
        if (stickToBottomRef.current) scrollToBottom()
    }, [timelineRows, stream.updatedAt, isWorking, scrollToBottom])

    const measureVisibleRows = useCallback(() => {
        const measure = () => {
            const node = containerRef.current
            if (!node) return
            for (const element of node.querySelectorAll<HTMLElement>('[data-virtual-row]')) {
                rowVirtualizer.measureElement(element)
            }
        }
        window.requestAnimationFrame(() => {
            measure()
            window.requestAnimationFrame(measure)
        })
    }, [rowVirtualizer])

    useLayoutEffect(() => {
        measureVisibleRows()
    }, [
        collapsedByRunId,
        editingMeasurementKey,
        measureVisibleRows,
        stream.updatedAt,
        timelineRows,
    ])

    useLayoutEffect(() => {
        const pending = pendingPrependRef.current
        const node = containerRef.current
        if (!pending || !node) return
        pendingPrependRef.current = null
        node.scrollTop = node.scrollHeight - pending.scrollHeight + pending.scrollTop
    }, [rows.length])

    const hasStreamContent = streamTurnHasContent(stream) || stream.rows.length > 0
    const virtualRows = rowVirtualizer.getVirtualItems()

    useEffect(() => {
        if (renderLoggedSessionRef.current === sessionKey) return
        if (timelineRows.length === 0 || virtualRows.length === 0) return
        renderLoggedSessionRef.current = sessionKey
        recordClientPerformance({
            name: 'chat.window.render',
            roomId: room.roomId,
            sessionKey,
            rowCount: timelineRows.length,
            virtualRowCount: virtualRows.length,
            totalRows,
            durationMs: performance.now() - mountedAtRef.current,
        })
    }, [room.roomId, sessionKey, timelineRows.length, totalRows, virtualRows.length])

    const toggleTranscript = useCallback((row: RunTranscriptRow) => {
        setCollapsedByRunId((current) => {
            const next = new Map(current)
            next.set(row.runId, !(next.get(row.runId) ?? row.collapsed))
            return next
        })
    }, [])

    const measureRows = useCallback(() => {
        measureVisibleRows()
    }, [measureVisibleRows])

    return (
        <div
            ref={containerRef}
            onScroll={handleScroll}
            className="min-h-0 flex-1 overflow-y-auto"
            aria-busy={loadingInitialRows}
        >
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 sm:px-6">
                {loadingInitialRows ? <LoadingRows count={4} /> : null}
                {timelineRows.length === 0 && !hasStreamContent && !loadingInitialRows ? (
                    <EmptyState
                        icon={MessageSquareIcon}
                        title="Start the conversation"
                        description={`Send the first message to ${room.displayName}.`}
                    />
                ) : null}
                {hasOlderRows ? (
                    <div className="flex justify-center py-1 text-xs text-muted-foreground">
                        {loadingOlderRows
                            ? 'Loading earlier messages...'
                            : 'Scroll up for earlier messages'}
                    </div>
                ) : null}
                <div
                    className="relative w-full"
                    style={{
                        height: `${rowVirtualizer.getTotalSize()}px`,
                    }}
                >
                    {virtualRows.map((virtualRow) => {
                        const item = timelineRows[virtualRow.index]!
                        const isEditingRow =
                            item.type === 'user_message' && editingMessage?.id === item.message.id
                        return (
                            <div
                                key={timelineRowKey(sessionKey, item, virtualRow.index)}
                                ref={rowVirtualizer.measureElement}
                                data-virtual-row
                                data-index={virtualRow.index}
                                className={cn(
                                    'absolute left-0 top-0 w-full pb-4 [contain:layout_paint_style]',
                                    isEditingRow ? 'z-10' : 'z-0',
                                )}
                                style={{
                                    transform: `translateY(${virtualRow.start}px)`,
                                }}
                            >
                                <DisplayRow
                                    room={room}
                                    item={item}
                                    canEditMessages={canEditMessages}
                                    editingMessage={editingMessage}
                                    editPending={editPending}
                                    onEditMessage={onEditMessage}
                                    onChangeEditingMessageText={onChangeEditingMessageText}
                                    onSubmitEditingMessage={onSubmitEditingMessage}
                                    onCancelEditingMessage={onCancelEditingMessage}
                                    assistantContinuesPrevious={assistantContinuesPreviousWork(
                                        timelineRows,
                                        virtualRow.index,
                                    )}
                                    transcriptCollapsed={
                                        item.type === 'run_transcript'
                                            ? (collapsedByRunId.get(item.runId) ?? item.collapsed)
                                            : undefined
                                    }
                                    onToggleTranscript={toggleTranscript}
                                    onRowLayoutChange={measureRows}
                                />
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}

/**
 * Constructs the ordered list of timeline rows for rendering by merging persisted rows, live stream rows, and an optional fallback pending transcript, and assigns each row a sequential `seq` index.
 *
 * @param rows - Persisted display rows from the session's conversation history.
 * @param stream - Current stream turn state (including `rows` and `startedAt`) used to place live stream rows within the timeline.
 * @param isWorking - True when a run is currently in progress; may cause a synthetic pending `run_transcript` row to be appended when there are no live stream rows and no active transcript.
 * @param sessionKey - Session-scoped key used to generate stable identifiers for any synthetic fallback rows.
 * @returns The merged array of `ChatTimelineRow` ready for virtualization and rendering, with each row's `seq` set to its index in the returned array.
 */
export function buildTimelineRows(
    rows: RoomSessionDisplayRow[],
    stream: StreamTurnState,
    isWorking: boolean,
    sessionKey: string,
): ChatTimelineRow[] {
    const streamRows = stream.rows
    const persistentMerge =
        streamRows.length > 0
            ? persistedRowsForLiveRun(rows, stream.startedAt)
            : {
                  before: rows,
                  after: [],
              }
    const fallback =
        isWorking && streamRows.length === 0 && !persistentMerge.before.some(hasActiveTranscript)
            ? [
                  createRunTranscriptRow({
                      id: `run-transcript-pending-${sessionKey}`,
                      seq: persistentMerge.before.length,
                      runId: `pending-${sessionKey}`,
                      status: 'working',
                      startedAt: null,
                      runtimeMs: null,
                      collapsed: false,
                      timestamp: null,
                  }),
              ]
            : []
    return [...persistentMerge.before, ...streamRows, ...persistentMerge.after, ...fallback].map(
        (row, seq) => ({
            ...row,
            seq,
        }),
    )
}

/**
 * Split persisted display rows into `before` and `after` segments around the most recent user message relevant to a live stream.
 *
 * When no relevant user message is found, `before` contains persisted rows that are not part of an active run transcript or the current stream's finalized assistant output, and `after` is empty. When a relevant user message is found, `before` contains all rows up to and including that message, and `after` contains subsequent rows that are pending or queued.
 *
 * @param rows - Persisted display rows from the session timeline
 * @param streamStartedAt - Timestamp when the live stream started, or `null` if there is no active stream
 * @returns An object with `before` (rows to render before live/stream rows) and `after` (pending/queued rows to render after live/stream rows)
 */
function persistedRowsForLiveRun(
    rows: RoomSessionDisplayRow[],
    streamStartedAt: number | null,
): { before: RoomSessionDisplayRow[]; after: RoomSessionDisplayRow[] } {
    const latestUserIndex = findLatestUserRowIndex(rows, streamStartedAt)
    if (latestUserIndex < 0) {
        const filtered = rows.filter((row) => {
            if (row.type === 'run_transcript') return !isActiveRunStatus(row.status)
            return !isCurrentStreamFinalRow(row, streamStartedAt)
        })
        return {
            before: filtered,
            after: [],
        }
    }
    return {
        before: rows.slice(0, latestUserIndex + 1),
        after: rows.slice(latestUserIndex + 1).filter(isPendingQueuedRow),
    }
}

/**
 * Determines whether an `assistant_final` timeline row belongs to the current stream's finalized output.
 *
 * @param row - The timeline row to evaluate
 * @param streamStartedAt - The stream start timestamp (milliseconds) or `null` if no stream is active
 * @returns `true` if `streamStartedAt` is not `null`, `row.type` is `'assistant_final'`, `row.timestamp` is not `null`, and `row.timestamp` is greater than or equal to `streamStartedAt`; `false` otherwise.
 */
function isCurrentStreamFinalRow(
    row: RoomSessionDisplayRow,
    streamStartedAt: number | null,
): boolean {
    return (
        streamStartedAt !== null &&
        row.type === 'assistant_final' &&
        row.timestamp !== null &&
        row.timestamp >= streamStartedAt
    )
}

function findLatestUserRowIndex(
    rows: RoomSessionDisplayRow[],
    streamStartedAt: number | null,
): number {
    for (let index = rows.length - 1; index >= 0; index -= 1) {
        const row = rows[index]
        if (!row || row.type !== 'user_message') continue
        if (streamStartedAt !== null && row.timestamp !== null && row.timestamp > streamStartedAt) {
            continue
        }
        return index
    }
    return -1
}

/**
 * Determines whether a timeline row represents a run transcript that is currently active.
 *
 * @param row - The timeline row to evaluate
 * @returns `true` if `row.type` is `"run_transcript"` and its `status` is one of `queued`, `thinking`, `working`, or `responding`; `false` otherwise.
 */
function hasActiveTranscript(row: ChatTimelineRow): boolean {
    return row.type === 'run_transcript' && isActiveRunStatus(row.status)
}

/**
 * Determines whether a timeline row represents a locally pending queued user or run entry.
 *
 * @param row - The timeline row to inspect.
 * @returns `true` if the row's id indicates a pending user or run item, `false` otherwise.
 */
function isPendingQueuedRow(row: RoomSessionDisplayRow): boolean {
    return row.id.startsWith('pending-user-') || row.id.startsWith('pending-run-')
}

/**
 * Determines whether a run transcript status indicates an active run.
 *
 * @param status - The run transcript status to test
 * @returns `true` if `status` is `'queued'`, `'thinking'`, `'working'`, or `'responding'`, `false` otherwise
 */
function isActiveRunStatus(status: RunTranscriptRow['status']): boolean {
    return (
        status === 'queued' ||
        status === 'thinking' ||
        status === 'working' ||
        status === 'responding'
    )
}

/**
 * Produce a stable per-session key for a timeline row.
 *
 * @param sessionKey - Session identifier used as the key prefix
 * @param row - The timeline row; if undefined or missing `id`, `index` is used instead
 * @param index - Fallback index used when `row` is undefined or has no `id`
 * @returns The string key in the form `"{sessionKey}:{row.id}"` or `"{sessionKey}:index-{index}"`
 */
export function timelineRowKey(
    sessionKey: string,
    row: ChatTimelineRow | undefined,
    index: number,
): string {
    return `${sessionKey}:${row?.id ?? `index-${index}`}`
}

/**
 * Estimate the vertical height (in pixels) that a timeline row will occupy for virtualization.
 *
 * @param row - The timeline row to estimate; pass `undefined` when estimating a default/placeholder row.
 * @returns The estimated height in pixels:
 * - For `run_transcript`: `44` if collapsed, otherwise `min(520, 56 + items.length * 36)`.
 * - For `assistant_final` or `user_message`: `min(900, 64 + estimatedLines * 24)`, where `estimatedLines` is `max(1, ceil(text.length / 84))`.
 * - For other row types: `48`.
 */
function estimateTimelineRowSize(row: ChatTimelineRow | undefined): number {
    if (!row) return 112
    if (row.type === 'run_transcript') {
        return row.collapsed ? 44 : Math.min(520, 56 + row.items.length * 36)
    }
    if (row.type === 'assistant_final' || row.type === 'user_message') {
        const text = row.message.text
        const estimatedLines = Math.max(1, Math.ceil(text.length / 84))
        return Math.min(900, 64 + estimatedLines * 24)
    }
    return 48
}

function assistantContinuesPreviousWork(rows: ChatTimelineRow[], index: number): boolean {
    if (rows[index]?.type !== 'assistant_final') return false
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
        const row = rows[cursor]
        if (!row) return false
        if (row.type === 'run_transcript' || row.type === 'assistant_final') return true
        if (row.type === 'user_message' || row.type === 'system') return false
    }
    return false
}
