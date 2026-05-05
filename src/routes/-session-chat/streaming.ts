import type { QueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

const STREAM_ERROR_THRESHOLD = 6

export function useStreamingRefetch({
    roomId,
    sessionKey,
    queryClient,
    queryKey,
    onError,
}: {
    roomId: string
    sessionKey: string
    queryClient: QueryClient
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
