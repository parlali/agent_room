import { Link, useNavigate } from '@tanstack/react-router'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import { ExternalLinkIcon, MessageSquareIcon, MonitorIcon, XIcon } from 'lucide-react'
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
    ChatTimelineRow,
    RoomExecutionActivity,
    RoomBrowserSessionSnapshot,
    RoomExecutionMessage,
    RoomExecutionThread,
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
    stopStreamTurn,
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
import { cacheStreamTurn, readCachedStreamTurn, sessionStreamStateKey } from './stream-turn-cache'
import { rowContainsMessage } from '#/lib/message-list-model'

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
    const [attachments, setAttachments] = useState<ComposerAttachment[]>([])
    const [editingMessage, setEditingMessage] = useState<EditingMessageDraft | null>(null)
    const [artifactStateBySession, setArtifactStateBySession] = useState<
        Map<string, SessionArtifactPanelState>
    >(() => new Map(artifactPanelStateCache))
    const artifactStateKey = useMemo(
        () => sessionArtifactStateKey(roomId, sessionKey),
        [roomId, sessionKey],
    )
    const streamStateKey = useMemo(
        () => sessionStreamStateKey(roomId, sessionKey),
        [roomId, sessionKey],
    )
    const [streamTurn, setStreamTurn] = useState<StreamTurnState>(() =>
        readCachedStreamTurn(streamStateKey),
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
    const updateStreamTurn = useCallback(
        (nextState: StreamTurnState | ((current: StreamTurnState) => StreamTurnState)) => {
            setStreamTurn((current) => {
                const next = typeof nextState === 'function' ? nextState(current) : nextState
                cacheStreamTurn(streamStateKey, next)
                return next
            })
        },
        [streamStateKey],
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
                browserSession: null,
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
    const browserSession = snapshot?.browserSession ?? null
    const browserSessionAvailable =
        Boolean(browserSession && browserSession.status !== 'closed') &&
        (!browserSession?.sessionKey || browserSession.sessionKey === sessionKey)
    const browserSessionPanelKey = browserSession
        ? [
              browserSession.sessionKey ?? '__room__',
              browserSession.sessionId ?? '__pending__',
              String(browserSession.openedAt),
          ].join(':')
        : null
    const [closedBrowserPanelKey, setClosedBrowserPanelKey] = useState<string | null>(null)
    const browserSessionOpen =
        browserSessionAvailable && browserSessionPanelKey !== closedBrowserPanelKey
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
    const activeRunId = streamActive ? streamTurn.runId : null
    const streamPersisted = streamTurnPersisted(streamTurn, rows)
    const visibleStreamTurn = streamPersisted ? emptyStreamTurnState : streamTurn
    const loadingInitialRows = windowQuery.isLoading && rows.length === 0

    const settleStoppedRun = useCallback(
        (stoppedAt: number) => {
            updateStreamTurn((current) => stopStreamTurn(current, stoppedAt))
            queryClient.setQueryData<RoomSessionShellSnapshot>(queryKey, (current) =>
                current ? stopSessionInShell(current, sessionKey, stoppedAt) : current,
            )
            queryClient.setQueryData<RoomSidebarSnapshot>(
                roomQueryKey.roomSidebar(roomId),
                (current) =>
                    current ? stopSessionInSidebar(current, sessionKey, stoppedAt) : current,
            )
        },
        [queryClient, queryKey, roomId, sessionKey, updateStreamTurn],
    )

    useEffect(() => {
        setStreamTurn(readCachedStreamTurn(streamStateKey))
        setAttachments([])
        setEditingMessage(null)
        shellPaintLoggedRef.current = null
        latestPaintLoggedRef.current = null
    }, [streamStateKey])

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
            updateStreamTurn(emptyStreamTurnState)
            return
        }
        if (!streamTurn.finished || executionQuery.isFetching || streamTurn.rows.length === 0) {
            return
        }
        const clearDelayMs = streamTurnHasContent(streamTurn) ? 1500 : 0
        const timer = setTimeout(() => {
            updateStreamTurn(emptyStreamTurnState)
        }, clearDelayMs)
        return () => clearTimeout(timer)
    }, [streamTurn, streamPersisted, executionQuery.isFetching, updateStreamTurn])

    const onRealtimeEvent = useCallback(
        (event: RoomRealtimeEvent) => {
            updateStreamTurn((current) => reduceRoomStreamEvent(current, event))
            if (
                event.event === 'thread.renamed' ||
                event.event === 'thread.title_generated' ||
                event.event === 'thread.model_changed' ||
                event.event === 'thread.message_edited' ||
                event.event === 'thread.pending_messages_changed' ||
                event.event === 'room.files.changed' ||
                event.event === 'browser.session_changed' ||
                event.event === 'run.accepted' ||
                event.event === 'run.error' ||
                event.event === 'run.finished' ||
                event.event === 'agent_end'
            ) {
                void queryClient.invalidateQueries({ queryKey })
                void queryClient.invalidateQueries({ queryKey: windowQueryKey })
                void queryClient.invalidateQueries({ queryKey: roomQueryKey.roomSidebar(roomId) })
                void queryClient.invalidateQueries({ queryKey: roomQueryKey.roomsList })
            }
        },
        [queryClient, queryKey, roomId, updateStreamTurn, windowQueryKey],
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
            const stoppedAt = Date.now()
            if (result.status === 'aborted' || result.status === 'no-active-run') {
                settleStoppedRun(stoppedAt)
            }
            if (result.status === 'aborted' || result.abortedRunId) {
                toast.success('Stopped this run')
            } else if (result.status === 'run-mismatch') {
                toast.message('Active run changed; refreshing')
            } else {
                toast.message('No active run to stop')
            }
            void queryClient.invalidateQueries({ queryKey })
            void queryClient.invalidateQueries({ queryKey: windowQueryKey })
            void queryClient.invalidateQueries({ queryKey: roomQueryKey.roomSidebar(roomId) })
            void queryClient.invalidateQueries({ queryKey: roomQueryKey.roomsList })
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
        updateStreamTurn(emptyStreamTurnState)
        const message = formatMessageWithAttachments(value, attachments)
        sendMutation.mutate(message)
    }

    const submitEditedMessage = () => {
        if (sending || !editingMessage) return
        const value = editingMessage.text.trim()
        if (!value && editingMessage.attachments.length === 0) return
        updateStreamTurn(emptyStreamTurnState)
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
                showBrowserSession={browserSessionAvailable}
                browserSessionOpen={browserSessionOpen}
                onToggleArtifacts={() =>
                    updateArtifactState(artifactStateKey, {
                        open: !artifactState.open,
                        loaded: true,
                    })
                }
                onToggleBrowserSession={() => {
                    setClosedBrowserPanelKey(browserSessionOpen ? browserSessionPanelKey : null)
                }}
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
                    key={`${roomId}:${sessionKey}`}
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
                {browserSessionAvailable && browserSession ? (
                    <BrowserSessionShell
                        browserSession={browserSession}
                        open={browserSessionOpen}
                        onClose={() => setClosedBrowserPanelKey(browserSessionPanelKey)}
                    />
                ) : null}
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

function BrowserSessionShell({
    browserSession,
    open,
    onClose,
}: {
    browserSession: RoomBrowserSessionSnapshot
    open: boolean
    onClose: () => void
}) {
    const title = browserSession.pageTitle?.trim() || 'Browser'
    const urlLabel = browserSession.pageUrl ? formatBrowserUrl(browserSession.pageUrl) : null
    const budget = browserSession.actionBudget
    const canFrame = browserSession.status === 'open' && browserSession.liveUrl

    return (
        <>
            <aside
                className="hidden shrink-0 overflow-hidden border-l border-border/60 bg-background transition-[width] duration-200 ease-out xl:flex xl:flex-col"
                style={{ width: open ? '28rem' : 0 }}
                aria-hidden={!open}
            >
                <BrowserSessionHeader
                    title={title}
                    urlLabel={urlLabel}
                    browserSession={browserSession}
                    budget={budget}
                />
                <BrowserSessionFrame browserSession={browserSession} canFrame={Boolean(canFrame)} />
            </aside>
            <aside
                className={`absolute inset-y-0 right-0 z-20 flex w-full max-w-lg transform flex-col overflow-hidden border-l border-border/60 bg-background shadow-xl transition-transform duration-200 ease-out xl:hidden ${open ? 'translate-x-0' : 'pointer-events-none translate-x-full'}`}
                aria-hidden={!open}
            >
                <BrowserSessionHeader
                    title={title}
                    urlLabel={urlLabel}
                    browserSession={browserSession}
                    budget={budget}
                    onClose={onClose}
                />
                <BrowserSessionFrame browserSession={browserSession} canFrame={Boolean(canFrame)} />
            </aside>
        </>
    )
}

function BrowserSessionHeader({
    title,
    urlLabel,
    browserSession,
    budget,
    onClose,
}: {
    title: string
    urlLabel: string | null
    browserSession: RoomBrowserSessionSnapshot
    budget: RoomBrowserSessionSnapshot['actionBudget']
    onClose?: () => void
}) {
    return (
        <div className="flex min-h-14 items-center gap-3 border-b border-border/60 px-3 py-2">
            <div className="flex size-8 shrink-0 items-center justify-center rounded border border-border/70 bg-muted/50 text-muted-foreground">
                <MonitorIcon className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{title}</span>
                    <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[0.625rem] uppercase text-muted-foreground">
                        {browserSession.status}
                    </span>
                </div>
                <div className="flex min-w-0 items-center gap-2 text-[0.6875rem] text-muted-foreground">
                    {urlLabel ? <span className="truncate">{urlLabel}</span> : null}
                    {budget ? (
                        <span className="shrink-0">
                            {budget.used}/{budget.max}
                        </span>
                    ) : null}
                </div>
            </div>
            {browserSession.liveUrl ? (
                <Button asChild variant="ghost" size="icon-sm" aria-label="Open browser session">
                    <a href={browserSession.liveUrl} target="_blank" rel="noreferrer">
                        <ExternalLinkIcon />
                    </a>
                </Button>
            ) : null}
            {onClose ? (
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="xl:hidden"
                    aria-label="Close browser session panel"
                    onClick={onClose}
                >
                    <XIcon />
                </Button>
            ) : null}
        </div>
    )
}

function BrowserSessionFrame({
    browserSession,
    canFrame,
}: {
    browserSession: RoomBrowserSessionSnapshot
    canFrame: boolean
}) {
    if (!canFrame || !browserSession.liveUrl) {
        return (
            <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
                {browserSession.message ?? browserSession.status}
            </div>
        )
    }

    return (
        <iframe
            title="Browser session"
            src={browserSession.liveUrl}
            className="min-h-0 flex-1 border-0 bg-muted"
            referrerPolicy="no-referrer"
            sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts allow-downloads"
            allow="clipboard-read; clipboard-write; fullscreen"
        />
    )
}

function formatBrowserUrl(value: string): string {
    try {
        const url = new URL(value)
        return `${url.origin}${url.pathname}${url.search ? '?...' : ''}${url.hash ? '#...' : ''}`
    } catch {
        return value
    }
}

function streamTurnPersisted(streamTurn: StreamTurnState, rows: ChatTimelineRow[]): boolean {
    if (!streamTurn.finished) return false
    if (streamTurn.rows.length === 0) return false

    const streamSignature = timelineSignature(streamTurn.rows)
    if (streamSignature.toolCallIds.length === 0 && streamSignature.finalCount === 0) {
        return false
    }
    const persistedSignature = timelineSignature(rows, streamTurn.startedAt)
    const persistedToolIds = new Set(persistedSignature.toolCallIds)
    const toolsPersisted = streamSignature.toolCallIds.every((id) => persistedToolIds.has(id))
    const finalsPersisted = persistedSignature.finalCount >= streamSignature.finalCount
    if (streamSignature.toolCallIds.length > 0) {
        return toolsPersisted && finalsPersisted
    }
    return finalsPersisted
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
    return rows.filter(rowContainsMessage).map((row) => row.message)
}

function stopSessionInShell(
    snapshot: RoomSessionShellSnapshot,
    sessionKey: string,
    stoppedAt: number,
): RoomSessionShellSnapshot {
    return {
        ...snapshot,
        threads: stopThreads(snapshot.threads, sessionKey, stoppedAt),
        selectedThread:
            snapshot.selectedThread?.key === sessionKey
                ? stopThread(snapshot.selectedThread, stoppedAt)
                : snapshot.selectedThread,
        recentActivity: stopActivities(snapshot.recentActivity, sessionKey, stoppedAt),
    }
}

function stopSessionInSidebar(
    snapshot: RoomSidebarSnapshot,
    sessionKey: string,
    stoppedAt: number,
): RoomSidebarSnapshot {
    return {
        ...snapshot,
        threads: stopThreads(snapshot.threads, sessionKey, stoppedAt),
        recentActivity: stopActivities(snapshot.recentActivity, sessionKey, stoppedAt),
    }
}

function stopThreads(
    threads: RoomExecutionThread[],
    sessionKey: string,
    stoppedAt: number,
): RoomExecutionThread[] {
    return threads.map((thread) =>
        thread.key === sessionKey ? stopThread(thread, stoppedAt) : thread,
    )
}

function stopThread(thread: RoomExecutionThread, stoppedAt: number): RoomExecutionThread {
    const runtimeMs =
        thread.runStartedAt !== null
            ? Math.max(0, stoppedAt - thread.runStartedAt)
            : thread.runtimeMs
    return {
        ...thread,
        status: 'idle',
        updatedAt: stoppedAt,
        runStartedAt: null,
        runtimeMs,
    }
}

function stopActivities(
    activities: RoomExecutionActivity[],
    sessionKey: string,
    stoppedAt: number,
): RoomExecutionActivity[] {
    return activities.map((activity) =>
        activity.key === sessionKey ? stopActivity(activity, stoppedAt) : activity,
    )
}

function stopActivity(activity: RoomExecutionActivity, stoppedAt: number): RoomExecutionActivity {
    return {
        ...activity,
        status: 'idle',
        updatedAt: stoppedAt,
    }
}

function timelineSignature(
    rows: ChatTimelineRow[],
    afterTimestamp: number | null = null,
): {
    toolCallIds: string[]
    finalCount: number
} {
    const toolCallIds: string[] = []
    let finalCount = 0
    for (const row of rows) {
        if (afterTimestamp !== null && row.timestamp !== null && row.timestamp < afterTimestamp) {
            continue
        }
        if (row.type === 'assistant_final' && row.message.text.trim()) {
            finalCount += 1
            continue
        }
        if (row.type !== 'run_transcript') continue
        for (const item of row.items) {
            if (item.type === 'tool_activity') {
                toolCallIds.push(item.toolCallId)
            }
        }
    }
    return {
        toolCallIds,
        finalCount,
    }
}
