import { useEffect } from 'react'
import type { QueryClient } from '@tanstack/react-query'

import { roomQueryKey } from '#/lib/room-query-keys'
import type { RoomRealtimeEvent } from '#/domain/room-execution-types'
import { clearCachedLiveRunForRoomEvent } from './stream-turn-cache'

const SEQ_DEDUPE_WINDOW = 512

const EVENT_SOURCE_RECONNECT_MIN_MS = 1000
const EVENT_SOURCE_RECONNECT_MAX_MS = 15000

export function createEventSourceReconnectDelay(): (attempt: number) => number {
    return (attempt) => {
        const exponent = Math.max(0, attempt - 1)
        const raw = EVENT_SOURCE_RECONNECT_MIN_MS * 2 ** exponent
        return Math.min(EVENT_SOURCE_RECONNECT_MAX_MS, raw)
    }
}

export function createRoomEventSeqDedupe(): (seq: number | null) => boolean {
    const seen = new Set<number>()
    const order: number[] = []
    return (seq) => {
        if (seq === null) {
            return false
        }
        if (seen.has(seq)) {
            return true
        }
        seen.add(seq)
        order.push(seq)
        if (order.length > SEQ_DEDUPE_WINDOW) {
            const evicted = order.shift()
            if (evicted !== undefined) {
                seen.delete(evicted)
            }
        }
        return false
    }
}

export function useRoomEventCacheSync({
    roomId,
    queryClient,
    onError,
    enabled = true,
}: {
    roomId: string
    queryClient: QueryClient
    onError?: (message: string | null) => void
    enabled?: boolean
}) {
    useEffect(() => {
        if (!enabled) return
        if (typeof EventSource === 'undefined') return

        const url = `/api/rooms/${encodeURIComponent(roomId)}/events`
        const alreadyHandled = createRoomEventSeqDedupe()
        const reconnectDelay = createEventSourceReconnectDelay()
        let source: EventSource | null = null
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null
        let reconnectAttempts = 0
        let disposed = false

        const onRoomEvent = (raw: MessageEvent<string>) => {
            onError?.(null)
            try {
                const event = JSON.parse(raw.data) as RoomRealtimeEvent
                if (alreadyHandled(event.seq)) {
                    return
                }
                invalidateRoomCachesForEvent({
                    roomId,
                    queryClient,
                    event,
                })
            } catch {
                onError?.('Live room update payload was unreadable')
            }
        }

        const onRuntimeStatus = () => {
            onError?.(null)
            invalidateRoomSummaryQueries({ roomId, queryClient })
        }

        const onStreamError = (raw: MessageEvent<string>) => {
            try {
                const event = JSON.parse(raw.data) as {
                    message?: string
                    payload?: {
                        message?: string
                    }
                }
                onError?.(event.message ?? event.payload?.message ?? 'Live room updates paused')
            } catch {
                onError?.('Live room updates paused')
            }
        }

        const onOpen = () => {
            reconnectAttempts = 0
            onError?.(null)
        }

        const onConnectionError = () => {
            if (disposed) return
            if (!source || source.readyState !== EventSource.CLOSED) {
                return
            }
            teardown()
            reconnectAttempts += 1
            reconnectTimer = setTimeout(connect, reconnectDelay(reconnectAttempts))
        }

        function teardown(): void {
            if (!source) return
            source.removeEventListener('room-event', onRoomEvent as EventListener)
            source.removeEventListener('runtime-status', onRuntimeStatus as EventListener)
            source.removeEventListener('stream-error', onStreamError as EventListener)
            source.removeEventListener('open', onOpen)
            source.removeEventListener('error', onConnectionError)
            source.close()
            source = null
        }

        function connect(): void {
            if (disposed) return
            source = new EventSource(url)
            source.addEventListener('room-event', onRoomEvent as EventListener)
            source.addEventListener('runtime-status', onRuntimeStatus as EventListener)
            source.addEventListener('stream-error', onStreamError as EventListener)
            source.addEventListener('open', onOpen)
            source.addEventListener('error', onConnectionError)
        }

        connect()

        return () => {
            disposed = true
            if (reconnectTimer) clearTimeout(reconnectTimer)
            teardown()
        }
    }, [enabled, onError, queryClient, roomId])
}

