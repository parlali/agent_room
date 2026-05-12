import { Link, useNavigate } from '@tanstack/react-router'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import { MessageSquareIcon } from 'lucide-react'
import { toast } from 'sonner'

import { AttentionBanner, EmptyState } from '#/components/agent-room'
import { Button } from '#/components/ui/button'
import { describeSessionState } from '#/lib/state'
import { uploadRoomFiles } from '#/lib/room-file-upload'
import { formatMessageWithAttachments } from '#/lib/room-attachments'
import {
    afterNextPaint,
    consumeChatSelection,
    peekChatSelection,
    recordClientPerformance,
} from '#/lib/browser-performance'
import { roomQueryKey, roomQueryPolicy } from '#/lib/room-query-keys'
import {
    abortMessageServer,
    editMessageServer,
    getRoomSessionShellServer,
    getRoomSessionWindowServer,
    renameSessionServer,
    sendMessageServer,
    updateThreadModelServer,
} from '#/routes/-room-runtime-server'
import type {
    RoomExecutionMessage,
    RoomRealtimeEvent,
    RoomSidebarSnapshot,
    RoomSessionDisplayRow,
    RoomSessionArtifact,
    RoomSessionShellSnapshot,
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
import {
    addOptimisticUserMessage,
    editOptimisticUserMessage,
    rollbackOptimisticWindow,
    type OptimisticWindowRollback,
} from './chat-projection-store'

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
const artifactPanelStateCache = new Map<string, SessionArtifactPanelState>()

export function SessionChatPane({ roomId, sessionKey }: { roomId: string; sessionKey: string }) {
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const [draft, setDraft] = useState('')
    const [streamError, setStreamError] = useState<string | null>(null)
    const [streamTurn, setStreamTurn] = useState<StreamTurnState>(emptyStreamTurnState)
    const [attachments, setAttachments] = useState<ComposerAttachment[]>([])
    const [editingMessage, setEditingMessage] = useState<EditingMessageDraft | null>(null)
    const [artifactStateBySession, setArtifactStateBySession] = useState<
        Map<string, SessionArtifactPanelState>
    >(() => new Map(artifactPanelStateCache))
    const artifactStateKey = useMemo(
        () => sessionArtifactStateKey(roomId, sessionKey),
        [roomId, sessionKey],
    )
    const shellPaintLoggedRef = useRef<string | null>(null)
    const latestPaintLoggedRef = useRef<string | null>(null)
    const queryKey = useMemo(
        () => roomQueryKey.sessionShell(roomId, sessionKey),
        [roomId, sessionKey],
    )
    const windowQueryKey = useMemo(
        () => roomQueryKey.sessionWindow(roomId, sessionKey),
        [roomId, sessionKey],
    )

    const executionQuery = useQuery<RoomSessionShellSnapshot>({
        queryKey,
        queryFn: () =>
            getRoomSessionShellServer({
                data: {
                    roomId,
                    sessionKey,
                },
            }),
        placeholderData: () => {
            const sidebar = queryClient.getQueryData<RoomSidebarSnapshot>(
                roomQueryKey.roomSidebar(roomId),
            )
            const selectedThread =
                sidebar?.threads.find((thread) => thread.key === sessionKey) ?? null
            if (!sidebar || !selectedThread) return undefined
            return {
                room: sidebar.room,
                executionState: sidebar.executionState,
                executionMessage: sidebar.executionMessage,
                capabilities: {
                    canStreamTokens: true,
                    canStreamToolEvents: true,
                    canAbortGeneration: true,
                    canEditMessages: false,
                    editMessageUnsupportedReason: 'Session details are still loading',
                },
                roomAgent: null,
                threads: sidebar.threads,
                selectedThreadKey: sessionKey,
                selectedThread,
                selectedThreadModel: null,
                recentActivity: sidebar.recentActivity,
            }
        },
        staleTime: roomQueryPolicy.hotStaleMs,
        gcTime: roomQueryPolicy.retainedSessionMs,
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
        staleTime: roomQueryPolicy.warmStaleMs,
        gcTime: roomQueryPolicy.retainedSessionMs,
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
    const selectedThread = snapshot?.selectedThread ?? null
    const artifactState =
        artifactStateBySession.get(artifactStateKey) ?? defaultArtifactPanelState()
    const artifactsOpen = showArtifacts && artifactState.open
    const updateArtifactState = useCallback(
        (targetKey: string, patch: Partial<SessionArtifactPanelState>) => {
            setArtifactStateBySession((current) => {
                const next = new Map(current)
                next.set(targetKey, {
                    ...defaultArtifactPanelState(),
                    ...next.get(targetKey),
                    ...patch,
                })
                artifactPanelStateCache.set(targetKey, next.get(targetKey)!)
                return next
            })
        },
        [],
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
    const loadingInitialRows = windowQuery.isLoading && rows.length === 0

    useEffect(() => {
        setStreamTurn(emptyStreamTurnState)
        setAttachments([])
        setEditingMessage(null)
        shellPaintLoggedRef.current = null
        latestPaintLoggedRef.current = null
    }, [sessionKey])

    useEffect(() => {
        if (!showArtifacts) return
        if (artifacts.length === 0) return
        if (artifactState.autoOpened) return
        let cancelled = false
        const timeout = window.setTimeout(() => {
            void loadSessionArtifactsPanel().finally(() => {
                if (cancelled) return
                updateArtifactState(artifactStateKey, {
                    open: true,
                    loaded: true,
                    autoOpened: true,
                })
            })
        }, artifactsAutoOpenDelayMs)
        return () => {
            cancelled = true
            window.clearTimeout(timeout)
        }
    }, [
        artifactState.autoOpened,
        artifactStateKey,
        artifacts.length,
        showArtifacts,
        updateArtifactState,
    ])

    useEffect(() => {
        if (!room || !selectedThread) return
        if (shellPaintLoggedRef.current === sessionKey) return
        shellPaintLoggedRef.current = sessionKey
        const startedAt = peekChatSelection(roomId, sessionKey) ?? performance.now()
        return afterNextPaint(() => {
            recordClientPerformance({
                name: 'chat.selection.shell_paint',
                roomId,
                sessionKey,
                durationMs: performance.now() - startedAt,
            })
        })
    }, [room, roomId, selectedThread, sessionKey])

    useEffect(() => {
        if (latestPaintLoggedRef.current === sessionKey) return
        if (loadingInitialRows || rows.length === 0) return
        latestPaintLoggedRef.current = sessionKey
        const startedAt = consumeChatSelection(roomId, sessionKey) ?? performance.now()
        return afterNextPaint(() => {
            recordClientPerformance({
                name: 'chat.selection.latest_message_paint',
                roomId,
                sessionKey,
                rowCount: rows.length,
                totalRows,
                durationMs: performance.now() - startedAt,
            })
        })
    }, [loadingInitialRows, roomId, rows.length, sessionKey, totalRows])

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
                event.event === 'thread.model_changed' ||
                event.event === 'room.files.changed' ||
                event.event === 'run.finished' ||
                event.event === 'agent_end'
            ) {
                void queryClient.invalidateQueries({ queryKey })
                void queryClient.invalidateQueries({ queryKey: windowQueryKey })
                void queryClient.invalidateQueries({ queryKey: roomQueryKey.roomSidebar(roomId) })
                void queryClient.invalidateQueries({ queryKey: roomQueryKey.roomsList })
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
        onMutate: async (message): Promise<OptimisticWindowRollback> => {
            return addOptimisticUserMessage({
                queryClient,
                roomId,
                sessionKey,
                message,
                timestamp: Date.now(),
            })
        },
        onSuccess: () => {
            setDraft('')
            setAttachments([])
            void queryClient.invalidateQueries({ queryKey })
            void queryClient.invalidateQueries({ queryKey: windowQueryKey })
            void queryClient.invalidateQueries({ queryKey: roomQueryKey.roomSidebar(roomId) })
        },
        onError: (error, message, rollback) => {
            rollbackOptimisticWindow({
                queryClient,
                roomId,
                sessionKey,
                rollback,
            })
            setDraft(message)
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
        onMutate: async (input): Promise<OptimisticWindowRollback> => {
            return editOptimisticUserMessage({
                queryClient,
                roomId,
                sessionKey,
                messageId: input.messageId,
                message: input.message,
            })
        },
        onSuccess: () => {
            setEditingMessage(null)
            void queryClient.invalidateQueries({ queryKey })
            void queryClient.invalidateQueries({ queryKey: windowQueryKey })
            void queryClient.invalidateQueries({ queryKey: roomQueryKey.roomSidebar(roomId) })
        },
        onError: (error, _input, rollback) => {
            rollbackOptimisticWindow({
                queryClient,
                roomId,
                sessionKey,
                rollback,
            })
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
            await queryClient.invalidateQueries({ queryKey: roomQueryKey.roomSidebar(roomId) })
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
            void queryClient.invalidateQueries({ queryKey: roomQueryKey.roomFiles(roomId) })
            void queryClient.invalidateQueries({ queryKey: roomQueryKey.roomFileTree(roomId) })
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
            void queryClient.invalidateQueries({ queryKey: roomQueryKey.roomSidebar(roomId) })
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
                queryClient.invalidateQueries({ queryKey: roomQueryKey.roomSidebar(roomId) }),
                queryClient.invalidateQueries({ queryKey: roomQueryKey.roomsList }),
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
                onToggleArtifacts={() =>
                    updateArtifactState(artifactStateKey, {
                        open: !artifactState.open,
                        loaded: true,
                    })
                }
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
                {showArtifacts ? (
                    <SessionArtifactsShell
                        roomId={roomId}
                        sessionKey={sessionKey}
                        artifacts={artifacts}
                        state={artifactState}
                        open={artifactsOpen}
                        onChangeState={(patch) => updateArtifactState(artifactStateKey, patch)}
                    />
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

interface SessionArtifactPanelState {
    open: boolean
    loaded: boolean
    autoOpened: boolean
    selectedArtifactId: string | null
    width: number
}

function defaultArtifactPanelState(): SessionArtifactPanelState {
    return {
        open: false,
        loaded: false,
        autoOpened: false,
        selectedArtifactId: null,
        width: 384,
    }
}

function sessionArtifactStateKey(roomId: string, sessionKey: string): string {
    return `${roomId}:${sessionKey}`
}

function SessionArtifactsShell({
    roomId,
    sessionKey,
    artifacts,
    state,
    open,
    onChangeState,
}: {
    roomId: string
    sessionKey: string
    artifacts: RoomSessionArtifact[]
    state: SessionArtifactPanelState
    open: boolean
    onChangeState: (patch: Partial<SessionArtifactPanelState>) => void
}) {
    const mountedLoggedRef = useRef(false)
    const openStartedAtRef = useRef<number | null>(null)
    const shouldLoad = state.loaded || open || artifacts.length > 0

    useEffect(() => {
        if (!shouldLoad || mountedLoggedRef.current) return
        mountedLoggedRef.current = true
        recordClientPerformance({
            name: 'artifact.panel.mount',
            roomId,
            sessionKey,
            rowCount: artifacts.length,
        })
    }, [artifacts.length, roomId, sessionKey, shouldLoad])

    useEffect(() => {
        if (!open) {
            openStartedAtRef.current = null
            return
        }
        openStartedAtRef.current = performance.now()
        return afterNextPaint(() => {
            recordClientPerformance({
                name: 'artifact.panel.open',
                roomId,
                sessionKey,
                rowCount: artifacts.length,
                durationMs: openStartedAtRef.current
                    ? performance.now() - openStartedAtRef.current
                    : null,
            })
        })
    }, [artifacts.length, open, roomId, sessionKey])

    const onDesktopResizeStart = (event: ReactMouseEvent<HTMLButtonElement>) => {
        event.preventDefault()
        const startX = event.clientX
        const startWidth = state.width
        const onMove = (moveEvent: MouseEvent) => {
            const nextWidth = Math.min(
                560,
                Math.max(320, startWidth - (moveEvent.clientX - startX)),
            )
            onChangeState({ width: nextWidth })
        }
        const onUp = () => {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp, { once: true })
    }

    return (
        <>
            <div
                className="hidden shrink-0 overflow-hidden border-l border-border/60 transition-[width] duration-200 ease-out xl:block"
                style={{ width: open ? state.width : 0 }}
                aria-hidden={!open}
            >
                <div className="relative h-full" style={{ width: state.width }}>
                    <button
                        type="button"
                        className="absolute inset-y-0 left-0 z-10 w-1 cursor-col-resize bg-transparent hover:bg-border"
                        aria-label="Resize artifacts"
                        onMouseDown={onDesktopResizeStart}
                    />
                    {shouldLoad ? (
                        <Suspense fallback={null}>
                            <SessionArtifactsPanel
                                roomId={roomId}
                                artifacts={artifacts}
                                selectedArtifactId={state.selectedArtifactId}
                                onSelectArtifact={(selectedArtifactId) =>
                                    onChangeState({ selectedArtifactId })
                                }
                                onClose={() => onChangeState({ open: false })}
                                className="h-full pl-1"
                            />
                        </Suspense>
                    ) : null}
                </div>
            </div>
            <div
                className={`absolute inset-y-0 right-0 z-20 w-full max-w-md transform border-l border-border/60 shadow-xl transition-transform duration-200 ease-out xl:hidden ${open ? 'translate-x-0' : 'translate-x-full'}`}
                aria-hidden={!open}
            >
                {shouldLoad ? (
                    <Suspense fallback={null}>
                        <SessionArtifactsPanel
                            roomId={roomId}
                            artifacts={artifacts}
                            selectedArtifactId={state.selectedArtifactId}
                            onSelectArtifact={(selectedArtifactId) =>
                                onChangeState({ selectedArtifactId })
                            }
                            onClose={() => onChangeState({ open: false })}
                        />
                    </Suspense>
                ) : null}
            </div>
        </>
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
