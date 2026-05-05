import { useCallback, useEffect, useRef } from 'react'

import { EmptyState, RoomGlyph, StatusDot } from '#/components/agent-room'
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip'
import { formatDateTime, formatRelativeTime, initialsFromName } from '#/lib/format'
import { cn } from '#/lib/utils'
import type { RoomExecutionMessage, RoomRuntimeOverview } from '#/server/rooms/execution-types'
import { MessageSquareIcon } from 'lucide-react'

import { renderInlineMarkdown } from './markdown'
import { ToolStep } from './tool-step'

export function MessageList({
    room,
    messages,
    isWorking,
}: {
    room: RoomRuntimeOverview
    messages: RoomExecutionMessage[]
    isWorking: boolean
}) {
    const containerRef = useRef<HTMLDivElement | null>(null)
    const stickToBottomRef = useRef(true)

    const handleScroll = useCallback(() => {
        const node = containerRef.current
        if (!node) return
        const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight
        stickToBottomRef.current = distanceFromBottom < 120
    }, [])

    useEffect(() => {
        const node = containerRef.current
        if (!node) return
        if (stickToBottomRef.current) {
            node.scrollTop = node.scrollHeight
        }
    }, [messages, isWorking])

    return (
        <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 sm:px-6">
                {messages.length === 0 ? (
                    <EmptyState
                        icon={MessageSquareIcon}
                        title="Start the conversation"
                        description={`Send the first message to ${room.displayName}.`}
                    />
                ) : null}
                {messages.map((message) => (
                    <MessageRow key={message.id} room={room} message={message} />
                ))}
                {isWorking ? (
                    <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
                        <StatusDot tone="working" pulse />
                        <span>{room.displayName} is working…</span>
                    </div>
                ) : null}
            </div>
        </div>
    )
}

function MessageRow({
    room,
    message,
}: {
    room: RoomRuntimeOverview
    message: RoomExecutionMessage
}) {
    if (message.role === 'system' || message.role === 'other') {
        return (
            <div className="px-2 py-1 text-center text-xs italic text-muted-foreground">
                {message.text || 'System update'}
            </div>
        )
    }

    if (message.role === 'tool') {
        return (
            <div className="flex w-full flex-col gap-1.5">
                {message.parts.map((part, index) => (
                    <ToolStep
                        key={`${message.id}:${part.toolCallId ?? index}`}
                        part={part}
                        index={index}
                    />
                ))}
            </div>
        )
    }

    const isUser = message.role === 'user'
    const toolParts = message.parts.filter(
        (part) => part.type === 'tool_call' || part.type === 'tool_result',
    )
    const showMessageBubble = Boolean(message.text || isUser || toolParts.length === 0)

    return (
        <div className={cn('flex w-full gap-3', isUser ? 'justify-end' : 'justify-start')}>
            {!isUser ? (
                <RoomGlyph
                    name={room.displayName}
                    seed={room.roomId}
                    size="sm"
                    className="mt-0.5"
                />
            ) : null}
            <div
                className={cn('flex min-w-0 flex-col gap-1', isUser ? 'items-end' : 'items-start')}
            >
                {showMessageBubble ? (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <div
                                className={cn(
                                    'max-w-[min(36rem,90%)] rounded-2xl px-3.5 py-2 text-sm shadow-sm whitespace-pre-wrap break-words',
                                    isUser
                                        ? 'bg-primary text-primary-foreground'
                                        : 'bg-card text-card-foreground ring-1 ring-foreground/10',
                                )}
                            >
                                <MessageText text={message.text} />
                                {!isUser && !message.text ? (
                                    <span className="text-muted-foreground">
                                        {initialsFromName(room.displayName, '··')} is working…
                                    </span>
                                ) : null}
                            </div>
                        </TooltipTrigger>
                        <TooltipContent side={isUser ? 'left' : 'right'}>
                            <span>
                                {isUser ? 'You' : room.displayName} ·{' '}
                                {formatDateTime(message.timestamp)}
                            </span>
                        </TooltipContent>
                    </Tooltip>
                ) : null}
                {!isUser ? (
                    <span className="px-1 text-[0.6875rem] text-muted-foreground">
                        {room.displayName} · {formatRelativeTime(message.timestamp)}
                    </span>
                ) : null}
                {toolParts.length > 0 ? (
                    <div
                        className={cn(
                            'flex w-full max-w-[min(36rem,90%)] flex-col gap-1.5 pt-1',
                            isUser ? 'items-end' : 'items-start',
                        )}
                    >
                        {toolParts.map((part, index) => (
                            <ToolStep
                                key={`${message.id}:${part.toolCallId ?? index}`}
                                part={part}
                                index={index}
                            />
                        ))}
                    </div>
                ) : null}
            </div>
        </div>
    )
}

function MessageText({ text }: { text: string }) {
    if (!text) return null
    return <>{renderInlineMarkdown(text)}</>
}
