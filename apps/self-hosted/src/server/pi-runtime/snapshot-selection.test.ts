import { describe, expect, it } from 'vitest'
import { selectSnapshotThreadKey } from './snapshot-selection'

describe('Pi snapshot thread selection', () => {
    it('uses the latest room-owned thread when no explicit key is requested', () => {
        expect(
            selectSnapshotThreadKey({
                orderedThreadKeys: ['thread-new', 'thread-old'],
            }),
        ).toBe('thread-new')
    })

    it('returns the requested thread only when it belongs to this room index', () => {
        expect(
            selectSnapshotThreadKey({
                requestedThreadKey: 'thread-old',
                orderedThreadKeys: ['thread-new', 'thread-old'],
            }),
        ).toBe('thread-old')
        expect(
            selectSnapshotThreadKey({
                requestedThreadKey: 'other-room-thread',
                orderedThreadKeys: ['thread-new', 'thread-old'],
            }),
        ).toBeNull()
    })
})
