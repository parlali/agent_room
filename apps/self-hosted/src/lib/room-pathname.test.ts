import { describe, expect, it } from 'vitest'

import {
    resolveActiveRoomId,
    roomIdFromPathname,
    shouldClearOptimisticRoomId,
} from './room-pathname'

describe('roomIdFromPathname', () => {
    it('extracts the room id from a bare room path', () => {
        expect(roomIdFromPathname('/rooms/room-abc')).toBe('room-abc')
    })

    it('extracts the room id from a nested session path', () => {
        expect(roomIdFromPathname('/rooms/room-abc/sessions/session-xyz')).toBe('room-abc')
    })

    it('extracts the room id from a nested tab path', () => {
        expect(roomIdFromPathname('/rooms/room-abc/files')).toBe('room-abc')
        expect(roomIdFromPathname('/rooms/room-abc/settings')).toBe('room-abc')
    })

    it('returns null for non-room paths', () => {
        expect(roomIdFromPathname('/')).toBeNull()
        expect(roomIdFromPathname('/settings')).toBeNull()
        expect(roomIdFromPathname('/rooms')).toBeNull()
        expect(roomIdFromPathname('')).toBeNull()
    })
})

describe('resolveActiveRoomId', () => {
    it('prefers the optimistic room id for instant highlight', () => {
        expect(
            resolveActiveRoomId({ routeRoomId: 'route-room', optimisticRoomId: 'clicked-room' }),
        ).toBe('clicked-room')
    })

    it('falls back to the route room id when no optimistic value is set', () => {
        expect(resolveActiveRoomId({ routeRoomId: 'route-room', optimisticRoomId: null })).toBe(
            'route-room',
        )
    })

    it('returns null when neither value is present', () => {
        expect(resolveActiveRoomId({ routeRoomId: null, optimisticRoomId: null })).toBeNull()
    })
})

describe('shouldClearOptimisticRoomId', () => {
    it('clears once the route settles on the optimistic room, regardless of sub-path', () => {
        expect(
            shouldClearOptimisticRoomId({
                routeRoomId: 'clicked-room',
                optimisticRoomId: 'clicked-room',
            }),
        ).toBe(true)
    })

    it('keeps the optimistic highlight while the route has not caught up', () => {
        expect(
            shouldClearOptimisticRoomId({
                routeRoomId: 'previous-room',
                optimisticRoomId: 'clicked-room',
            }),
        ).toBe(false)
    })

    it('does nothing when no optimistic value is set', () => {
        expect(
            shouldClearOptimisticRoomId({ routeRoomId: 'route-room', optimisticRoomId: null }),
        ).toBe(false)
    })
})
