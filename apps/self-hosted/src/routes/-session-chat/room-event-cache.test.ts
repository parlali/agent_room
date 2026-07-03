import { describe, expect, it, vi } from 'vitest'
import type { QueryClient } from '@tanstack/react-query'

import { roomQueryKey } from '#/lib/room-query-keys'
import { invalidateRoomSummaryQueries } from './room-event-cache'

function createQueryClientSpy() {
    const invalidateQueries = vi.fn((_filters: { queryKey: readonly unknown[] }) =>
        Promise.resolve(),
    )
    return {
        client: { invalidateQueries } as unknown as QueryClient,
        invalidateQueries,
    }
}

describe('invalidateRoomSummaryQueries', () => {
    it('invalidates the rooms list, sidebar, and execution queries for the room', () => {
        const { client, invalidateQueries } = createQueryClientSpy()
        invalidateRoomSummaryQueries({ roomId: 'room-1', queryClient: client })
        const keys = invalidateQueries.mock.calls.map((call) => call[0]?.queryKey)
        expect(keys).toContainEqual(roomQueryKey.roomsList)
        expect(keys).toContainEqual(roomQueryKey.roomSidebar('room-1'))
        expect(keys).toContainEqual(roomQueryKey.roomExecution('room-1'))
    })
})
