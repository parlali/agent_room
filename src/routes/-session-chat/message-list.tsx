import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { KeyboardEvent } from 'react'

import { EmptyState, RoomGlyph, StatusDot } from '#/components/agent-room'
import { Button } from '#/components/ui/button'
import { Textarea } from '#/components/ui/textarea'
import { copyText } from '#/lib/clipboard'
import { formatDateTime, initialsFromName } from '#/lib/format'
import { parseRoomMessageAttachments } from '#/lib/room-attachments'
import type { RoomAttachment } from '#/lib/room-attachments'
import { cn } from '#/lib/utils'
import type {
    RoomExecutionMessage,
    RoomExecutionThread,
    RoomRuntimeOverview,
} from '#/server/rooms/execution-types'
import { CopyIcon, MessageSquareIcon, PencilIcon } from 'lucide-react'
import { toast } from 'sonner'

import { renderMarkdown } from './markdown'
import type { StreamTurnItem, StreamTurnState } from './stream-state'
import { streamTurnHasContent } from './stream-state'
import { ToolActivity } from './tool-step'
import {
    toolTasksFromParts,
    type ToolActivityTask,
    type ToolTaskStatus,
} from './tool-activity-model'
import { AttachmentCards } from './attachment-cards'
import { SessionRunStatus } from './session-run-status'

type DisplayItem =
    | { type: 'message'; message: RoomExecutionMessage }
    | { type: 'tools'; id: string; tasks: ToolActivityTask[]; timestamp: number | null }
    | { type: 'run-status'; id: string; thread: RoomExecutionThread | null }

type EditingMessageDraft = {
    id: string
    text: string
    timestamp: number | null
    attachments: RoomAttachment[]
}

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
    onEditMessage: (input: {
        id: string
        text: string
        timestamp: number | null
        attachments: RoomAttachment[]
    }) => void
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
                        <span>{room.displayName} is working…</span>
                    </div>
                ) : null}
            </div>
        </div>
    )
}

function DisplayRow({
    room,
    item,
    canEditMessages,
    editingMessage,
    editPending,
    onEditMessage,
    onChangeEditingMessageText,
    onSubmitEditingMessage,
    onCancelEditingMessage,
}: {
    room: RoomRuntimeOverview
    item: DisplayItem
    canEditMessages: boolean
    editingMessage: EditingMessageDraft | null
    editPending: boolean
    onEditMessage: (input: {
        id: string
        text: string
        timestamp: number | null
        attachments: RoomAttachment[]
    }) => void
    onChangeEditingMessageText: (text: string) => void
    onSubmitEditingMessage: () => void
    onCancelEditingMessage: () => void
}) {
    if (item.type === 'tools') {
        return <ToolRow id={item.id} tasks={item.tasks} />
    }
    if (item.type === 'run-status') {
        return <SessionRunStatus thread={item.thread} variant="body" />
    }
    return (
        <MessageRow
            room={room}
            message={item.message}
            canEditMessages={canEditMessages}
            editingMessage={editingMessage}
            editPending={editPending}
            onEditMessage={onEditMessage}
            onChangeEditingMessageText={onChangeEditingMessageText}
            onSubmitEditingMessage={onSubmitEditingMessage}
            onCancelEditingMessage={onCancelEditingMessage}
        />
    )
}

function StreamRow({
    room,
    item,
    timestamp,
}: {
    room: RoomRuntimeOverview
    item: StreamTurnItem
    timestamp: number | null
}) {
    if (item.type === 'tools') {
        return <ToolRow id={item.id} tasks={item.tasks} />
    }

    return (
        <AssistantRow
            room={room}
            text={item.markdown}
            timestamp={timestamp}
            streaming={!item.complete}
        />
    )
}

function ToolRow({ id, tasks }: { id: string; tasks: ToolActivityTask[] }) {
    return (
        <div className="flex w-full justify-start gap-3">
            <div className="size-8 shrink-0" aria-hidden />
            <ToolActivity id={id} tasks={tasks} className="min-w-0 flex-1" />
        </div>
    )
}

