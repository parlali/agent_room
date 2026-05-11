import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { MessageSquareIcon } from 'lucide-react'

import { EmptyState, StatusDot } from '#/components/agent-room'
import type {
    RoomExecutionMessage,
    RoomExecutionThread,
    RoomRuntimeOverview,
} from '#/lib/room-execution-types'

import { buildDisplayItems, type EditingMessageDraft } from './message-list-model'
import { DisplayRow, StreamRow } from './message-rows'
import type { StreamTurnState } from './stream-state'
import { streamTurnHasContent } from './stream-state'

export function MessageList({
    sessionKey,
    room,
    messages,
    thread,
    stream,
    isWorking,
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
    messages: RoomExecutionMessage[]
    thread: RoomExecutionThread | null
    stream: StreamTurnState
    isWorking: boolean
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

    const handleScroll = useCallback(() => {
        const node = containerRef.current
        if (!node) return
        const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight
        stickToBottomRef.current = distanceFromBottom < 120
    }, [])

    const scrollToBottom = useCallback(() => {
        const node = containerRef.current
        if (!node) return
        node.scrollTop = node.scrollHeight
    }, [])

    useLayoutEffect(() => {
        stickToBottomRef.current = true
        scrollToBottom()
    }, [sessionKey, scrollToBottom])

    useEffect(() => {
        if (stickToBottomRef.current) scrollToBottom()
    }, [messages, stream, isWorking, scrollToBottom])

    const items = useMemo(
        () => buildDisplayItems(messages, isWorking, thread),
        [messages, isWorking, thread],
    )
    const hasStreamContent = streamTurnHasContent(stream)

    return (
        <div ref={containerRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 sm:px-6">
                {messages.length === 0 && !hasStreamContent ? (
                    <EmptyState
                        icon={MessageSquareIcon}
                        title="Start the conversation"
                        description={`Send the first message to ${room.displayName}.`}
                    />
                ) : null}
                {items.map((item) => (
                    <DisplayRow
                        key={item.type === 'message' ? item.message.id : item.id}
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
                ))}
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
