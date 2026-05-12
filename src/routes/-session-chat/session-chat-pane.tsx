import { Link, useNavigate } from '@tanstack/react-router'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { MessageSquareIcon } from 'lucide-react'
import { toast } from 'sonner'

import { AttentionBanner, EmptyState } from '#/components/agent-room'
import { Button } from '#/components/ui/button'
import { describeSessionState } from '#/lib/state'
import { uploadRoomFiles } from '#/lib/room-file-upload'
import { formatMessageWithAttachments } from '#/lib/room-attachments'
import {
    abortMessageServer,
    editMessageServer,
    getRoomExecutionServer,
    getRoomSessionWindowServer,
    renameSessionServer,
    sendMessageServer,
    updateThreadModelServer,
} from '#/routes/-room-runtime-server'
import type {
    RoomExecutionMessage,
    RoomExecutionSnapshot,
    RoomRealtimeEvent,
    RoomSessionDisplayRow,
} from '#/lib/room-execution-types'

import { ChatHeader } from './chat-header'
import { ChatSkeleton } from './chat-skeleton'
import { Composer, type ComposerAttachment } from './composer'
import type { ModelModeChange } from './model-mode-menu'
import { isLastMessageInProgress } from './conversation-utils'
import {
    emptyStreamTurnState,
    reduceRoomStreamEvent,
    shouldRefetchForRoomEvent,
    streamTurnHasContent,
    type StreamTurnState,
} from './stream-state'
import { MessageList } from './message-list'
import type { EditingMessageDraft } from '#/lib/message-list-model'
import { useStreamingRefetch } from './streaming'

const loadSessionArtifactsPanel = () => import('./session-artifacts-panel')

const SessionArtifactsPanel = lazy(() =>
    loadSessionArtifactsPanel().then((module) => ({
        default: module.SessionArtifactsPanel,
    })),
)

const initialSessionRowLimit = 8
const olderSessionRowLimit = 24
const backgroundOlderRowsDelayMs = 900
const artifactsAutoOpenDelayMs = 1300