function MessageRow({
    room,
    message,
    canEditMessages,
    editingMessage,
    editPending,
    onEditMessage,
    onChangeEditingMessageText,
    onSubmitEditingMessage,
    onCancelEditingMessage,
}: {
    room: RoomRuntimeOverview
    message: RoomExecutionMessage
    canEditMessages: boolean
    editingMessage: EditingMessageDraft | null
    editPending: boolean
    onEditMessage: (input: {
        id: string
        text: string
        timestamp: number | null
        attachments: RoomAttachment[]
    }) => void
    onChangeEditingMessageText: (text: string) => void
    onSubmitEditingMessage: () => void
    onCancelEditingMessage: () => void
}) {
    if (message.role === 'system' || message.role === 'other') {
        return (
            <div className="px-2 py-1 text-center text-xs italic text-muted-foreground">
                {message.text || 'System update'}
            </div>
        )
    }

    const isUser = message.role === 'user'
    const parsed = parseRoomMessageAttachments(message.text)
    const showMessageBubble = Boolean(parsed.text || (isUser && parsed.attachments.length === 0))
    const isEditing = editingMessage?.id === message.id

    if (!isUser) {
        return (
            <AssistantRow
                room={room}
                text={message.text}
                timestamp={message.timestamp}
                streaming={false}
            />
        )
    }

    return (
        <div className="group/message flex w-full justify-end gap-3">
            <div className="flex w-full min-w-0 flex-col items-end gap-1">
                {parsed.attachments.length > 0 ? (
                    <AttachmentCards
                        roomId={room.roomId}
                        attachments={parsed.attachments}
                        compact
                        align="end"
                    />
                ) : null}
                {isEditing ? (
                    <EditableUserMessage
                        text={editingMessage.text}
                        timestamp={editingMessage.timestamp}
                        pending={editPending}
                        canSubmit={
                            editingMessage.text.trim().length > 0 ||
                            editingMessage.attachments.length > 0
                        }
                        onChange={onChangeEditingMessageText}
                        onSubmit={onSubmitEditingMessage}
                        onCancel={onCancelEditingMessage}
                    />
                ) : showMessageBubble ? (
                    <div className="max-w-[min(36rem,90%)] rounded-2xl bg-primary px-3.5 py-2 text-sm break-words whitespace-pre-wrap text-primary-foreground shadow-sm">
                        <MessageText text={parsed.text} />
                    </div>
                ) : null}
                {isEditing ? null : (
                    <MessageActions
                        text={message.text}
                        timestamp={message.timestamp}
                        align="end"
                        canEdit={canEditMessages && !editingMessage}
                        onEdit={() =>
                            onEditMessage({
                                id: message.id,
                                text: parsed.text,
                                timestamp: message.timestamp,
                                attachments: parsed.attachments,
                            })
                        }
                    />
                )}
            </div>
        </div>
    )
}

function EditableUserMessage({
    text,
    timestamp,
    pending,
    canSubmit,
    onChange,
    onSubmit,
    onCancel,
}: {
    text: string
    timestamp: number | null
    pending: boolean
    canSubmit: boolean
    onChange: (text: string) => void
    onSubmit: () => void
    onCancel: () => void
}) {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null)

    useEffect(() => {
        const textarea = textareaRef.current
        if (!textarea) return
        textarea.focus()
        textarea.setSelectionRange(textarea.value.length, textarea.value.length)
    }, [])

    const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
            return
        }
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            onSubmit()
        }
    }

    return (
        <form
            className="flex w-full max-w-[min(36rem,90%)] flex-col gap-2 rounded-2xl bg-primary p-2.5 text-primary-foreground shadow-sm"
            onSubmit={(event) => {
                event.preventDefault()
                onSubmit()
            }}
        >
            <Textarea
                ref={textareaRef}
                value={text}
                rows={3}
                onChange={(event) => onChange(event.target.value)}
                onKeyDown={onKeyDown}
                className="min-h-24 resize-none border-primary-foreground/20 bg-transparent text-sm text-primary-foreground placeholder:text-primary-foreground/60 focus-visible:border-primary-foreground/40 focus-visible:ring-primary-foreground/20 dark:bg-transparent"
                disabled={pending}
            />
            <div className="flex items-center justify-between gap-2">
                <MessageDate
                    timestamp={timestamp}
                    className="text-primary-foreground/70 opacity-100"
                />
                <div className="flex items-center gap-1.5">
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={onCancel}
                        disabled={pending}
                        className="text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
                    >
                        Cancel
                    </Button>
                    <Button
                        type="submit"
                        variant="secondary"
                        size="sm"
                        loading={pending}
                        disabled={!canSubmit}
                        className="bg-primary-foreground text-primary hover:bg-primary-foreground/90"
                    >
                        Send
                    </Button>
                </div>
            </div>
        </form>
    )
}

function AssistantRow({
    room,
    text,
    timestamp,
    streaming,
}: {
    room: RoomRuntimeOverview
    text: string
    timestamp: number | null
    streaming: boolean
}) {
    return (
        <div className="group/message flex w-full justify-start gap-3">
            <RoomGlyph name={room.displayName} seed={room.roomId} size="sm" className="mt-0.5" />
            <div className="flex min-w-0 flex-col items-start gap-1">
                <div className="max-w-[min(42rem,92%)] rounded-2xl bg-card px-3.5 py-2 text-card-foreground shadow-sm ring-1 ring-foreground/10">
                    {text ? (
                        <MessageText text={text} streaming={streaming} />
                    ) : (
                        <span className="text-muted-foreground">
                            {initialsFromName(room.displayName, '··')} is working…
                        </span>
                    )}
                </div>
                <MessageActions text={text} timestamp={timestamp} />
            </div>
        </div>
    )
}

