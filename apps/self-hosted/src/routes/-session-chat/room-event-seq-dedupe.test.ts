import { describe, expect, it } from 'vitest'

import { createRoomEventSeqDedupe } from './room-event-cache'

describe('createRoomEventSeqDedupe', () => {
    it('passes new sequential ids and drops repeats from replay', () => {
        const dedupe = createRoomEventSeqDedupe()
        expect(dedupe(1)).toBe(false)
        expect(dedupe(2)).toBe(false)
        expect(dedupe(3)).toBe(false)
        expect(dedupe(2)).toBe(true)
        expect(dedupe(3)).toBe(true)
        expect(dedupe(4)).toBe(false)
    })

    it('never dedupes null seq values', () => {
        const dedupe = createRoomEventSeqDedupe()
        expect(dedupe(null)).toBe(false)
        expect(dedupe(null)).toBe(false)
    })

    it('accepts a restart that resets ids below the recent window', () => {
        const dedupe = createRoomEventSeqDedupe()
        for (let seq = 1; seq <= 1000; seq += 1) {
            dedupe(seq)
        }
        expect(dedupe(1)).toBe(false)
        expect(dedupe(2)).toBe(false)
    })
})
