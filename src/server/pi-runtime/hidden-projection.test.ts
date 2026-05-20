import { describe, expect, it } from 'vitest'
import type { SessionEntry } from '@mariozechner/pi-coding-agent'
import {
    hiddenProjectionEntryIds,
    hiddenProjectionEntryType,
    isHiddenProjectionEntry,
    visibleProjectionEntries,
} from './hidden-projection'

describe('hidden projection', () => {
    it('collects hidden user message ids from custom entries', () => {
        const entries = [
            {
                type: 'custom',
                id: 'hide-1',
                customType: hiddenProjectionEntryType,
                data: { hiddenEntryId: 'user-1' },
                parentId: null,
                timestamp: new Date(0).toISOString(),
            },
            {
                type: 'message',
                id: 'user-1',
                parentId: 'hide-1',
                timestamp: new Date(0).toISOString(),
                message: { role: 'user', content: 'internal onboarding instruction' },
            },
        ] as unknown as SessionEntry[]

        const hidden = hiddenProjectionEntryIds(entries)
        expect(hidden.has('user-1')).toBe(true)
        expect(isHiddenProjectionEntry(entries[1]!, hidden)).toBe(true)
        expect(visibleProjectionEntries(entries).map((entry) => entry.id)).toEqual(['hide-1'])
    })

    it('hides internal user messages by prompt text before the message id exists', () => {
        const entries = [
            {
                type: 'custom',
                id: 'hide-1',
                customType: hiddenProjectionEntryType,
                data: { hiddenText: 'internal onboarding instruction' },
                parentId: null,
                timestamp: new Date(0).toISOString(),
            },
            {
                type: 'message',
                id: 'user-1',
                parentId: 'hide-1',
                timestamp: new Date(0).toISOString(),
                message: { role: 'user', content: 'internal onboarding instruction' },
            },
        ] as unknown as SessionEntry[]

        expect(visibleProjectionEntries(entries).map((entry) => entry.id)).toEqual(['hide-1'])
    })
})
