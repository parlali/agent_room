import type { QueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { RoomRealtimeEvent } from '#/domain/room-execution-types'
import { createEventSourceReconnectDelay, createRoomEventSeqDedupe } from './room-event-cache'

const STREAM_ERROR_THRESHOLD = 6

export function useStreamingRefetch({
    roomId,
    sessionKey,
    queryClient,
    queryKey,
    onError,
    onEvent,
    shouldRefetch,
}: {
    roomId: string
    sessionKey: string
    queryClient: QueryClient
    queryKey: readonly unknown[]
    onError: (message: string | null) => void
    onEvent?: (event: RoomRealtimeEvent) => void
    shouldRefetch?: (event: RoomRealtimeEvent) => boolean
}) {
    useEventSourceRefetch({
        url: `/api/rooms/${encodeURIComponent(roomId)}/sessions/${encodeURIComponent(sessionKey)}/events`,
        queryClient,
        queryKey,
        onError,
        onEvent,
        shouldRefetch,
    })
}

export function useEventSourceRefetch({
    url,
    queryClient,
    queryKey,
    onError,
    onEvent,
    shouldRefetch,
}: {
    url: string
    queryClient: QueryClient
    queryKey?: readonly unknown[]
    onError: (message: string | null) => void
    onEvent?: (event: RoomRealtimeEvent) => void
    shouldRefetch?: (event: RoomRealtimeEvent) => boolean
}) {
    useEffect(() => {
        if (typeof EventSource === 'undefined') return

        const alreadyHandled = createRoomEventSeqDedupe()
        const reconnectDelay = createEventSourceReconnectDelay()
        let source: EventSource | null = null
        let timer: ReturnType<typeof setTimeout> | null = null
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null
        let reconnectAttempts = 0
        let disposed = false

        const scheduleRefetch = () => {
            if (!queryKey) return
            if (timer) clearTimeout(timer)
            timer = setTimeout(() => {
                void queryClient.invalidateQueries({ queryKey })
            }, 200)
        }

        const onRoomEvent = (raw: MessageEvent<string>) => {
            reconnectAttempts = 0
            try {
                const event = JSON.parse(raw.data) as RoomRealtimeEvent
                if (alreadyHandled(event.seq)) {
                    return
                }
                onEvent?.(event)
                if (shouldRefetch?.(event) ?? true) {
                    scheduleRefetch()
                }
            } catch {
                onError('Live update payload was unreadable')
            }
        }

        const onStreamError = (raw: MessageEvent<string>) => {
            try {
                const event = JSON.parse(raw.data) as {
                    message?: string
                    payload?: {
                        message?: string
                    }
                }
                onError(event.message ?? event.payload?.message ?? 'Live updates disconnected')
            } catch {
                onError('Live updates disconnected')
            }
        }

        const onConnectionError = () => {
            if (disposed) return
            if (!source || source.readyState !== EventSource.CLOSED) {
                return
            }
            teardown()
            reconnectAttempts += 1
            if (reconnectAttempts >= STREAM_ERROR_THRESHOLD) {
                onError('Reconnecting to live updates for this room.')
            }
            reconnectTimer = setTimeout(connect, reconnectDelay(reconnectAttempts))
        }

        const onOpen = () => {
            reconnectAttempts = 0
            onError(null)
        }

        function teardown(): void {
            if (!source) return
            source.removeEventListener('room-event', onRoomEvent as EventListener)
            source.removeEventListener('stream-error', onStreamError as EventListener)
            source.removeEventListener('error', onConnectionError)
            source.removeEventListener('open', onOpen)
            source.close()
            source = null
        }

        function connect(): void {
            if (disposed) return
            source = new EventSource(url)
            source.addEventListener('room-event', onRoomEvent as EventListener)
            source.addEventListener('stream-error', onStreamError as EventListener)
            source.addEventListener('error', onConnectionError)
            source.addEventListener('open', onOpen)
        }

        connect()

        return () => {
            disposed = true
            if (timer) clearTimeout(timer)
            if (reconnectTimer) clearTimeout(reconnectTimer)
            teardown()
        }
    }, [url, queryClient, queryKey, onError, onEvent, shouldRefetch])
}
