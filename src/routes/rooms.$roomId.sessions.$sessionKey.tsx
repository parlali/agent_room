import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent, ReactNode } from 'react'
import {
    AlertTriangleIcon,
    ArrowLeftIcon,
    CheckIcon,
    ClockIcon,
    LoaderIcon,
    MessageSquareIcon,
    PaperclipIcon,
    SendIcon,
    SquareIcon,
} from 'lucide-react'
import { toast } from 'sonner'

import { AppShell } from '#/components/app-shell'
import { Button } from '#/components/ui/button'
import { Textarea } from '#/components/ui/textarea'
import { Skeleton } from '#/components/ui/skeleton'
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from '#/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '#/components/ui/tooltip'
import {
    AttentionBanner,
    EmptyState,
    RoomGlyph,
    StateBadge,
    StatusDot,
} from '#/components/agent-room'
import { describeSessionState } from '#/lib/state'
import { formatDateTime, formatRelativeTime, initialsFromName } from '#/lib/format'
import { cn } from '#/lib/utils'
import {
    abortMessageServer,
    getRoomExecutionServer,
    sendMessageServer,
} from '#/routes/-room-runtime-server'
import { requireRouteUser } from '#/routes/-route-auth'
import type {
    RoomExecutionMessage,
    RoomExecutionMessagePart,
    RoomExecutionSnapshot,
    RoomRuntimeOverview,
} from '#/server/rooms/execution-types'

export const Route = createFileRoute('/rooms/$roomId/sessions/$sessionKey')({
    beforeLoad: requireRouteUser,
    component: SessionChatRoute,
})

const STREAM_ERROR_THRESHOLD = 6

type StepTone = 'ready' | 'working' | 'attention' | 'muted'

interface StepDescriptor {
    title: string
    tone: StepTone
    summary: string
}

function SessionChatRoute() {
    const { roomId, sessionKey } = Route.useParams()
    return (
        <AppShell>
            <TooltipProvider delayDuration={150}>
                <SessionChatPane roomId={roomId} sessionKey={sessionKey} />
            </TooltipProvider>
        </AppShell>
    )
}

