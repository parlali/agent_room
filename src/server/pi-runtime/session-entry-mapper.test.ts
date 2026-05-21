import { describe, expect, it } from 'vitest'
import { mapSessionEntry } from './session-entry-mapper'
import type { SessionEntry } from '@mariozechner/pi-coding-agent'

describe('session entry mapper', () => {
    it('preserves failed tool-result status from persisted JSONL', () => {
        const entry = {
            id: 'tool-result-1',
            type: 'message',
            timestamp: new Date(0).toISOString(),
            message: {
                role: 'tool',
                toolCallId: 'call-1',
                toolName: 'set_room_profile',
                isError: true,
                content: 'Invalid enum value',
            },
        } as unknown as SessionEntry

        const message = mapSessionEntry(entry, 0, new Set(['call-1']))

        expect(message?.parts[0]).toMatchObject({
            type: 'tool_result',
            toolCallId: 'call-1',
            toolName: 'set_room_profile',
            status: 'error',
            text: 'Invalid enum value',
        })
    })
})
