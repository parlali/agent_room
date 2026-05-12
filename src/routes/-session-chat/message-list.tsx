import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { MessageSquareIcon } from 'lucide-react'

import { EmptyState, LoadingRows, StatusDot } from '#/components/agent-room'
import type { RoomSessionDisplayRow, RoomRuntimeOverview } from '#/lib/room-execution-types'

import type { EditingMessageDraft } from '#/lib/message-list-model'
import { DisplayRow, StreamRow } from './message-rows'
import { recordClientPerformance } from '#/lib/browser-performance'
import type { StreamTurnState } from './stream-state'
import { streamTurnHasContent } from './stream-state'

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
    const rowVirtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => containerRef.current,
        estimateSize: () => 112,
        overscan: 8,
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
    }, [rows, stream, isWorking, scrollToBottom])

    useLayoutEffect(() => {
        const pending = pendingPrependRef.current
        const node = containerRef.current
        if (!pending || !node) return
        pendingPrependRef.current = null
        node.scrollTop = node.scrollHeight - pending.scrollHeight + pending.scrollTop
    }, [rows.length])

    const hasStreamContent = streamTurnHasContent(stream)
    const virtualRows = rowVirtualizer.getVirtualItems()

    useEffect(() => {
        if (renderLoggedSessionRef.current === sessionKey) return
        if (rows.length === 0 || virtualRows.length === 0) return
        renderLoggedSessionRef.current = sessionKey
        recordClientPerformance({
            name: 'chat.window.render',
            roomId: room.roomId,
            sessionKey,
            rowCount: rows.length,
            virtualRowCount: virtualRows.length,
            totalRows,
            durationMs: performance.now() - mountedAtRef.current,
        })
    }, [room.roomId, rows.length, sessionKey, totalRows, virtualRows.length])

    return (
        <div
            ref={containerRef}
            onScroll={handleScroll}
            className="min-h-0 flex-1 overflow-y-auto"
            aria-busy={loadingInitialRows}
        >
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 sm:px-6">
                {loadingInitialRows ? <LoadingRows count={4} /> : null}
                {rows.length === 0 && !hasStreamContent && !loadingInitialRows ? (
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
                        const item = rows[virtualRow.index]!
                        return (
                            <div
                                key={item.id}
                                ref={rowVirtualizer.measureElement}
                                data-index={virtualRow.index}
                                className="absolute left-0 top-0 w-full pb-4"
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
                                />
                            </div>
                        )
                    })}
                </div>
                {stream.items.map((item) => (
                    <StreamRow key={item.id} room={room} item={item} timestamp={stream.updatedAt} />
                ))}
                {isWorking && !hasStreamContent ? (
                    <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
                        <StatusDot tone="working" pulse />
                        <span>{room.displayName} is working...</span>
                    </div>
                ) : null}
            </div>
        </div>
    )
}