function SessionChatPane({ roomId, sessionKey }: { roomId: string; sessionKey: string }) {
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const [draft, setDraft] = useState('')
    const [streamError, setStreamError] = useState<string | null>(null)
    const queryKey = useMemo(
        () => ['room-execution', roomId, sessionKey] as const,
        [roomId, sessionKey],
    )

    const executionQuery = useQuery<RoomExecutionSnapshot>({
        queryKey,
        queryFn: () => getRoomExecutionServer({ data: { roomId, selectedThreadKey: sessionKey } }),
    })

    const snapshot = executionQuery.data
    const room = snapshot?.room ?? null
    const messages = useMemo(
        () => dedupeMessages(snapshot?.selectedThreadMessages ?? []),
        [snapshot?.selectedThreadMessages],
    )
    const selectedThread = useMemo(
        () => snapshot?.threads.find((thread) => thread.key === sessionKey) ?? null,
        [snapshot?.threads, sessionKey],
    )
    const sessionTone = describeSessionState(selectedThread?.status ?? null)
    const isWorking =
        sessionTone.tone === 'working' || isLastMessageInProgress(snapshot?.selectedThreadMessages)
    const lastAssistantRunId = useMemo(
        () => extractLatestStreamRunId(snapshot?.selectedThreadMessages ?? []),
        [snapshot?.selectedThreadMessages],
    )

    useStreamingRefetch({ roomId, sessionKey, queryClient, queryKey, onError: setStreamError })

    const sendMutation = useMutation({
        mutationFn: (message: string) =>
            sendMessageServer({ data: { roomId, sessionKey, message } }),
        onSuccess: () => {
            setDraft('')
            void queryClient.invalidateQueries({ queryKey })
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : 'Message could not be sent')
        },
    })

    const abortMutation = useMutation({
        mutationFn: () =>
            abortMessageServer({
                data: { roomId, sessionKey, runId: lastAssistantRunId ?? null },
            }),
        onSuccess: (result) => {
            if (result.abortedRunId) {
                toast.success('Stopped this run')
            } else {
                toast.message('No active run to stop')
            }
            void queryClient.invalidateQueries({ queryKey })
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : 'Stop request failed')
        },
    })

    const submitDraft = () => {
        if (sendMutation.isPending) return
        const value = draft.trim()
        if (!value) return
        sendMutation.mutate(value)
    }

    const onSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        submitDraft()
    }

    const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            submitDraft()
        }
    }

    if (executionQuery.isLoading && !snapshot) {
        return <ChatSkeleton />
    }

    if (!room) {
        return (
            <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 py-10">
                <EmptyState
                    icon={MessageSquareIcon}
                    title="Room not found"
                    description="This room may have been removed. Pick another from the rooms list."
                    action={
                        <Button asChild variant="outline" size="sm">
                            <Link to="/">Back to rooms</Link>
                        </Button>
                    }
                />
            </div>
        )
    }

    return (
        <div className="flex min-h-svh flex-col">
            <ChatHeader
                room={room}
                sessionTitle={selectedThread?.title ?? 'Conversation'}
                sessionLabel={sessionTone.label}
                sessionToneKey={sessionTone.tone}
                provider={
                    selectedThread?.modelProvider ?? snapshot?.roomAgent?.modelPrimary ?? null
                }
                model={selectedThread?.model ?? null}
                compaction={selectedThread?.compaction ?? null}
                onBack={() => {
                    void navigate({ to: '/rooms/$roomId', params: { roomId } })
                }}
            />
            {snapshot?.executionState === 'error' ? (
                <div className="border-b border-border/60 px-4 py-3 sm:px-6">
                    <AttentionBanner
                        tone="danger"
                        title="Runtime is reporting an error"
                        description={
                            snapshot.executionMessage ??
                            'The room runtime is unhealthy. Open status to investigate.'
                        }
                        action={
                            <Button asChild variant="outline" size="sm">
                                <Link to="/rooms/$roomId/status" params={{ roomId }}>
                                    Open status
                                </Link>
                            </Button>
                        }
                    />
                </div>
            ) : null}
            {streamError ? (
                <div className="border-b border-border/60 px-4 py-3 sm:px-6">
                    <AttentionBanner
                        tone="attention"
                        title="Live updates paused"
                        description={streamError}
                        action={
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                    setStreamError(null)
                                    void queryClient.invalidateQueries({ queryKey })
                                }}
                            >
                                Refresh
                            </Button>
                        }
                    />
                </div>
            ) : null}
            <MessageList room={room} messages={messages} isWorking={isWorking} />
            <Composer
                roomDisplayName={room.displayName}
                draft={draft}
                onChangeDraft={setDraft}
                onSubmit={onSubmit}
                onKeyDown={onComposerKeyDown}
                sending={sendMutation.isPending}
                stopping={abortMutation.isPending}
                canStop={isWorking && (snapshot?.capabilities.canAbortGeneration ?? true)}
                onStop={() => abortMutation.mutate()}
            />
        </div>
    )
}

