import type { RoomRealtimeEvent } from '#/lib/room-execution-types'

import { emptyStreamTurnState, type StreamTurnState } from './stream-state'

const streamTurnStateCache = new Map<string, StreamTurnState>()

export function sessionStreamStateKey(roomId: string, sessionKey: string): string {
    return `${roomId}:${sessionKey}`
}

export function readCachedStreamTurn(key: string): StreamTurnState {
    return streamTurnStateCache.get(key) ?? emptyStreamTurnState
}

export function cacheStreamTurn(key: string, state: StreamTurnState): void {
    if (state.runId || state.rows.length > 0 || state.status !== 'idle') {
        streamTurnStateCache.set(key, state)
        return
    }
    streamTurnStateCache.delete(key)
}

export function clearCachedStreamTurn(key: string): void {
    streamTurnStateCache.delete(key)
}

export function clearCachedStreamTurnForRoomEvent(input: {
    roomId: string
    sessionKey: string
    event: RoomRealtimeEvent
}): void {
    if (!shouldClearStreamTurnForRoomEvent(input.event)) return
    clearCachedStreamTurn(sessionStreamStateKey(input.roomId, input.sessionKey))
}

function shouldClearStreamTurnForRoomEvent(event: RoomRealtimeEvent): boolean {
    return (
        event.event === 'run.accepted' ||
        event.event === 'run.finished' ||
        event.event === 'run.error' ||
        event.event === 'agent_end' ||
        event.event === 'thread.message_edited'
    )
}
