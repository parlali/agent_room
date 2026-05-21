import { randomUUID } from 'node:crypto'
import type { SessionEntry } from '@mariozechner/pi-coding-agent'
import { describe, expect, it } from 'vitest'
import {
    estimateRuntimeMessageContextBytes,
    estimateSessionBranchContextBytes,
    proactiveCompactionContextBytes,
} from './session-context-budget'

function messageEntry(message: Record<string, unknown>): SessionEntry {
    return {
        id: randomUUID(),
        parentId: null,
        type: 'message',
        timestamp: '2026-05-11T09:00:00.000Z',
        message,
    } as unknown as SessionEntry
}

describe('session context budget', () => {
    it('counts large tool result content against the proactive compaction threshold', () => {
        const entries = [
            messageEntry({
                role: 'user',
                content: [{ type: 'text', text: 'test endpoints' }],
            }),
            messageEntry({
                role: 'toolResult',
                content: [
                    {
                        type: 'text',
                        text: 'x'.repeat(proactiveCompactionContextBytes + 1),
                    },
                ],
            }),
        ]

        expect(estimateSessionBranchContextBytes(entries)).toBeGreaterThan(
            proactiveCompactionContextBytes,
        )
    })

    it('can estimate Pi resolved context without counting raw pre-compaction history', () => {
        const messages = [
            {
                role: 'user',
                content: [{ type: 'text', text: 'summary of previous work' }],
            },
            {
                role: 'user',
                content: [{ type: 'text', text: 'replacement prompt' }],
            },
        ]

        expect(estimateRuntimeMessageContextBytes(messages)).toBeLessThan(
            proactiveCompactionContextBytes,
        )
    })
})