function ChatHeader({
    room,
    sessionTitle,
    sessionLabel,
    sessionToneKey,
    provider,
    model,
    compaction,
    onBack,
}: {
    room: RoomRuntimeOverview
    sessionTitle: string
    sessionLabel: string
    sessionToneKey: ReturnType<typeof describeSessionState>['tone']
    provider: string | null
    model: string | null
    compaction: RoomExecutionSnapshot['threads'][number]['compaction'] | null
    onBack: () => void
}) {
    const modelLabel = [provider, model].filter(Boolean).join(' / ')
    const compactionLabel = compaction
        ? compaction.compacting
            ? 'Compacting context'
            : compaction.count > 0
              ? `Context compacted ${compaction.count} ${compaction.count === 1 ? 'time' : 'times'}`
              : compaction.enabled
                ? 'Auto-compact on'
                : 'Auto-compact off'
        : null
    return (
        <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-background/95 px-3 py-2.5 backdrop-blur sm:px-6">
            <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back to room">
                <ArrowLeftIcon />
            </Button>
            <RoomGlyph name={room.displayName} seed={room.roomId} size="sm" />
            <div className="flex min-w-0 flex-1 flex-col leading-tight">
                <Link
                    to="/rooms/$roomId"
                    params={{ roomId: room.roomId }}
                    className="truncate text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                    {room.displayName}
                </Link>
                <span className="truncate text-sm font-medium text-foreground">{sessionTitle}</span>
                {modelLabel ? (
                    <span className="truncate text-[0.6875rem] text-muted-foreground">
                        {modelLabel}
                        {compactionLabel ? ` · ${compactionLabel}` : ''}
                    </span>
                ) : null}
            </div>
            <StateBadge
                tone={sessionToneKey}
                label={sessionLabel}
                pulse={sessionToneKey === 'working'}
            />
        </header>
    )
}

function MessageList({
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

function ToolStep({ part, index }: { part: RoomExecutionMessagePart; index: number }) {
    const [open, setOpen] = useState(false)
    const descriptor = describeToolStep(part, index)
    const Icon = stepIcon(descriptor.tone)
    const detailEntries = collectDetailEntries(part)

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="flex w-full items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-2 text-left text-sm shadow-sm transition-colors hover:bg-muted/40"
            >
                <span className="flex size-6 shrink-0 items-center justify-center">
                    <Icon
                        className={cn(
                            'size-4',
                            descriptor.tone === 'ready' && 'text-ready-fg',
                            descriptor.tone === 'working' && 'text-working-fg animate-pulse',
                            descriptor.tone === 'attention' && 'text-attention-fg',
                            descriptor.tone === 'muted' && 'text-muted-foreground',
                        )}
                    />
                </span>
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="truncate font-medium text-foreground">{descriptor.title}</span>
                    <span className="truncate text-xs text-muted-foreground">
                        {descriptor.summary}
                    </span>
                </span>
                <StatusDot tone={descriptor.tone} pulse={descriptor.tone === 'working'} />
            </button>
            <Sheet open={open} onOpenChange={setOpen}>
                <SheetContent side="right" className="w-full sm:max-w-md">
                    <SheetHeader>
                        <SheetTitle>{descriptor.title}</SheetTitle>
                        <SheetDescription>{descriptor.summary}</SheetDescription>
                    </SheetHeader>
                    <div className="flex flex-col gap-4 px-4 pb-6">
                        {detailEntries.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                                No further details were captured for this step.
                            </p>
                        ) : (
                            detailEntries.map((entry) => (
                                <div key={entry.label} className="flex flex-col gap-1.5">
                                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                        {entry.label}
                                    </span>
                                    <pre
                                        className={cn(
                                            'overflow-x-auto rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap break-words',
                                            entry.tone === 'danger' &&
                                                'border-destructive/40 bg-destructive/5 text-destructive',
                                        )}
                                    >
                                        {entry.value}
                                    </pre>
                                </div>
                            ))
                        )}
                    </div>
                </SheetContent>
            </Sheet>
        </>
    )
}

function MessageText({ text }: { text: string }) {
    if (!text) return null
    return <>{renderInlineMarkdown(text)}</>
}

