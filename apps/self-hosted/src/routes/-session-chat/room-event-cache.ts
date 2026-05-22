import { useEffect } from 'react'
import type { QueryClient } from '@tanstack/react-query'

import { roomQueryKey } from '#/lib/room-query-keys'
import type { RoomRealtimeEvent } from '#/domain/room-execution-types'
import { clearCachedStreamTurnForRoomEvent } from './stream-turn-cache'

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
    }, [enabled, onError, queryClient, roomId])
}

export function invalidateRoomCachesForEvent(input: {
    roomId: string
    queryClient: QueryClient
    event: RoomRealtimeEvent
}): void {
    const sessionKey = sessionKeyFromRealtimeEvent(input.event)
    const sessionRefetchType = shouldRefetchInactiveSessionForEvent(input.event) ? 'all' : 'active'
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

    if (input.event.event === 'run.finished' || input.event.event === 'run.error') {
        void input.queryClient.invalidateQueries({
            queryKey: roomQueryKey.roomRunHistory(input.roomId),
        })
    }

    if (!sessionKey) return
    clearCachedStreamTurnForRoomEvent({
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
