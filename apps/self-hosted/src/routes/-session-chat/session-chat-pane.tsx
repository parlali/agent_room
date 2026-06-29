import { Link, useNavigate } from '@tanstack/react-router'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import { ExternalLinkIcon, MessageSquareIcon, MonitorIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'

import { AttentionBanner, EmptyState } from '#/components/agent-room'
import { roomSetupRequiredCopy } from '#/components/room-dashboard'
import { Button } from '#/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '#/components/ui/sheet'
import { useIsMobile } from '#/lib/use-media-query'
import { describeSessionState } from '#/domain/state'
import { uploadRoomFiles } from '#/lib/room-file-upload'
import { formatMessageWithAttachments } from '#/domain/room-attachments'
import {
    afterNextPaint,
    consumeChatSelection,
    peekChatSelection,
    recordClientPerformance,
} from '#/lib/browser-performance'
import { roomQueryKey, roomQueryPolicy } from '#/lib/room-query-keys'
import {
    sessionComposerDraftKey,
    sessionComposerDraftSaveDebounceMs,
    type SessionComposerDraftSnapshot,
} from '#/domain/session-composer-draft'
import {
    abortMessageServer,
    clearSessionCompletedBadgeServer,
    editMessageServer,
    getSessionComposerDraftServer,
    getRoomSidebarServer,
    getRoomSessionShellServer,
    getRoomSessionWindowServer,
    renameSessionServer,
    saveSessionComposerDraftServer,
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
} from '#/domain/room-execution-types'
import {
    isOnboardingRequiredMessage,
    onboardingDeferredStatus,
} from '#/domain/room-onboarding-errors'

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
import type { EditingMessageDraft } from '#/domain/message-list-model'
import { useStreamingRefetch } from './streaming'
import {
    addOptimisticUserMessage,
    editOptimisticUserMessage,
    promoteOptimisticUserMessageToPendingRun,
    rollbackOptimisticWindow,
    type OptimisticWindowRollback,
} from './chat-projection-store'
import { cacheStreamTurn, readCachedStreamTurn, sessionStreamStateKey } from './stream-turn-cache'
import { rowContainsMessage } from '#/domain/message-list-model'
import {
    artifactPanelStatesEqual,
    clampArtifactPanelWidth,
    defaultArtifactPanelState,
    patchArtifactPanelState,
    resolveSelectedArtifactId,
    sessionArtifactStateKey,
    type SessionArtifactPanelState,
} from './session-artifact-state'

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
const completedBadgeClearVisibleMs = 1000
const artifactPanelStateCache = new Map<string, SessionArtifactPanelState>()
const emptyArtifacts: RoomSessionArtifact[] = []

type SendMutationInput = {
    roomId: string
    sessionKey: string
    composerKey: string
    message: string
}

export function SessionChatPane({ roomId, sessionKey }: { roomId: string; sessionKey: string }) {
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const isMobile = useIsMobile()
    const composerStateKey = useMemo(
        () => sessionComposerDraftKey(roomId, sessionKey),
        [roomId, sessionKey],
    )
    const composerQueryKey = useMemo(
        () => roomQueryKey.sessionComposer(roomId, sessionKey),
        [roomId, sessionKey],
    )
    const cachedComposerDraft =
        queryClient.getQueryData<SessionComposerDraftSnapshot>(composerQueryKey)?.draft ?? ''
    const [draftState, setDraftState] = useState(() => ({
        key: composerStateKey,
        value: cachedComposerDraft,
    }))
    const draft = draftState.key === composerStateKey ? draftState.value : cachedComposerDraft
    const [streamError, setStreamError] = useState<string | null>(null)
    const [attachments, setAttachments] = useState<ComposerAttachment[]>([])
    const [editingMessage, setEditingMessage] = useState<EditingMessageDraft | null>(null)
    const [messageScrollTarget, setMessageScrollTarget] = useState<{
        messageId: string
        requestId: number
    } | null>(null)
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
    const draftRef = useRef(draft)
    const activeComposerKeyRef = useRef(composerStateKey)
    const composerEditedSinceLoadRef = useRef(false)
    const draftSaveTimerRef = useRef<number | null>(null)
    const draftSaveErrorKeyRef = useRef<string | null>(null)
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

    const invalidateSessionScope = useCallback(
        (options?: {
            roomId?: string
            sessionKey?: string
            includeRoomsList?: boolean
            includeWindow?: boolean
        }) => {
            const targetRoomId = options?.roomId ?? roomId
            const targetSessionKey = options?.sessionKey ?? sessionKey
            void queryClient.invalidateQueries({
                queryKey: roomQueryKey.sessionShell(targetRoomId, targetSessionKey),
            })
            if (options?.includeWindow ?? true) {
                void queryClient.invalidateQueries({
                    queryKey: roomQueryKey.sessionWindow(targetRoomId, targetSessionKey),
                })
            }
            void queryClient.invalidateQueries({
                queryKey: roomQueryKey.roomSidebar(targetRoomId),
            })
            if (options?.includeRoomsList ?? true) {
                void queryClient.invalidateQueries({ queryKey: roomQueryKey.roomsList })
            }
        },
        [queryClient, roomId, sessionKey],
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
                setup: sidebar.setup,
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
    const composerDraftQuery = useQuery<SessionComposerDraftSnapshot>({
        queryKey: composerQueryKey,
        queryFn: () =>
            getSessionComposerDraftServer({
                data: {
                    roomId,
                    sessionKey,
                },
            }),
        staleTime: 0,
        gcTime: roomQueryPolicy.retainedSessionMs,
    })

    const setComposerDraft = useCallback(
        (value: string, key = composerStateKey) => {
            draftRef.current = value
            setDraftState({ key, value })
        },
        [composerStateKey],
    )

    const cancelScheduledDraftSave = useCallback(() => {
        if (!draftSaveTimerRef.current) return
        window.clearTimeout(draftSaveTimerRef.current)
        draftSaveTimerRef.current = null
    }, [])

    const persistComposerDraft = useCallback(
        async (input: { roomId: string; sessionKey: string; draft: string }) => {
            try {
                const snapshot = await saveSessionComposerDraftServer({
                    data: input,
                })
                queryClient.setQueryData(
                    roomQueryKey.sessionComposer(input.roomId, input.sessionKey),
                    snapshot,
                )
                const persistedKey = sessionComposerDraftKey(input.roomId, input.sessionKey)
                if (draftSaveErrorKeyRef.current === persistedKey) {
                    draftSaveErrorKeyRef.current = null
                }
            } catch (error) {
                const failedKey = sessionComposerDraftKey(input.roomId, input.sessionKey)
                if (draftSaveErrorKeyRef.current === failedKey) return
                draftSaveErrorKeyRef.current = failedKey
                toast.error(
                    error instanceof Error ? error.message : 'Composer draft could not be saved',
                )
            }
        },
        [queryClient],
    )

    const scheduleComposerDraftSave = useCallback(
        (value: string) => {
            cancelScheduledDraftSave()
            const target = {
                roomId,
                sessionKey,
                draft: value,
            }
            draftSaveTimerRef.current = window.setTimeout(() => {
                draftSaveTimerRef.current = null
                void persistComposerDraft(target)
            }, sessionComposerDraftSaveDebounceMs)
        },
        [cancelScheduledDraftSave, persistComposerDraft, roomId, sessionKey],
    )

    const onChangeComposerDraft = useCallback(
        (value: string) => {
            composerEditedSinceLoadRef.current = true
            setComposerDraft(value)
            scheduleComposerDraftSave(value)
        },
        [scheduleComposerDraftSave, setComposerDraft],
    )

    const clearComposerDraft = useCallback(() => {
        cancelScheduledDraftSave()
        composerEditedSinceLoadRef.current = false
        setComposerDraft('')
        void persistComposerDraft({
            roomId,
            sessionKey,
            draft: '',
        })
    }, [cancelScheduledDraftSave, persistComposerDraft, roomId, sessionKey, setComposerDraft])

    const clearSentComposer = useCallback(
        (input: SendMutationInput) => {
            if (activeComposerKeyRef.current === input.composerKey) {
                clearComposerDraft()
                setAttachments([])
            } else {
                void persistComposerDraft({
                    roomId: input.roomId,
                    sessionKey: input.sessionKey,
                    draft: '',
                })
            }
        },
        [clearComposerDraft, persistComposerDraft],
    )

    const openOnboardingSessionFromSidebar = useCallback(async () => {
        const sidebar = await queryClient.fetchQuery({
            queryKey: roomQueryKey.roomSidebar(roomId),
            queryFn: () => getRoomSidebarServer({ data: { roomId } }),
            staleTime: 0,
        })
        const onboardingSessionKey =
            sidebar.setup.phase === 'onboarding' ? sidebar.setup.onboardingSessionKey : null
        if (!onboardingSessionKey || onboardingSessionKey === sessionKey) {
            return false
        }
        await navigate({
            to: '/rooms/$roomId/sessions/$sessionKey',
            params: {
                roomId,
                sessionKey: onboardingSessionKey,
            },
        })
        return true
    }, [navigate, queryClient, roomId, sessionKey])

    const snapshot = executionQuery.data
    const room = snapshot?.room ?? null
    const rows = useMemo(
        () => [...(windowQuery.data?.pages ?? [])].reverse().flatMap((page) => page.rows),
        [windowQuery.data?.pages],
    )
    const messages = useMemo(() => messagesFromRows(rows), [rows])
    const artifacts = windowQuery.data?.pages[0]?.artifacts ?? emptyArtifacts
    const totalRows = windowQuery.data?.pages[0]?.totalRows ?? rows.length
    const showArtifacts = room?.roomMode !== 'programmer' || artifacts.length > 0
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
    const selectedArtifactId = resolveSelectedArtifactId(
        artifacts,
        artifactState.selectedArtifactId,
    )
    const artifactsOpen = showArtifacts && artifactState.open
    const updateArtifactState = useCallback(
        (targetKey: string, patch: Partial<SessionArtifactPanelState>) => {
            setArtifactStateBySession((current) => {
                const currentState = current.get(targetKey) ?? defaultArtifactPanelState()
                const nextState = patchArtifactPanelState(currentState, patch)
                if (artifactPanelStatesEqual(currentState, nextState)) return current
                const next = new Map(current)
                next.set(targetKey, nextState)
                artifactPanelStateCache.set(targetKey, nextState)
                return next
            })
        },
        [],
    )
    const viewArtifactInConversation = useCallback(
        (artifact: RoomSessionArtifact) => {
            const messageId = artifact.messageId
            if (!messageId) return
            setMessageScrollTarget((current) => ({
                messageId,
                requestId: (current?.requestId ?? 0) + 1,
            }))
            updateArtifactState(artifactStateKey, { open: false })
        },
        [artifactStateKey, updateArtifactState],
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
        const cachedDraft =
            queryClient.getQueryData<SessionComposerDraftSnapshot>(composerQueryKey)?.draft ?? ''
        activeComposerKeyRef.current = composerStateKey
        composerEditedSinceLoadRef.current = false
        setComposerDraft(cachedDraft, composerStateKey)

        return () => {
            const draftToPersist = draftRef.current
            cancelScheduledDraftSave()
            void persistComposerDraft({
                roomId,
                sessionKey,
                draft: draftToPersist,
            })
        }
    }, [
        cancelScheduledDraftSave,
        composerQueryKey,
        composerStateKey,
        persistComposerDraft,
        queryClient,
        roomId,
        sessionKey,
        setComposerDraft,
    ])

    useEffect(() => {
        const serverDraft = composerDraftQuery.data
        if (!serverDraft) return
        if (activeComposerKeyRef.current !== composerStateKey) return
        if (composerEditedSinceLoadRef.current) return
        setComposerDraft(serverDraft.draft, composerStateKey)
    }, [composerDraftQuery.data, composerStateKey, setComposerDraft])

    useEffect(() => {
        if (!composerDraftQuery.isError) return
        if (draftSaveErrorKeyRef.current === composerStateKey) return
        draftSaveErrorKeyRef.current = composerStateKey
        toast.error(
            composerDraftQuery.error instanceof Error
                ? composerDraftQuery.error.message
                : 'Composer draft could not be loaded',
        )
    }, [composerDraftQuery.error, composerDraftQuery.isError, composerStateKey])

    useEffect(() => {
        if (isMobile) return
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
        isMobile,
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
                event.event === 'room.files.changed' ||
                event.event === 'browser.session_changed' ||
                event.event === 'run.error' ||
                event.event === 'run.finished' ||
                event.event === 'agent_end'
            ) {
                invalidateSessionScope()
                if (event.event === 'run.finished') {
                    void queryClient.invalidateQueries({
                        queryKey: roomQueryKey.roomMemory(roomId),
                    })
                    void queryClient.invalidateQueries({
                        queryKey: roomQueryKey.roomPersonality(roomId),
                    })
                }
            }
        },
        [invalidateSessionScope, queryClient, roomId, updateStreamTurn],
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
        mutationFn: (input: SendMutationInput) =>
            sendMessageServer({
                data: {
                    roomId: input.roomId,
                    sessionKey: input.sessionKey,
                    message: input.message,
                },
            }),
        onMutate: async (input): Promise<OptimisticWindowRollback> => {
            return addOptimisticUserMessage({
                queryClient,
                roomId: input.roomId,
                sessionKey: input.sessionKey,
                message: input.message,
                timestamp: Date.now(),
            })
        },
        onSuccess: (result, input, rollback) => {
            if (result.status === onboardingDeferredStatus) {
                rollbackOptimisticWindow({
                    queryClient,
                    roomId: input.roomId,
                    sessionKey: input.sessionKey,
                    rollback,
                })
                clearSentComposer(input)
                invalidateSessionScope({
                    roomId: input.roomId,
                    sessionKey: input.sessionKey,
                })
                toast.success('Room intro skipped')
                return
            }
            promoteOptimisticUserMessageToPendingRun({
                queryClient,
                roomId: input.roomId,
                sessionKey: input.sessionKey,
                rollback,
                runId: result.runId,
            })
            clearSentComposer(input)
            invalidateSessionScope({
                roomId: input.roomId,
                sessionKey: input.sessionKey,
                includeRoomsList: false,
                includeWindow: false,
            })
        },
        onError: (error, input, rollback) => {
            rollbackOptimisticWindow({
                queryClient,
                roomId: input.roomId,
                sessionKey: input.sessionKey,
                rollback,
            })
            if (activeComposerKeyRef.current === input.composerKey) {
                cancelScheduledDraftSave()
                composerEditedSinceLoadRef.current = true
                setComposerDraft(input.message, input.composerKey)
            }
            void persistComposerDraft({
                roomId: input.roomId,
                sessionKey: input.sessionKey,
                draft: input.message,
            })
            const message = error instanceof Error ? error.message : 'Message could not be sent'
            if (isOnboardingRequiredMessage(message)) {
                void openOnboardingSessionFromSidebar()
                    .then((opened) => {
                        toast.message(
                            opened
                                ? 'Continue the room intro before using regular sessions'
                                : message,
                        )
                    })
                    .catch(() => {
                        toast.error(message)
                    })
                return
            }
            toast.error(message)
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
            invalidateSessionScope({ includeRoomsList: false, includeWindow: false })
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
                    speedMode: input.speedMode,
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
            invalidateSessionScope()
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

    const clearCompletedBadgeMutation = useMutation({
        mutationFn: () =>
            clearSessionCompletedBadgeServer({
                data: {
                    roomId,
                    sessionKey,
                },
            }),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey })
            void queryClient.invalidateQueries({ queryKey: roomQueryKey.roomSidebar(roomId) })
        },
    })
    const clearCompletedBadge = clearCompletedBadgeMutation.mutate
    const clearingCompletedBadge = clearCompletedBadgeMutation.isPending

    useEffect(() => {
        if (!selectedThread?.badgeState.completed) return
        if (clearingCompletedBadge) return

        let visibleSince: number | null = null
        let timeout: number | null = null
        let cancelled = false

        const clearTimer = () => {
            if (!timeout) return
            window.clearTimeout(timeout)
            timeout = null
        }

        const visibleAndFocused = () =>
            document.visibilityState === 'visible' && document.hasFocus()

        const schedule = () => {
            clearTimer()
            if (!visibleAndFocused()) {
                visibleSince = null
                return
            }
            visibleSince ??= performance.now()
            const elapsed = performance.now() - visibleSince
            const remaining = Math.max(0, completedBadgeClearVisibleMs - elapsed)
            timeout = window.setTimeout(() => {
                timeout = null
                if (cancelled || !visibleAndFocused()) {
                    visibleSince = null
                    schedule()
                    return
                }
                clearCompletedBadge()
            }, remaining)
        }

        const handleVisibilityChange = () => schedule()
        const handleFocus = () => schedule()
        const handleBlur = () => schedule()

        schedule()
        document.addEventListener('visibilitychange', handleVisibilityChange)
        window.addEventListener('focus', handleFocus)
        window.addEventListener('blur', handleBlur)

        return () => {
            cancelled = true
            clearTimer()
            document.removeEventListener('visibilitychange', handleVisibilityChange)
            window.removeEventListener('focus', handleFocus)
            window.removeEventListener('blur', handleBlur)
        }
    }, [clearCompletedBadge, clearingCompletedBadge, selectedThread?.badgeState.completed])

    const sending = sendMutation.isPending || editMutation.isPending

    const submitDraft = () => {
        if (sending) return
        const value = draft.trim()
        if (!value && attachments.length === 0) return
        const message = formatMessageWithAttachments(value, attachments)
        sendMutation.mutate({
            roomId,
            sessionKey,
            composerKey: composerStateKey,
            message,
        })
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

    const retrySession = () => {
        setStreamError(null)
        invalidateSessionScope({ includeRoomsList: false })
    }

    const chatAttention = resolveChatAttention(
        snapshot?.executionState ?? null,
        snapshot?.setup.phase ?? null,
        snapshot?.executionMessage ?? null,
        streamError,
    )

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
                sessionTitle={selectedThread?.title ?? 'Conversation'}
                sessionLabel={sessionTone.label}
                sessionToneKey={sessionTone.tone}
                provider={selectedThread?.modelProvider ?? null}
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
                onRename={(title) => renameMutation.mutateAsync(title)}
                renaming={renameMutation.isPending}
            />
            {chatAttention ? (
                <div className="border-b border-border/60 px-4 py-3 sm:px-6">
                    <AttentionBanner
                        tone={chatAttention.tone}
                        title={chatAttention.title}
                        description={chatAttention.description}
                        action={
                            chatAttention.kind === 'setup_required' ? (
                                <Button asChild variant="outline" size="sm">
                                    <Link to="/settings" hash="advanced">
                                        Finish setup
                                    </Link>
                                </Button>
                            ) : chatAttention.kind === 'out_of_credits' ? (
                                <Button asChild size="sm">
                                    <Link to="/billing" search={{ checkout: null }}>
                                        Buy credits
                                    </Link>
                                </Button>
                            ) : (
                                <Button size="sm" variant="outline" onClick={retrySession}>
                                    {chatAttention.kind === 'stream_paused'
                                        ? 'Reconnect'
                                        : 'Try again'}
                                </Button>
                            )
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
                    onSuggestPrompt={onChangeComposerDraft}
                    scrollToMessageId={messageScrollTarget?.messageId ?? null}
                    scrollRequestId={messageScrollTarget?.requestId}
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
                        selectedArtifactId={selectedArtifactId}
                        open={artifactsOpen}
                        onChangeState={(patch) => updateArtifactState(artifactStateKey, patch)}
                        onViewInConversation={viewArtifactInConversation}
                    />
                ) : null}
            </div>
            <Composer
                roomId={roomId}
                roomDisplayName={room.displayName}
                draft={draft}
                onChangeDraft={onChangeComposerDraft}
                onSubmit={onSubmit}
                onKeyDown={onComposerKeyDown}
                sending={sending}
                stopping={abortMutation.isPending}
                canStop={isWorking && (snapshot?.capabilities.canAbortGeneration ?? true)}
                onStop={() => abortMutation.mutate()}
                attachments={attachments}
                attaching={attachmentMutation.isPending}
                onAttachFiles={(files) => attachmentMutation.mutate(files)}
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
    const isMobile = useIsMobile()
    const title = browserSession.pageTitle?.trim() || 'Browser'
    const urlLabel = browserSession.pageUrl ? formatBrowserUrl(browserSession.pageUrl) : null
    const canFrame = browserSession.status === 'open' && browserSession.liveUrl

    if (isMobile) {
        return (
            <Sheet
                open={open}
                onOpenChange={(next) => {
                    if (!next) onClose()
                }}
            >
                <SheetContent side="bottom" className="h-[85dvh] gap-0 p-0">
                    <SheetHeader className="sr-only">
                        <SheetTitle>{title}</SheetTitle>
                    </SheetHeader>
                    <BrowserSessionHeader
                        title={title}
                        urlLabel={urlLabel}
                        browserSession={browserSession}
                    />
                    <BrowserSessionFrame
                        browserSession={browserSession}
                        canFrame={Boolean(canFrame)}
                    />
                </SheetContent>
            </Sheet>
        )
    }

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
    onClose,
}: {
    title: string
    urlLabel: string | null
    browserSession: RoomBrowserSessionSnapshot
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
                    <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[0.625rem] text-muted-foreground">
                        {browserStatusLabel(browserSession.status)}
                    </span>
                </div>
                {urlLabel ? (
                    <div className="min-w-0 truncate text-[0.6875rem] text-muted-foreground">
                        {urlLabel}
                    </div>
                ) : null}
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
                {browserFallbackMessage(browserSession.status)}
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

function browserStatusLabel(status: RoomBrowserSessionSnapshot['status']): string {
    if (status === 'opening') return 'Starting'
    if (status === 'open') return 'Live'
    if (status === 'closing') return 'Closing'
    if (status === 'closed') return 'Closed'
    return 'Problem'
}

function browserFallbackMessage(status: RoomBrowserSessionSnapshot['status']): string {
    if (status === 'opening') return 'Getting the browser ready...'
    if (status === 'closing' || status === 'closed') return 'The browser session has ended.'
    if (status === 'error') return 'The browser session ran into a problem.'
    return 'The browser session is not available right now.'
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

function SessionArtifactsShell({
    roomId,
    sessionKey,
    artifacts,
    state,
    selectedArtifactId,
    open,
    onChangeState,
    onViewInConversation,
}: {
    roomId: string
    sessionKey: string
    artifacts: RoomSessionArtifact[]
    state: SessionArtifactPanelState
    selectedArtifactId: string | null
    open: boolean
    onChangeState: (patch: Partial<SessionArtifactPanelState>) => void
    onViewInConversation?: (artifact: RoomSessionArtifact) => void
}) {
    const isMobile = useIsMobile()
    const mountedLoggedRef = useRef(false)
    const openStartedAtRef = useRef<number | null>(null)
    const [resizing, setResizing] = useState(false)
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
        setResizing(true)
        const onMove = (moveEvent: MouseEvent) => {
            const nextWidth = clampArtifactPanelWidth(startWidth - (moveEvent.clientX - startX))
            onChangeState({ width: nextWidth })
        }
        const onUp = () => {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
            setResizing(false)
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp, { once: true })
    }

    if (isMobile) {
        return (
            <Sheet
                open={open}
                onOpenChange={(next) => {
                    if (!next) onChangeState({ open: false })
                }}
            >
                <SheetContent side="bottom" className="h-[85dvh] gap-0 p-0">
                    <SheetHeader className="sr-only">
                        <SheetTitle>Files in this session</SheetTitle>
                    </SheetHeader>
                    {shouldLoad ? (
                        <Suspense fallback={null}>
                            <SessionArtifactsPanel
                                roomId={roomId}
                                artifacts={artifacts}
                                selectedArtifactId={selectedArtifactId}
                                onSelectArtifact={(nextSelectedArtifactId) =>
                                    onChangeState({ selectedArtifactId: nextSelectedArtifactId })
                                }
                                onViewInConversation={onViewInConversation}
                                onClose={() => onChangeState({ open: false })}
                                className="h-full"
                            />
                        </Suspense>
                    ) : null}
                </SheetContent>
            </Sheet>
        )
    }

    return (
        <>
            <div
                className={`hidden shrink-0 overflow-hidden border-l border-border/60 xl:block ${resizing ? '' : 'transition-[width] duration-200 ease-out'}`}
                style={{ width: open ? state.width : 0 }}
                aria-hidden={!open}
            >
                <div className="relative h-full" style={{ width: state.width }}>
                    <button
                        type="button"
                        className="absolute inset-y-0 left-0 z-10 w-3 -translate-x-1/2 cursor-col-resize bg-transparent after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-border/70 hover:after:bg-border"
                        aria-label="Resize artifacts"
                        onMouseDown={onDesktopResizeStart}
                    />
                    {shouldLoad ? (
                        <Suspense fallback={null}>
                            <SessionArtifactsPanel
                                roomId={roomId}
                                artifacts={artifacts}
                                selectedArtifactId={selectedArtifactId}
                                onSelectArtifact={(nextSelectedArtifactId) =>
                                    onChangeState({ selectedArtifactId: nextSelectedArtifactId })
                                }
                                onViewInConversation={onViewInConversation}
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
                            selectedArtifactId={selectedArtifactId}
                            onSelectArtifact={(nextSelectedArtifactId) =>
                                onChangeState({ selectedArtifactId: nextSelectedArtifactId })
                            }
                            onViewInConversation={onViewInConversation}
                            onClose={() => onChangeState({ open: false })}
                        />
                    </Suspense>
                ) : null}
            </div>
        </>
    )
}

type ChatAttention = {
    kind: 'runtime_error' | 'setup_required' | 'stream_paused' | 'out_of_credits'
    tone: 'danger' | 'attention'
    title: string
    description: string
}

const outOfCreditsAttention: ChatAttention = {
    kind: 'out_of_credits',
    tone: 'attention',
    title: 'You are out of credits',
    description: 'Top up your credits to keep this room working.',
}

function isOutOfCreditsMessage(message: string | null): boolean {
    if (!message) return false
    const normalized = message.toLowerCase()
    return (
        normalized.includes('spend cap') ||
        normalized.includes('out of credit') ||
        normalized.includes('insufficient credit') ||
        normalized.includes('not enough credit')
    )
}

function resolveChatAttention(
    executionState: RoomSessionShellSnapshot['executionState'] | null,
    setupPhase: RoomSessionShellSnapshot['setup']['phase'] | null,
    executionMessage: string | null,
    streamError: string | null,
): ChatAttention | null {
    if (executionState === 'error') {
        if (isOutOfCreditsMessage(executionMessage)) {
            return outOfCreditsAttention
        }
        if (setupPhase === 'setup_required') {
            return {
                kind: 'setup_required',
                tone: 'attention',
                title: roomSetupRequiredCopy.title,
                description: roomSetupRequiredCopy.description,
            }
        }
        return {
            kind: 'runtime_error',
            tone: 'danger',
            title: 'Something interrupted this room',
            description: 'The room hit a problem and paused. Try again in a moment.',
        }
    }
    if (streamError) {
        if (isOutOfCreditsMessage(streamError)) {
            return outOfCreditsAttention
        }
        return {
            kind: 'stream_paused',
            tone: 'attention',
            title: 'Live updates paused',
            description: 'Reconnect to keep this conversation up to date.',
        }
    }
    return null
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