function Composer({
    roomDisplayName,
    draft,
    onChangeDraft,
    onSubmit,
    onKeyDown,
    sending,
    stopping,
    canStop,
    onStop,
}: {
    roomDisplayName: string
    draft: string
    onChangeDraft: (value: string) => void
    onSubmit: (event: FormEvent<HTMLFormElement>) => void
    onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
    sending: boolean
    stopping: boolean
    canStop: boolean
    onStop: () => void
}) {
    const [attachOpen, setAttachOpen] = useState(false)
    const trimmed = draft.trim()

    return (
        <form
            onSubmit={onSubmit}
            className="sticky bottom-0 border-t border-border bg-background/95 px-3 py-3 backdrop-blur sm:px-6"
        >
            <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Attach a file"
                            onClick={() => setAttachOpen(true)}
                        >
                            <PaperclipIcon />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">Attach a file</TooltipContent>
                </Tooltip>
                <Textarea
                    value={draft}
                    onChange={(event) => onChangeDraft(event.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder={`Message ${roomDisplayName}`}
                    className="max-h-48 min-h-10 flex-1 resize-none"
                    rows={1}
                />
                {canStop ? (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                onClick={onStop}
                                disabled={stopping}
                                aria-label="Stop generation"
                            >
                                <SquareIcon />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">Stop</TooltipContent>
                    </Tooltip>
                ) : null}
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            type="submit"
                            size="icon"
                            disabled={sending || !trimmed}
                            aria-label="Send message"
                        >
                            {sending ? <LoaderIcon className="animate-spin" /> : <SendIcon />}
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">Send · Cmd+Enter</TooltipContent>
                </Tooltip>
            </div>
            <Sheet open={attachOpen} onOpenChange={setAttachOpen}>
                <SheetContent side="right" className="w-full sm:max-w-md">
                    <SheetHeader>
                        <SheetTitle>Attach files</SheetTitle>
                        <SheetDescription>File uploads from chat are coming soon.</SheetDescription>
                    </SheetHeader>
                    <div className="px-4 pb-6 text-sm text-muted-foreground">
                        For now, manage files from the room files page.
                    </div>
                </SheetContent>
            </Sheet>
        </form>
    )
}

function ChatSkeleton() {
    return (
        <div className="flex min-h-svh flex-col">
            <div className="flex items-center gap-2 border-b border-border bg-background px-3 py-2.5 sm:px-6">
                <Skeleton className="size-7 rounded-md" />
                <Skeleton className="size-7 rounded-md" />
                <div className="flex flex-col gap-1">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-3.5 w-40" />
                </div>
            </div>
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 sm:px-6">
                <Skeleton className="h-16 w-3/4" />
                <Skeleton className="ml-auto h-12 w-1/2" />
                <Skeleton className="h-20 w-2/3" />
            </div>
        </div>
    )
}

function useStreamingRefetch({
    roomId,
    sessionKey,
    queryClient,
    queryKey,
    onError,
}: {
    roomId: string
    sessionKey: string
    queryClient: ReturnType<typeof useQueryClient>
    queryKey: readonly unknown[]
    onError: (message: string | null) => void
}) {
    useEffect(() => {
        if (typeof EventSource === 'undefined') return

        const url = `/api/rooms/${encodeURIComponent(roomId)}/sessions/${encodeURIComponent(sessionKey)}/events`
        const source = new EventSource(url)
        let timer: ReturnType<typeof setTimeout> | null = null
        let consecutiveErrors = 0

        const scheduleRefetch = () => {
            if (timer) clearTimeout(timer)
            timer = setTimeout(() => {
                void queryClient.invalidateQueries({ queryKey })
            }, 200)
        }

        const onRoomEvent = (_raw: MessageEvent<string>) => {
            consecutiveErrors = 0
            scheduleRefetch()
        }

        const onStreamError = (raw: MessageEvent<string>) => {
            try {
                const event = JSON.parse(raw.data) as { message?: string }
                onError(event.message ?? 'Live updates disconnected')
            } catch {
                onError('Live updates disconnected')
            }
        }

        const onConnectionError = () => {
            consecutiveErrors += 1
            if (consecutiveErrors >= STREAM_ERROR_THRESHOLD) {
                onError('Lost live updates for this room. Refresh to retry.')
                source.close()
            }
        }

        const onOpen = () => {
            consecutiveErrors = 0
            onError(null)
        }

        source.addEventListener('room-event', onRoomEvent as EventListener)
        source.addEventListener('stream-error', onStreamError as EventListener)
        source.addEventListener('error', onConnectionError)
        source.addEventListener('open', onOpen)

        return () => {
            if (timer) clearTimeout(timer)
            source.removeEventListener('room-event', onRoomEvent as EventListener)
            source.removeEventListener('stream-error', onStreamError as EventListener)
            source.removeEventListener('error', onConnectionError)
            source.removeEventListener('open', onOpen)
            source.close()
        }
    }, [roomId, sessionKey, queryClient, queryKey, onError])
}

function dedupeMessages(messages: RoomExecutionMessage[]): RoomExecutionMessage[] {
    const seen = new Set<string>()
    const out: RoomExecutionMessage[] = []
    for (const message of messages) {
        if (seen.has(message.id)) continue
        seen.add(message.id)
        out.push(message)
    }
    return out
}

function isLastMessageInProgress(messages: RoomExecutionMessage[] | undefined): boolean {
    if (!messages || messages.length === 0) return false
    const last = messages[messages.length - 1]!
    if (last.role !== 'assistant') return false
    if (last.id.startsWith('stream-')) return true
    for (const part of last.parts) {
        if (part.type !== 'tool_call') continue
        const status = part.status?.toLowerCase() ?? ''
        if (!status || status.includes('pending') || status.includes('running')) {
            return true
        }
    }
    return false
}

function extractLatestStreamRunId(messages: RoomExecutionMessage[]): string | null {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i]!
        if (message.role === 'assistant' && message.id.startsWith('stream-')) {
            return message.id.slice('stream-'.length)
        }
    }
    return null
}

