import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { CopyIcon, PencilIcon } from 'lucide-react'
import { toast } from 'sonner'

import { RoomGlyph } from '#/components/agent-room'
import { Button } from '#/components/ui/button'
import { Textarea } from '#/components/ui/textarea'
import { copyText } from '#/lib/clipboard'
import { formatDateTime, initialsFromName } from '#/lib/format'
import { parseRoomMessageAttachments } from '#/lib/room-attachments'
import { cn } from '#/lib/utils'
import type {
    RoomExecutionMessage,
    RoomRuntimeOverview,
    RoomSessionDisplayRow,
} from '#/lib/room-execution-types'

import { AttachmentCards } from './attachment-cards'
import { renderMarkdown } from './markdown'
import type { EditingMessageDraft, DisplayItem } from '#/lib/message-list-model'
import { SessionRunStatus } from './session-run-status'
import type { StreamTurnItem } from './stream-state'
import { ToolActivity } from './tool-step'
import type { ToolActivityTask } from '#/lib/tool-activity'

type EditMessageHandler = (input: EditingMessageDraft) => void

export function DisplayRow({
    room,
    item,
    canEditMessages,
    editingMessage,
    editPending,
    onEditMessage,
    onChangeEditingMessageText,
    onSubmitEditingMessage,
    onCancelEditingMessage,
    deferRichText = false,
}: {
    room: RoomRuntimeOverview
    item: DisplayItem | RoomSessionDisplayRow
    canEditMessages: boolean
    editingMessage: EditingMessageDraft | null
    editPending: boolean
    onEditMessage: EditMessageHandler
    onChangeEditingMessageText: (text: string) => void
    onSubmitEditingMessage: () => void
    onCancelEditingMessage: () => void
    deferRichText?: boolean
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
            deferRichText={deferRichText}
        />
    )
}

export function StreamRow({
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
    deferRichText,
}: {
    room: RoomRuntimeOverview
    message: RoomExecutionMessage
    canEditMessages: boolean
    editingMessage: EditingMessageDraft | null
    editPending: boolean
    onEditMessage: EditMessageHandler
    onChangeEditingMessageText: (text: string) => void
    onSubmitEditingMessage: () => void
    onCancelEditingMessage: () => void
    deferRichText: boolean
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
                deferRichText={deferRichText}
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
                        <MessageText text={parsed.text} deferRichText={deferRichText} />
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
    deferRichText = false,
}: {
    room: RoomRuntimeOverview
    text: string
    timestamp: number | null
    streaming: boolean
    deferRichText?: boolean
}) {
    return (
        <div className="group/message flex w-full justify-start gap-3">
            <RoomGlyph name={room.displayName} seed={room.roomId} size="sm" className="mt-0.5" />
            <div className="flex min-w-0 flex-col items-start gap-1">
                <div className="max-w-[min(42rem,92%)] rounded-2xl bg-card px-3.5 py-2 text-card-foreground shadow-sm ring-1 ring-foreground/10">
                    {text ? (
                        <MessageText
                            text={text}
                            streaming={streaming}
                            deferRichText={deferRichText}
                        />
                    ) : (
                        <span className="text-muted-foreground">
                            {initialsFromName(room.displayName, '..')} is working...
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

const MessageText = memo(function RenderedMessageText({
    text,
    streaming = false,
    deferRichText = false,
}: {
    text: string
    streaming?: boolean
    deferRichText?: boolean
}) {
    const cacheKey = useMemo(() => markdownCacheKey(text, streaming), [streaming, text])
    const [ready, setReady] = useState(() => !deferRichText || markdownRenderCache.has(cacheKey))

    useEffect(() => {
        if (!deferRichText || markdownRenderCache.has(cacheKey)) {
            setReady(true)
            return
        }
        setReady(false)
        return enqueueMarkdownHydration(() => setReady(true))
    }, [cacheKey, deferRichText])

    const rendered = useMemo(() => {
        if (!ready) return null
        if (markdownRenderCache.has(cacheKey)) {
            return markdownRenderCache.get(cacheKey) ?? null
        }
        const next = renderMarkdown(text, { streaming, complete: !streaming })
        rememberMarkdownRender(cacheKey, next)
        return next
    }, [cacheKey, ready, streaming, text])
    if (!text) return null
    if (!ready) {
        return <span className="whitespace-pre-wrap">{text}</span>
    }
    return <>{rendered}</>
})

const markdownRenderCacheLimit = 160
const markdownRenderCache = new Map<string, ReactNode>()
const markdownHydrationQueue: Array<() => void> = []
let markdownHydrationScheduled = false

function markdownCacheKey(text: string, streaming: boolean): string {
    return `${streaming ? 'streaming' : 'complete'}:${text}`
}

function rememberMarkdownRender(key: string, value: ReactNode): void {
    if (markdownRenderCache.has(key)) {
        markdownRenderCache.delete(key)
    }
    markdownRenderCache.set(key, value)
    while (markdownRenderCache.size > markdownRenderCacheLimit) {
        const oldest = markdownRenderCache.keys().next().value
        if (oldest === undefined) return
        markdownRenderCache.delete(oldest)
    }
}

function enqueueMarkdownHydration(task: () => void): () => void {
    let active = true
    markdownHydrationQueue.push(() => {
        if (active) task()
    })
    scheduleMarkdownHydration()
    return () => {
        active = false
    }
}

function scheduleMarkdownHydration(): void {
    if (markdownHydrationScheduled) return
    markdownHydrationScheduled = true
    const run = () => {
        markdownHydrationScheduled = false
        const task = markdownHydrationQueue.shift()
        task?.()
        if (markdownHydrationQueue.length > 0) {
            scheduleMarkdownHydration()
        }
    }
    const idleWindow = window as Window & {
        requestIdleCallback?: Window['requestIdleCallback']
    }
    if (typeof idleWindow.requestIdleCallback === 'function') {
        idleWindow.requestIdleCallback(run, { timeout: 500 })
        return
    }
    window.setTimeout(run, 80)
}
