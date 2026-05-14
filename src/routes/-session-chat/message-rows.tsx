import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
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
import { recordClientPerformance } from '#/lib/browser-performance'
import type {
    RoomExecutionMessage,
    RoomRuntimeOverview,
    RoomSessionDisplayRow,
    RunTranscriptRow,
    WorkTranscriptItem,
} from '#/lib/room-execution-types'

import { AttachmentCards } from './attachment-cards'
import { renderMarkdown } from './markdown'
import {
    workTranscriptItemHasVisibleContent,
    type EditingMessageDraft,
    type DisplayItem,
} from '#/lib/message-list-model'
import { TranscriptRunStatus } from './session-run-status'
import { ToolActivity } from './tool-step'
import type { ToolActivityTask } from '#/lib/tool-activity'

type EditMessageHandler = (input: EditingMessageDraft) => void

type DisplayRowProps = {
    room: RoomRuntimeOverview
    item: DisplayItem | RoomSessionDisplayRow
    canEditMessages: boolean
    editingMessage: EditingMessageDraft | null
    editPending: boolean
    onEditMessage: EditMessageHandler
    onChangeEditingMessageText: (text: string) => void
    onSubmitEditingMessage: () => void
    onCancelEditingMessage: () => void
    assistantContinuesPrevious?: boolean
    transcriptCollapsed?: boolean
    onToggleTranscript?: (row: RunTranscriptRow) => void
    onRowLayoutChange?: () => void
}

