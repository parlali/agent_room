import type { RoomRealtimeEvent } from '#/domain/room-execution-types'

import type { LiveRun } from './live-run'

const liveRunCache = new Map<string, LiveRun>()

export function sessionStreamStateKey(roomId: string, sessionKey: string): string {
    return `${roomId}:${sessionKey}`
}

export function readCachedLiveRun(key: string): LiveRun | null {
    return liveRunCache.get(key) ?? null
}

export function cacheLiveRun(key: string, run: LiveRun | null): void {
    if (run) {
        liveRunCache.set(key, run)
        return
    }
    liveRunCache.delete(key)
}

export function clearCachedLiveRun(key: string): void {
    liveRunCache.delete(key)
}

export function clearCachedLiveRunForRoomEvent(input: {
    roomId: string
    sessionKey: string
    event: RoomRealtimeEvent
}): void {
    if (!shouldClearLiveRunForRoomEvent(input.event)) return
    clearCachedLiveRun(sessionStreamStateKey(input.roomId, input.sessionKey))
}

function shouldClearLiveRunForRoomEvent(event: RoomRealtimeEvent): boolean {
    return (
        event.event === 'run.accepted' ||
        event.event === 'run.finished' ||
        event.event === 'run.error' ||
        event.event === 'agent_end' ||
        event.event === 'thread.message_edited'
    )
}
