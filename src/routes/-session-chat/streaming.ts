import type { QueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { RoomRealtimeEvent } from '#/lib/room-execution-types'

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

        const source = new EventSource(url)
        let timer: ReturnType<typeof setTimeout> | null = null
        let consecutiveErrors = 0

        const scheduleRefetch = () => {
            if (!queryKey) return
            if (timer) clearTimeout(timer)
            timer = setTimeout(() => {
                void queryClient.invalidateQueries({ queryKey })
            }, 200)
        }

        const onRoomEvent = (raw: MessageEvent<string>) => {
            consecutiveErrors = 0
            try {
                const event = JSON.parse(raw.data) as RoomRealtimeEvent
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
    }, [url, queryClient, queryKey, onError, onEvent, shouldRefetch])
}
