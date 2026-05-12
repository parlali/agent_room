import { useEffect } from 'react'
import type { QueryClient } from '@tanstack/react-query'

import { roomQueryKey } from '#/lib/room-query-keys'
import type { RoomRealtimeEvent } from '#/lib/room-execution-types'

export function useRoomEventCacheSync({
    roomId,
    queryClient,
    onError,
}: {
    roomId: string
    queryClient: QueryClient
    onError?: (message: string | null) => void
}) {
    useEffect(() => {
        if (typeof EventSource === 'undefined') return

        const source = new EventSource(`/api/rooms/${encodeURIComponent(roomId)}/events`)

        const onRoomEvent = (raw: MessageEvent<string>) => {
            onError?.(null)
            try {
                const event = JSON.parse(raw.data) as RoomRealtimeEvent
                invalidateRoomCachesForEvent({
                    roomId,
                    queryClient,
                    event,
                })
            } catch {
                onError?.('Live room update payload was unreadable')
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
                onError?.(event.message ?? event.payload?.message ?? 'Live room updates paused')
            } catch {
                onError?.('Live room updates paused')
            }
        }

        source.addEventListener('room-event', onRoomEvent as EventListener)
        source.addEventListener('stream-error', onStreamError as EventListener)

        return () => {
            source.removeEventListener('room-event', onRoomEvent as EventListener)
            source.removeEventListener('stream-error', onStreamError as EventListener)
            source.close()
        }
    }, [onError, queryClient, roomId])
}

export function invalidateRoomCachesForEvent(input: {
    roomId: string
    queryClient: QueryClient
    event: RoomRealtimeEvent
}): void {
    const sessionKey = sessionKeyFromRealtimeEvent(input.event)
    const invalidateRoomSummary = () => {
        void input.queryClient.invalidateQueries({ queryKey: roomQueryKey.roomsList })
        void input.queryClient.invalidateQueries({
            queryKey: roomQueryKey.roomSidebar(input.roomId),
        })
        void input.queryClient.invalidateQueries({
            queryKey: roomQueryKey.roomExecution(input.roomId),
        })
    }

    if (
        input.event.event === 'thread.renamed' ||
        input.event.event === 'thread.title_generated' ||
        input.event.event === 'thread.deleted' ||
        input.event.event === 'thread.forked' ||
        input.event.event === 'thread.model_changed' ||
        input.event.event === 'run.finished' ||
        input.event.event === 'agent_end'
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

    if (
        input.event.event === 'run.finished' ||
        input.event.event === 'agent_end' ||
        input.event.event === 'thread.renamed' ||
        input.event.event === 'thread.title_generated' ||
        input.event.event === 'thread.model_changed' ||
        input.event.event === 'room.files.changed'
    ) {
        void input.queryClient.invalidateQueries({
            queryKey: roomQueryKey.sessionShell(input.roomId, sessionKey),
        })
        void input.queryClient.invalidateQueries({
            queryKey: roomQueryKey.sessionWindow(input.roomId, sessionKey),
        })
        void input.queryClient.invalidateQueries({
            queryKey: roomQueryKey.sessionArtifacts(input.roomId, sessionKey),
        })
    }
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
