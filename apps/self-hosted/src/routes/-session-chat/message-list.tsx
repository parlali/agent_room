import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

import { LoadingRows } from '#/components/agent-room'
import type {
    ChatTimelineRow,
    RoomSessionDisplayRow,
    RoomRuntimeOverview,
    RunTranscriptRow,
} from '#/domain/room-execution-types'

import type { EditingMessageDraft } from '#/domain/message-list-model'
import { rowContainsMessage } from '#/domain/message-list-model'
import { DisplayRow } from './message-rows'
import { ChatEmptyState } from './chat-empty-state'
import { recordClientPerformance } from '#/lib/browser-performance'
import { liveRunHasContent, type LiveRun } from './live-run'
import { buildTimelineRows } from './timeline-rows'
import { cn } from '#/lib/utils'

export function MessageList({
    sessionKey,
    room,
    rows,
    totalRows,
    liveRun,
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
    onSuggestPrompt,
    scrollToMessageId,
    scrollRequestId,
}: {
    sessionKey: string
    room: RoomRuntimeOverview
    rows: RoomSessionDisplayRow[]
    totalRows: number
    liveRun: LiveRun | null
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
    onSuggestPrompt: (text: string) => void
    scrollToMessageId?: string | null
    scrollRequestId?: number
}) {
    const containerRef = useRef<HTMLDivElement | null>(null)
    const stickToBottomRef = useRef(true)
    const mountedAtRef = useRef(performance.now())
    const renderLoggedSessionRef = useRef<string | null>(null)
    const pendingPrependRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null)
    const previousTimelineRowsRef = useRef<ChatTimelineRow[]>([])
    const measureFrameRef = useRef<number | null>(null)
    const [collapsedByRunId, setCollapsedByRunId] = useState<Map<string, boolean>>(() => new Map())
    const timelineRows = useMemo(() => {
        const built = buildTimelineRows(
            rows,
            liveRun,
            isWorking,
            sessionKey,
            previousTimelineRowsRef.current,
        )
        previousTimelineRowsRef.current = built
        return built
    }, [isWorking, liveRun, rows, sessionKey])
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
    }, [timelineRows, liveRun?.updatedAt, isWorking, scrollToBottom])

    useEffect(() => {
        if (!scrollToMessageId || !scrollRequestId) return
        const rowIndex = timelineRows.findIndex(
            (row) => rowContainsMessage(row) && row.message.id === scrollToMessageId,
        )
        if (rowIndex < 0) return
        stickToBottomRef.current = false
        rowVirtualizer.scrollToIndex(rowIndex, { align: 'center' })
    }, [rowVirtualizer, scrollRequestId, scrollToMessageId, timelineRows])

    const measureVisibleRows = useCallback(() => {
        if (measureFrameRef.current !== null) return
        const measure = () => {
            const node = containerRef.current
            if (!node) return
            for (const element of node.querySelectorAll<HTMLElement>('[data-virtual-row]')) {
                rowVirtualizer.measureElement(element)
            }
        }
        measureFrameRef.current = window.requestAnimationFrame(() => {
            measure()
            measureFrameRef.current = window.requestAnimationFrame(() => {
                measureFrameRef.current = null
                measure()
            })
        })
    }, [rowVirtualizer])

    useEffect(
        () => () => {
            if (measureFrameRef.current !== null) {
                window.cancelAnimationFrame(measureFrameRef.current)
                measureFrameRef.current = null
            }
        },
        [],
    )

    useLayoutEffect(() => {
        measureVisibleRows()
    }, [
        collapsedByRunId,
        editingMeasurementKey,
        measureVisibleRows,
        liveRun?.updatedAt,
        timelineRows,
    ])

    useLayoutEffect(() => {
        const pending = pendingPrependRef.current
        const node = containerRef.current
        if (!pending || !node) return
        pendingPrependRef.current = null
        node.scrollTop = node.scrollHeight - pending.scrollHeight + pending.scrollTop
    }, [rows.length])

    const hasStreamContent = liveRun !== null || liveRunHasContent(liveRun)
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
                    <ChatEmptyState room={room} onSuggestPrompt={onSuggestPrompt} />
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

export function timelineRowKey(
    sessionKey: string,
    row: ChatTimelineRow | undefined,
    index: number,
): string {
    return `${sessionKey}:${row?.id ?? `index-${index}`}`
}

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