const TOOL_VERB_TABLE: Array<[RegExp, string]> = [
    [/(read|open|view|get|fetch|cat|inspect)/i, 'Reading'],
    [/(search|grep|find|lookup|query)/i, 'Searching'],
    [/(write|save|persist|create|store)/i, 'Saving'],
    [/(edit|update|patch|modify|replace)/i, 'Editing'],
    [/(delete|remove|rm)/i, 'Removing'],
    [/(upload|attach)/i, 'Uploading'],
    [/(download)/i, 'Downloading'],
    [/(run|exec|shell|bash|cmd|spawn)/i, 'Running'],
    [/(plan|outline|draft|compose|generate)/i, 'Drafting'],
    [/(review|analyze|evaluate)/i, 'Reviewing'],
    [/(send|email|notify|message)/i, 'Sending'],
    [/(schedule|cron|wake)/i, 'Scheduling'],
    [/(browse|web|http|url)/i, 'Browsing'],
    [/(mcp)/i, 'Using a connected tool'],
    [/(file)/i, 'Working with files'],
]

function describeToolStep(part: RoomExecutionMessagePart, index: number): StepDescriptor {
    const tone = stepTone(part)
    return {
        title: friendlyToolTitle(part, index),
        tone,
        summary: stepStatusLabel(tone, part),
    }
}

function friendlyToolTitle(part: RoomExecutionMessagePart, index: number): string {
    const name = part.toolName ?? ''
    if (!name) return `Step ${index + 1}`
    for (const [pattern, verb] of TOOL_VERB_TABLE) {
        if (pattern.test(name)) return verb
    }
    return `Working with ${name}`
}

function stepTone(part: RoomExecutionMessagePart): StepTone {
    const status = part.status?.toLowerCase() ?? ''
    if (status.includes('error') || status.includes('fail')) return 'attention'
    if (status.includes('approval') || status.includes('pending') || status.includes('wait')) {
        return 'attention'
    }
    if (status.includes('done') || status.includes('complete') || status.includes('ok')) {
        return 'ready'
    }
    if (status.includes('running') || status.includes('progress') || status.includes('working')) {
        return 'working'
    }
    if (part.type === 'tool_result') return 'ready'
    if (part.type === 'tool_call') return 'working'
    return 'muted'
}

function stepStatusLabel(tone: StepTone, part: RoomExecutionMessagePart): string {
    const lower = part.status?.toLowerCase() ?? ''
    if (lower.includes('approval') || lower.includes('wait')) return 'Waiting for approval'
    if (tone === 'attention') return 'Needs attention'
    if (tone === 'ready') return 'Done'
    if (tone === 'working') return 'Working'
    return part.status ?? 'Pending'
}