export function SessionChatPane({ roomId, sessionKey }: { roomId: string; sessionKey: string }) {
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const [draft, setDraft] = useState('')
    const [streamError, setStreamError] = useState<string | null>(null)
    const [streamTurn, setStreamTurn] = useState<StreamTurnState>(emptyStreamTurnState)
    const [attachments, setAttachments] = useState<ComposerAttachment[]>([])
    const [editingMessage, setEditingMessage] = useState<EditingMessageDraft | null>(null)
    const [artifactsOpen, setArtifactsOpen] = useState(false)
    const [autoOpenedArtifactsSession, setAutoOpenedArtifactsSession] = useState<string | null>(
        null,
    )
    const queryKey = useMemo(
        () => ['room-execution', roomId, sessionKey] as const,
        [roomId, sessionKey],
    )
    const windowQueryKey = useMemo(
        () => ['room-session-window', roomId, sessionKey] as const,
        [roomId, sessionKey],
    )

    const executionQuery = useQuery<RoomExecutionSnapshot>({
        queryKey,
        queryFn: () =>
            getRoomExecutionServer({
                data: {
                    roomId,
                    selectedThreadKey: sessionKey,
                    messageLimit: 0,
                },
            }),
        placeholderData: () =>
            queryClient.getQueryData<RoomExecutionSnapshot>(['room-execution', roomId]) ??
            queryClient.getQueryData<RoomExecutionSnapshot>(['room-execution', roomId, 'sidebar']),
        staleTime: 10_000,
    })
    const windowQuery = useInfiniteQuery({
        queryKey: windowQueryKey,
        initialPageParam: null as string | null,
        queryFn: ({ pageParam }) =>
            getRoomSessionWindowServer({
                data: {
                    roomId,
                    sessionKey,
                    before: pageParam,
                    limitRows: pageParam ? olderSessionRowLimit : initialSessionRowLimit,
                },
            }),
        getNextPageParam: (lastPage) => lastPage.beforeCursor ?? undefined,
        staleTime: 30_000,
    })

    const snapshot = executionQuery.data
    const room = snapshot?.room ?? null
    const rows = useMemo(
        () => [...(windowQuery.data?.pages ?? [])].reverse().flatMap((page) => page.rows),
        [windowQuery.data?.pages],
    )
    const messages = useMemo(() => messagesFromRows(rows), [rows])
    const artifacts = windowQuery.data?.pages[0]?.artifacts ?? []
    const totalRows = windowQuery.data?.pages[0]?.totalRows ?? rows.length
    const showArtifacts = room?.roomMode !== 'programmer'
    const selectedThread = useMemo(
        () => snapshot?.threads.find((thread) => thread.key === sessionKey) ?? null,
        [snapshot?.threads, sessionKey],
    )
    const sessionTone = describeSessionState(selectedThread?.status ?? null)
    const streamActive =
        !streamTurn.finished &&
        (streamTurn.status === 'queued' ||
            streamTurn.status === 'thinking' ||
            streamTurn.status === 'working' ||
            streamTurn.status === 'responding')
    const isWorking =
        streamActive || sessionTone.tone === 'working' || isLastMessageInProgress(messages)
    const activeRunId = streamTurn.runId
    const streamPersisted = streamTurnPersisted(streamTurn, messages)
    const visibleStreamTurn = streamPersisted ? emptyStreamTurnState : streamTurn

    useEffect(() => {
        setStreamTurn(emptyStreamTurnState)
        setAttachments([])
        setEditingMessage(null)
        setArtifactsOpen(false)
        setAutoOpenedArtifactsSession(null)
    }, [sessionKey])

    useEffect(() => {
        if (!showArtifacts) return
        if (artifacts.length === 0) return
        if (autoOpenedArtifactsSession === sessionKey) return
        let cancelled = false
        const timeout = window.setTimeout(() => {
            void loadSessionArtifactsPanel().finally(() => {
                if (cancelled) return
                setArtifactsOpen(true)
                setAutoOpenedArtifactsSession(sessionKey)
            })
        }, artifactsAutoOpenDelayMs)
        return () => {
            cancelled = true
            window.clearTimeout(timeout)
        }
    }, [artifacts.length, autoOpenedArtifactsSession, sessionKey, showArtifacts])

    useEffect(() => {
        if (windowQuery.isLoading) return
        if (windowQuery.isFetchingNextPage) return
        if (!windowQuery.hasNextPage) return
        if ((windowQuery.data?.pages.length ?? 0) !== 1) return
        const timeout = window.setTimeout(() => {
            void windowQuery.fetchNextPage()
        }, backgroundOlderRowsDelayMs)
        return () => window.clearTimeout(timeout)
    }, [
        sessionKey,
        windowQuery.data?.pages.length,
        windowQuery.hasNextPage,
        windowQuery.isFetchingNextPage,
        windowQuery.isLoading,
        windowQuery.fetchNextPage,
    ])

    useEffect(() => {
        if (streamPersisted) {
            setStreamTurn(emptyStreamTurnState)
            return
        }
        if (
            !streamTurn.finished ||
            executionQuery.isFetching ||
            !streamTurnHasContent(streamTurn)
        ) {
            return
        }
        const timer = setTimeout(() => {
            setStreamTurn(emptyStreamTurnState)
        }, 1500)
        return () => clearTimeout(timer)
    }, [streamTurn, streamPersisted, executionQuery.isFetching])

    const onRealtimeEvent = useCallback(
        (event: RoomRealtimeEvent) => {
            setStreamTurn((current) => reduceRoomStreamEvent(current, event))
            if (
                event.event === 'thread.renamed' ||
                event.event === 'thread.title_generated' ||
                event.event === 'run.accepted' ||
                event.event === 'run.finished' ||
                event.event === 'agent_end'
            ) {
                void queryClient.invalidateQueries({ queryKey })
                queryClient.removeQueries({ queryKey: windowQueryKey })
                void queryClient.invalidateQueries({ queryKey: ['room-execution', roomId] })
                void queryClient.invalidateQueries({
                    queryKey: ['room-execution', roomId, 'sidebar'],
                })
            }
        },
        [queryClient, queryKey, roomId, windowQueryKey],
    )

    useStreamingRefetch({
        roomId,
        sessionKey,
        queryClient,
        queryKey,
        onError: setStreamError,
        onEvent: onRealtimeEvent,
        shouldRefetch: shouldRefetchForRoomEvent,
    })

    const sendMutation = useMutation({
        mutationFn: (message: string) =>
            sendMessageServer({ data: { roomId, sessionKey, message } }),
        onSuccess: () => {
            setDraft('')
            setAttachments([])
            void queryClient.invalidateQueries({ queryKey })
            queryClient.removeQueries({ queryKey: windowQueryKey })
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : 'Message could not be sent')
        },
    })

    const editMutation = useMutation({
        mutationFn: (input: { messageId: string; message: string }) =>
            editMessageServer({
                data: {
                    roomId,
                    sessionKey,
                    messageId: input.messageId,
                    message: input.message,
                },
            }),
        onSuccess: () => {
            setEditingMessage(null)
            void queryClient.invalidateQueries({ queryKey })
            queryClient.removeQueries({ queryKey: windowQueryKey })
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : 'Message could not be edited')
        },
    })

    const modelMutation = useMutation({
        mutationFn: (input: ModelModeChange) =>
            updateThreadModelServer({
                data: {
                    roomId,
                    sessionKey,
                    provider: input.provider,
                    model: input.model,
                    thinkingLevel: input.thinkingLevel,
                },
            }),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey })
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : 'Model could not be changed')
        },
    })

    const attachmentMutation = useMutation({
        mutationFn: (files: File[]) =>
            uploadRoomFiles({
                roomId,
                files,
                sessionKey,
            }),
        onSuccess: (result) => {
            setAttachments((current) => [
                ...current,
                ...result.files.map((file) => ({
                    id: `${file.surface}:${file.relativePath}`,
                    name: file.name,
                    surface: file.surface,
                    relativePath: file.relativePath,
                    byteLength: file.byteLength,
                    sizeLabel: null,
                })),
            ])
            void queryClient.invalidateQueries({ queryKey: ['room-files', roomId] })
            void queryClient.invalidateQueries({ queryKey: ['room-file-tree', roomId] })
            toast.success(
                result.files.length === 1
                    ? `Attached ${result.files[0]!.name}`
                    : `Attached ${result.files.length} files`,
            )
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : 'File could not be attached')
        },
    })

    const abortMutation = useMutation({
        mutationFn: () =>
            abortMessageServer({
                data: { roomId, sessionKey, runId: activeRunId ?? null },
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

    const renameMutation = useMutation({
        mutationFn: (title: string) => renameSessionServer({ data: { roomId, sessionKey, title } }),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey }),
                queryClient.invalidateQueries({ queryKey: ['room-execution', roomId] }),
                queryClient.invalidateQueries({ queryKey: ['room-execution', roomId, 'sidebar'] }),
            ])
            toast.success('Session renamed')
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : 'Session could not be renamed')
        },
    })

    const sending = sendMutation.isPending || editMutation.isPending

    const submitDraft = () => {
        if (sending) return
        const value = draft.trim()
        if (!value && attachments.length === 0) return
        setStreamTurn(emptyStreamTurnState)
        const message = formatMessageWithAttachments(value, attachments)
        sendMutation.mutate(message)
    }

    const submitEditedMessage = () => {
        if (sending || !editingMessage) return
        const value = editingMessage.text.trim()
        if (!value && editingMessage.attachments.length === 0) return
        setStreamTurn(emptyStreamTurnState)
        editMutation.mutate({
            messageId: editingMessage.id,
            message: formatMessageWithAttachments(value, editingMessage.attachments),
        })
    }

    const startEditingMessage = (input: EditingMessageDraft) => {
        if (!(snapshot?.capabilities.canEditMessages ?? false)) {
            toast.error(
                snapshot?.capabilities.editMessageUnsupportedReason ?? 'Editing is unavailable',
            )
            return
        }
        setEditingMessage({
            id: input.id,
            text: input.text,
            timestamp: input.timestamp,
            attachments: input.attachments,
        })
    }

    const cancelEditingMessage = () => {
        setEditingMessage(null)
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

    const loadingInitialRows = windowQuery.isLoading && rows.length === 0

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
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
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
                showArtifacts={showArtifacts}
                artifactsCount={artifacts.length}
                artifactsOpen={artifactsOpen}
                onToggleArtifacts={() => setArtifactsOpen((open) => !open)}
                onBack={() => {
                    void navigate({ to: '/rooms/$roomId', params: { roomId } })
                }}
                onRename={(title) => renameMutation.mutateAsync(title)}
                renaming={renameMutation.isPending}
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
            <div className="relative flex min-h-0 flex-1 overflow-hidden">
                <MessageList
                    sessionKey={sessionKey}
                    room={room}
                    rows={rows}
                    totalRows={totalRows}
                    stream={visibleStreamTurn}
                    isWorking={isWorking}
                    loadingInitialRows={loadingInitialRows}
                    hasOlderRows={windowQuery.hasNextPage}
                    loadingOlderRows={windowQuery.isFetchingNextPage}
                    onLoadOlderRows={() => {
                        if (windowQuery.hasNextPage && !windowQuery.isFetchingNextPage) {
                            void windowQuery.fetchNextPage()
                        }
                    }}
                    canEditMessages={
                        (snapshot?.capabilities.canEditMessages ?? false) && !isWorking && !sending
                    }
                    editingMessage={editingMessage}
                    editPending={editMutation.isPending}
                    onEditMessage={startEditingMessage}
                    onChangeEditingMessageText={(text) =>
                        setEditingMessage((current) => (current ? { ...current, text } : current))
                    }
                    onSubmitEditingMessage={submitEditedMessage}
                    onCancelEditingMessage={cancelEditingMessage}
                />
                {showArtifacts && artifactsOpen ? (
                    <Suspense fallback={null}>
                        <SessionArtifactsPanel
                            roomId={roomId}
                            artifacts={artifacts}
                            onClose={() => setArtifactsOpen(false)}
                            className="hidden w-[24rem] shrink-0 border-l border-border/60 xl:flex"
                        />
                        <div className="absolute inset-y-0 right-0 z-20 w-full max-w-md border-l border-border/60 shadow-xl xl:hidden">
                            <SessionArtifactsPanel
                                roomId={roomId}
                                artifacts={artifacts}
                                onClose={() => setArtifactsOpen(false)}
                            />
                        </div>
                    </Suspense>
                ) : null}
            </div>
            <Composer
                roomId={roomId}
                roomDisplayName={room.displayName}
                draft={draft}
                onChangeDraft={setDraft}
                onSubmit={onSubmit}
                onKeyDown={onComposerKeyDown}
                sending={sending}
                stopping={abortMutation.isPending}
                canStop={isWorking && (snapshot?.capabilities.canAbortGeneration ?? true)}
                onStop={() => abortMutation.mutate()}
                attachments={attachments}
                attaching={attachmentMutation.isPending}
                onAttachFiles={(files) => attachmentMutation.mutate(Array.from(files))}
                onRemoveAttachment={(id) =>
                    setAttachments((current) =>
                        current.filter((attachment) => attachment.id !== id),
                    )
                }
                modelState={snapshot?.selectedThreadModel ?? null}
                modelUpdating={modelMutation.isPending}
                onChangeModel={(change) => modelMutation.mutate(change)}
            />
        </div>
    )
}

function streamTurnPersisted(
    streamTurn: StreamTurnState,
    messages: RoomExecutionMessage[],
): boolean {
    const assistantTexts = streamTurn.items
        .filter((item) => item.type === 'assistant')
        .map((item) => item.markdown.trim())
        .filter((text) => text.length > 0)
    if (assistantTexts.length === 0) return false

    const persistedTexts = messages
        .filter((message) => message.role === 'assistant')
        .map((message) => message.text.trim())
        .filter((text) => text.length > 0)

    return assistantTexts.every((text) =>
        persistedTexts.some((persisted) => persisted === text || persisted.endsWith(text)),
    )
}

function messagesFromRows(rows: RoomSessionDisplayRow[]): RoomExecutionMessage[] {
    return rows
        .filter(
            (row): row is Extract<RoomSessionDisplayRow, { type: 'message' }> =>
                row.type === 'message',
        )
        .map((row) => row.message)
}