function MessageActions({
    text,
    timestamp,
    align = 'start',
    canEdit = false,
    onEdit,
}: {
    text: string
    timestamp: number | null
    align?: 'start' | 'end'
    canEdit?: boolean
    onEdit?: () => void
}) {
    const copyMessage = async () => {
        if (!text.trim()) return
        try {
            await copyText(text)
            toast.success('Message copied')
        } catch {
            toast.error('Could not copy message')
        }
    }

    return (
        <div
            className={cn(
                'flex min-h-6 w-full items-center gap-1 px-1',
                align === 'end' ? 'justify-end' : 'justify-start',
            )}
        >
            {align === 'end' ? <MessageDate timestamp={timestamp} className="mr-1" /> : null}
            <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="size-5 text-muted-foreground hover:text-foreground"
                onClick={() => void copyMessage()}
                disabled={!text.trim()}
                aria-label="Copy message"
            >
                <CopyIcon className="size-3.5" />
            </Button>
            {canEdit ? (
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="size-5 text-muted-foreground hover:text-foreground"
                    onClick={onEdit}
                    aria-label="Edit message"
                >
                    <PencilIcon className="size-3.5" />
                </Button>
            ) : null}
            {align === 'start' ? <MessageDate timestamp={timestamp} className="ml-1" /> : null}
        </div>
    )
}

function MessageDate({ timestamp, className }: { timestamp: number | null; className?: string }) {
    return (
        <span
            className={cn(
                'text-[0.6875rem] whitespace-nowrap text-muted-foreground opacity-0 transition-opacity group-hover/message:opacity-100',
                className,
            )}
        >
            {formatDateTime(timestamp)}
        </span>
    )
}

function buildDisplayItems(
    messages: RoomExecutionMessage[],
    isWorking: boolean,
    thread: RoomExecutionThread | null,
): DisplayItem[] {
    const items: DisplayItem[] = []
    let pendingTools: Extract<DisplayItem, { type: 'tools' }> | null = null
    const runStatusAfterMessageId = latestUserMessageId(messages)

    const flushTools = (settleAs?: 'complete' | 'error') => {
        if (!pendingTools) return
        if (settleAs) {
            pendingTools = {
                ...pendingTools,
                tasks: pendingTools.tasks.map((task) =>
                    task.status === 'pending' || task.status === 'in_progress'
                        ? {
                              ...task,
                              status: settleAs,
                              result:
                                  task.result ??
                                  (settleAs === 'error'
                                      ? 'The tool did not finish'
                                      : 'The tool finished'),
                          }
                        : task,
                ),
            }
        }
        items.push(pendingTools)
        pendingTools = null
    }

    const appendTools = (message: RoomExecutionMessage, parts: RoomExecutionMessage['parts']) => {
        const tasks = toolTasksFromParts(parts)
        if (tasks.length === 0) return
        if (!pendingTools) {
            pendingTools = {
                type: 'tools',
                id: `tools-${message.id}`,
                tasks: [],
                timestamp: message.timestamp,
            }
        }
        for (const task of tasks) {
            const existingIndex = pendingTools.tasks.findIndex((entry) => entry.id === task.id)
            if (existingIndex < 0) {
                pendingTools.tasks.push(task)
            } else {
                pendingTools.tasks[existingIndex] = mergeToolTaskForDisplay(
                    pendingTools.tasks[existingIndex]!,
                    task,
                )
            }
        }
        pendingTools.timestamp = pendingTools.timestamp ?? message.timestamp
    }

    for (const message of messages) {
        const toolParts = message.parts.filter(
            (part) => part.type === 'tool_call' || part.type === 'tool_result',
        )

        if (message.role === 'tool') {
            appendTools(message, toolParts)
            continue
        }

        if (message.role === 'assistant' && toolParts.length > 0) {
            if (message.text.trim()) {
                flushTools('complete')
                items.push({
                    type: 'message',
                    message: {
                        ...message,
                        parts: message.parts.filter(
                            (part) => part.type !== 'tool_call' && part.type !== 'tool_result',
                        ),
                    },
                })
            }
            appendTools(message, toolParts)
            continue
        }

        flushTools('complete')
        items.push({ type: 'message', message })
        if (message.id === runStatusAfterMessageId) {
            items.push({
                type: 'run-status',
                id: `run-status-${message.id}`,
                thread,
            })
        }
    }

    flushTools(isWorking ? undefined : 'complete')
    return items
}

function latestUserMessageId(messages: RoomExecutionMessage[]): string | null {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index]!
        if (message.role === 'user') return message.id
    }
    return null
}

function mergeToolTaskForDisplay(
    existing: ToolActivityTask,
    incoming: ToolActivityTask,
): ToolActivityTask {
    const status = combinedToolStatus(existing.status, incoming.status)
    return {
        ...existing,
        status,
        detail: existing.detail ?? incoming.detail,
        result: incoming.result ?? existing.result,
    }
}

function combinedToolStatus(left: ToolTaskStatus, right: ToolTaskStatus): ToolTaskStatus {
    if (left === 'error' || right === 'error') return 'error'
    if (left === 'complete' || right === 'complete') return 'complete'
    if (left === 'in_progress' || right === 'in_progress') return 'in_progress'
    return 'pending'
}

function MessageText({ text, streaming = false }: { text: string; streaming?: boolean }) {
    if (!text) return null
    return <>{renderMarkdown(text, { streaming, complete: !streaming })}</>
}