function stepIcon(tone: StepTone) {
    if (tone === 'ready') return CheckIcon
    if (tone === 'working') return LoaderIcon
    if (tone === 'attention') return AlertTriangleIcon
    return ClockIcon
}

interface DetailEntry {
    label: string
    value: string
    tone?: 'muted' | 'danger'
}

function collectDetailEntries(part: RoomExecutionMessagePart): DetailEntry[] {
    const entries: DetailEntry[] = []
    const status = part.status?.toLowerCase() ?? ''
    entries.push({ label: 'Status', value: part.status ?? defaultStatusLabel(part) })
    if (status.includes('error') || status.includes('fail')) {
        const message = errorTextFromPart(part)
        if (message) entries.push({ label: 'What went wrong', value: message, tone: 'danger' })
    }
    const requested = humanReadable(part.input)
    if (requested) entries.push({ label: 'What was requested', value: requested })
    const happened = humanReadable(part.result)
    if (happened) entries.push({ label: 'What happened', value: happened })
    return entries
}

function defaultStatusLabel(part: RoomExecutionMessagePart): string {
    if (part.type === 'tool_call') return 'Running'
    if (part.type === 'tool_result') return 'Completed'
    return 'Unknown'
}

function errorTextFromPart(part: RoomExecutionMessagePart): string | null {
    const result = part.result
    if (typeof result === 'string' && result.trim()) return result.trim()
    if (result && typeof result === 'object' && !Array.isArray(result)) {
        const record = result as Record<string, unknown>
        for (const key of ['error', 'message', 'reason']) {
            const value = record[key]
            if (typeof value === 'string' && value.trim()) return value.trim()
        }
    }
    return part.text || null
}

function humanReadable(value: unknown): string | null {
    if (value === null || value === undefined) return null
    if (typeof value === 'string') return value.trim() || null
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    if (Array.isArray(value)) {
        if (value.length === 0) return null
        if (value.every((entry) => typeof entry === 'string')) return (value as string[]).join('\n')
        return null
    }
    if (typeof value === 'object') {
        const record = value as Record<string, unknown>
        for (const key of ['summary', 'message', 'description', 'content', 'text', 'output']) {
            const entry = record[key]
            if (typeof entry === 'string' && entry.trim()) return entry.trim()
        }
        const pairs = Object.entries(record)
            .filter(([, entry]) => typeof entry === 'string' || typeof entry === 'number')
            .slice(0, 6)
        if (pairs.length === 0) return null
        return pairs.map(([key, entry]) => `${key}: ${entry}`).join('\n')
    }
    return null
}

function renderInlineMarkdown(text: string): ReactNode[] {
    const out: ReactNode[] = []
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i += 1) {
        out.push(<span key={`l${i}`}>{parseInline(lines[i]!, `l${i}`)}</span>)
        if (i < lines.length - 1) out.push(<br key={`b${i}`} />)
    }
    return out
}

function parseInline(input: string, prefix: string): ReactNode[] {
    const out: ReactNode[] = []
    const pattern = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`)/g
    let last = 0
    let idx = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(input)) !== null) {
        if (match.index > last) {
            out.push(<span key={`${prefix}t${idx++}`}>{input.slice(last, match.index)}</span>)
        }
        if (match[2] !== undefined) out.push(<strong key={`${prefix}b${idx++}`}>{match[2]}</strong>)
        else if (match[3] !== undefined) out.push(<em key={`${prefix}i${idx++}`}>{match[3]}</em>)
        else if (match[4] !== undefined)
            out.push(
                <code
                    key={`${prefix}c${idx++}`}
                    className="rounded bg-muted/70 px-1 py-0.5 text-[0.85em]"
                >
                    {match[4]}
                </code>,
            )
        last = match.index + match[0].length
    }
    if (last < input.length) out.push(<span key={`${prefix}r${idx}`}>{input.slice(last)}</span>)
    if (out.length === 0) out.push(<span key={`${prefix}e`}>{input}</span>)
    return out
}