export function invalidateRoomSummaryQueries(input: {
    roomId: string
    queryClient: QueryClient
}): void {
    void input.queryClient.invalidateQueries({ queryKey: roomQueryKey.roomsList })
    void input.queryClient.invalidateQueries({
        queryKey: roomQueryKey.roomSidebar(input.roomId),
    })
    void input.queryClient.invalidateQueries({
        queryKey: roomQueryKey.roomExecution(input.roomId),
    })
}

export function invalidateRoomCachesForEvent(input: {
    roomId: string
    queryClient: QueryClient
    event: RoomRealtimeEvent
}): void {
    const sessionKey = sessionKeyFromRealtimeEvent(input.event)
    const sessionRefetchType = shouldRefetchInactiveSessionForEvent(input.event) ? 'all' : 'active'
    const invalidateRoomSummary = () =>
        invalidateRoomSummaryQueries({ roomId: input.roomId, queryClient: input.queryClient })

    if (
        input.event.event === 'thread.renamed' ||
        input.event.event === 'thread.title_generated' ||
        input.event.event === 'thread.deleted' ||
        input.event.event === 'thread.forked' ||
        input.event.event === 'thread.message_edited' ||
        input.event.event === 'thread.model_changed' ||
        input.event.event === 'thread.pending_messages_changed' ||
        input.event.event === 'run.accepted' ||
        input.event.event === 'run.error' ||
        input.event.event === 'run.finished' ||
        input.event.event === 'agent_end' ||
        input.event.event === 'browser.session_changed'
    ) {
        invalidateRoomSummary()
    }

    if (input.event.event === 'room.files.changed') {
        void input.queryClient.invalidateQueries({ queryKey: roomQueryKey.roomFiles(input.roomId) })
        void input.queryClient.invalidateQueries({
            queryKey: roomQueryKey.roomFileTree(input.roomId),
        })
        void input.queryClient.invalidateQueries({
            queryKey: roomQueryKey.roomDirectory(input.roomId),
            exact: false,
        })
        void input.queryClient.invalidateQueries({
            queryKey: roomQueryKey.roomFilePreview(input.roomId),
            exact: false,
        })
    }

    if (!sessionKey) return
    clearCachedLiveRunForRoomEvent({
        roomId: input.roomId,
        sessionKey,
        event: input.event,
    })

    if (
        input.event.event === 'run.accepted' ||
        input.event.event === 'run.finished' ||
        input.event.event === 'run.error' ||
        input.event.event === 'agent_end' ||
        input.event.event === 'thread.renamed' ||
        input.event.event === 'thread.title_generated' ||
        input.event.event === 'thread.message_edited' ||
        input.event.event === 'thread.model_changed' ||
        input.event.event === 'thread.pending_messages_changed' ||
        input.event.event === 'room.files.changed' ||
        input.event.event === 'browser.session_changed'
    ) {
        void input.queryClient.invalidateQueries({
            queryKey: roomQueryKey.sessionShell(input.roomId, sessionKey),
            refetchType: sessionRefetchType,
        })
        void input.queryClient.invalidateQueries({
            queryKey: roomQueryKey.sessionWindow(input.roomId, sessionKey),
            refetchType: sessionRefetchType,
        })
        void input.queryClient.invalidateQueries({
            queryKey: roomQueryKey.sessionArtifacts(input.roomId, sessionKey),
            refetchType: sessionRefetchType,
        })
    }
}

function shouldRefetchInactiveSessionForEvent(event: RoomRealtimeEvent): boolean {
    return (
        event.event === 'run.finished' ||
        event.event === 'run.error' ||
        event.event === 'agent_end' ||
        event.event === 'thread.message_edited'
    )
}

function sessionKeyFromRealtimeEvent(event: RoomRealtimeEvent): string | null {
    const payload = event.payload
    if (!isRecord(payload)) return null
    if (typeof payload.sessionKey === 'string') return payload.sessionKey
    const innerEvent = isRecord(payload.event) ? payload.event : null
    if (typeof innerEvent?.sessionKey === 'string') return innerEvent.sessionKey
    return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