export const DisplayRow = memo(function DisplayRowComponent({
    room,
    item,
    canEditMessages,
    editingMessage,
    editPending,
    onEditMessage,
    onChangeEditingMessageText,
    onSubmitEditingMessage,
    onCancelEditingMessage,
    assistantContinuesPrevious = false,
    transcriptCollapsed,
    onToggleTranscript,
    onRowLayoutChange,
}: DisplayRowProps) {
    if (item.type === 'run_transcript') {
        return (
            <RunTranscript
                room={room}
                row={item}
                collapsed={transcriptCollapsed ?? item.collapsed}
                onToggle={() => onToggleTranscript?.(item)}
                onLayoutChange={onRowLayoutChange}
            />
        )
    }

    if (item.type === 'assistant_final') {
        return (
            <AssistantRow
                room={room}
                text={item.message.text}
                timestamp={item.timestamp}
                streaming={item.streaming}
                showGlyph={!assistantContinuesPrevious}
            />
        )
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
}, areDisplayRowsEqual)

function ToolRow({
    id,
    tasks,
    onLayoutChange,
}: {
    id: string
    tasks: ToolActivityTask[]
    onLayoutChange?: () => void
}) {
    return (
        <div className="flex w-full justify-start">
            <ToolActivity
                id={id}
                tasks={tasks}
                className="min-w-0 flex-1"
                onLayoutChange={onLayoutChange}
            />
        </div>
    )
}

function RunTranscript({
    room,
    row,
    collapsed,
    onToggle,
    onLayoutChange,
}: {
    room: RoomRuntimeOverview
    row: RunTranscriptRow
    collapsed: boolean
    onToggle: () => void
    onLayoutChange?: () => void
}) {
    const displayItems = useMemo(() => groupTranscriptDisplayItems(row.items), [row.items])
    const visibleItemCount = displayItems.length
    useLayoutEffect(() => {
        onLayoutChange?.()
    }, [collapsed, onLayoutChange, row.runtimeMs, row.status, visibleItemCount])

    return (
        <div className="group/message flex w-full justify-start gap-3">
            <RoomGlyph name={room.displayName} seed={room.roomId} size="sm" className="mt-0.5" />
            <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
                <TranscriptRunStatus row={row} collapsed={collapsed} onToggle={onToggle} />
                {!collapsed && visibleItemCount > 0 ? (
                    <div className="flex w-full max-w-[min(42rem,92%)] flex-col gap-1.5">
                        {displayItems.map((item) => (
                            <TranscriptDisplayItem
                                key={item.id}
                                item={item}
                                onLayoutChange={onLayoutChange}
                            />
                        ))}
                    </div>
                ) : null}
            </div>
        </div>
    )
}

type TranscriptDisplayItem =
    | {
          type: 'item'
          id: string
          item: WorkTranscriptItem
      }
    | {
          type: 'tool_group'
          id: string
          tasks: ToolActivityTask[]
      }

function groupTranscriptDisplayItems(items: WorkTranscriptItem[]): TranscriptDisplayItem[] {
    const displayItems: TranscriptDisplayItem[] = []
    let toolGroup: Extract<TranscriptDisplayItem, { type: 'tool_group' }> | null = null

    const flushToolGroup = () => {
        if (!toolGroup) return
        displayItems.push(toolGroup)
        toolGroup = null
    }

    for (const item of items) {
        if (!workTranscriptItemHasVisibleContent(item)) continue
        if (item.type === 'tool_activity') {
            if (toolGroup) {
                toolGroup.tasks.push(item.task)
            } else {
                toolGroup = {
                    type: 'tool_group',
                    id: item.id,
                    tasks: [item.task],
                }
            }
            continue
        }
        flushToolGroup()
        displayItems.push({
            type: 'item',
            id: item.id,
            item,
        })
    }

    flushToolGroup()
    return displayItems
}

function TranscriptDisplayItem({
    item,
    onLayoutChange,
}: {
    item: TranscriptDisplayItem
    onLayoutChange?: () => void
}) {
    if (item.type === 'tool_group') {
        return <ToolRow id={item.id} tasks={item.tasks} onLayoutChange={onLayoutChange} />
    }

    return <TranscriptItem item={item.item} onLayoutChange={onLayoutChange} />
}

function TranscriptItem({
    item,
    onLayoutChange,
}: {
    item: WorkTranscriptItem
    onLayoutChange?: () => void
}) {
    if (item.type === 'model_text') {
        return (
            <div className="px-1 py-0.5 text-sm text-foreground">
                <MessageText text={item.markdown} streaming={!item.complete} />
            </div>
        )
    }

    return <ToolRow id={item.id} tasks={[item.task]} onLayoutChange={onLayoutChange} />
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
    onEditMessage: EditMessageHandler
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
    showGlyph = true,
}: {
    room: RoomRuntimeOverview
    text: string
    timestamp: number | null
    streaming: boolean
    showGlyph?: boolean
}) {
    return (
        <div className="group/message flex w-full justify-start gap-3">
            {showGlyph ? (
                <RoomGlyph
                    name={room.displayName}
                    seed={room.roomId}
                    size="sm"
                    className="mt-0.5"
                />
            ) : (
                <span className="size-6 shrink-0" aria-hidden />
            )}
            <div className="flex min-w-0 flex-col items-start gap-1">
                <div className="max-w-[min(42rem,92%)] rounded-2xl bg-card px-3.5 py-2 text-card-foreground shadow-sm ring-1 ring-foreground/10">
                    {text ? (
                        <MessageText text={text} streaming={streaming} />
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
}: {
    text: string
    streaming?: boolean
}) {
    const cacheKey = useMemo(() => markdownCacheKey(text, streaming), [streaming, text])
    const renderMetricRef = useRef<{ durationMs: number; textLength: number } | null>(null)
    const rendered = useMemo(() => {
        if (markdownRenderCache.has(cacheKey)) {
            return markdownRenderCache.get(cacheKey) ?? null
        }
        const startedAt = performance.now()
        const next = renderMarkdown(text, { streaming, complete: !streaming })
        rememberMarkdownRender(cacheKey, next)
        renderMetricRef.current = {
            textLength: text.length,
            durationMs: performance.now() - startedAt,
        }
        return next
    }, [cacheKey, streaming, text])
    useEffect(() => {
        const metric = renderMetricRef.current
        if (!metric) return
        renderMetricRef.current = null
        if (!shouldRecordMarkdownRenderMetric(metric, streaming)) return
        recordClientPerformance({
            name: 'chat.markdown.render',
            textLength: metric.textLength,
            durationMs: metric.durationMs,
        })
    }, [rendered, streaming])
    if (!text) return null
    return <>{rendered}</>
})

function shouldRecordMarkdownRenderMetric(
    metric: { durationMs: number; textLength: number },
    streaming: boolean,
): boolean {
    if (streaming) return false
    return metric.durationMs >= 8 || metric.textLength >= 4000
}

function areDisplayRowsEqual(previous: DisplayRowProps, next: DisplayRowProps): boolean {
    return (
        previous.room.roomId === next.room.roomId &&
        previous.room.displayName === next.room.displayName &&
        previous.item === next.item &&
        previous.canEditMessages === next.canEditMessages &&
        previous.editingMessage === next.editingMessage &&
        previous.editPending === next.editPending &&
        previous.assistantContinuesPrevious === next.assistantContinuesPrevious &&
        previous.transcriptCollapsed === next.transcriptCollapsed &&
        previous.onEditMessage === next.onEditMessage &&
        previous.onChangeEditingMessageText === next.onChangeEditingMessageText &&
        previous.onSubmitEditingMessage === next.onSubmitEditingMessage &&
        previous.onCancelEditingMessage === next.onCancelEditingMessage &&
        previous.onToggleTranscript === next.onToggleTranscript &&
        previous.onRowLayoutChange === next.onRowLayoutChange
    )
}

const markdownRenderCacheLimit = 160
const markdownRenderCache = new Map<string, ReactNode>()
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
