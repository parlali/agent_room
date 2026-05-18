import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import { roomQueryKey } from '#/lib/room-query-keys'
import type { RoomRealtimeEvent } from '#/lib/room-execution-types'

import { invalidateRoomCachesForEvent } from './room-event-cache'
import { cacheStreamTurn, readCachedStreamTurn, sessionStreamStateKey } from './stream-turn-cache'
import { emptyStreamTurnState, reduceRoomStreamEvent } from './stream-state'

describe('room event cache sync', () => {
    it('clears stale live stream state when an inactive session finishes', () => {
        const roomId = 'room-1'
        const sessionKey = 'session-1'
        const key = sessionStreamStateKey(roomId, sessionKey)
        const liveState = reduceRoomStreamEvent(
            emptyStreamTurnState,
            realtimeEvent('run.accepted', {
                sessionKey,
                runId: 'run-1',
                startedAtMs: 1_000,
            }),
        )
        cacheStreamTurn(key, liveState)

        invalidateRoomCachesForEvent({
            roomId,
            queryClient: createQueryClient(),
            event: realtimeEvent('run.finished', {
                sessionKey,
                runId: 'run-1',
                status: 'idle',
            }),
        })

        expect(readCachedStreamTurn(key)).toBe(emptyStreamTurnState)
    })

    it('refetches cached inactive session windows on terminal events', async () => {
        const roomId = 'room-1'
        const sessionKey = 'session-1'
        const queryClient = createQueryClient()
        const queryKey = roomQueryKey.sessionWindow(roomId, sessionKey)
        let value = {
            sessionKey,
            rows: [],
            beforeCursor: null,
            afterCursor: null,
            hasOlder: false,
            hasNewer: false,
            totalRows: 0,
            artifacts: [],
        }
        const queryFn = vi.fn(async () => value)

        await queryClient.prefetchQuery({
            queryKey,
            queryFn,
            staleTime: Infinity,
        })
        queryFn.mockClear()
        value = {
            ...value,
            totalRows: 1,
        }

        invalidateRoomCachesForEvent({
            roomId,
            queryClient,
            event: realtimeEvent('run.finished', {
                sessionKey,
                runId: 'run-1',
                status: 'idle',
            }),
        })

        await eventually(() => {
            expect(queryFn).toHaveBeenCalledTimes(1)
            expect(queryClient.getQueryData(queryKey)).toMatchObject({
                totalRows: 1,
            })
        })
    })
})

function createQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
            },
        },
    })
}

function realtimeEvent(event: string, payload: unknown): RoomRealtimeEvent {
    return {
        event,
        payload,
        seq: 1,
        stateVersion: null,
        receivedAt: 2_000,
    }
}

async function eventually(assertion: () => void): Promise<void> {
    const startedAt = Date.now()
    let lastError: unknown = null
    while (Date.now() - startedAt < 1_000) {
        try {
            assertion()
            return
        } catch (error) {
            lastError = error
            await new Promise((resolve) => setTimeout(resolve, 10))
        }
    }
    if (lastError) throw lastError
}
