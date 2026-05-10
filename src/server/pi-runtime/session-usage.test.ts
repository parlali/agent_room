import { describe, expect, it } from 'vitest'
import type { SessionEntry } from '@mariozechner/pi-coding-agent'
import { sessionUsageDelta, sessionUsageSnapshotFromEntries } from './session-usage'

function assistantEntry(input: {
    id: string
    input: number
    output: number
    cacheRead?: number
    cacheWrite?: number
    totalTokens?: number
    cost?: number
}): SessionEntry {
    return {
        type: 'message',
        id: input.id,
        parentId: null,
        timestamp: new Date().toISOString(),
        message: {
            role: 'assistant',
            content: [],
            api: 'openai-responses',
            provider: 'openai',
            model: 'gpt-5',
            timestamp: Date.now(),
            stopReason: 'stop',
            usage: {
                input: input.input,
                output: input.output,
                cacheRead: input.cacheRead ?? 0,
                cacheWrite: input.cacheWrite ?? 0,
                totalTokens:
                    input.totalTokens ??
                    input.input + input.output + (input.cacheRead ?? 0) + (input.cacheWrite ?? 0),
                cost: {
                    input: 0,
                    output: 0,
                    cacheRead: 0,
                    cacheWrite: 0,
                    total: input.cost ?? 0,
                },
            },
        },
    }
}

describe('Pi session usage accounting', () => {
    it('totals factual assistant usage from persisted session entries', () => {
        const snapshot = sessionUsageSnapshotFromEntries([
            assistantEntry({
                id: 'a',
                input: 100,
                output: 50,
                cacheRead: 25,
                cost: 0.01,
            }),
            {
                type: 'compaction',
                id: 'c',
                parentId: null,
                timestamp: new Date().toISOString(),
                summary: 'compacted',
                firstKeptEntryId: 'a',
                tokensBefore: 1000,
            },
            assistantEntry({
                id: 'b',
                input: 80,
                output: 40,
                cacheWrite: 20,
                cost: 0.02,
            }),
        ])

        expect(snapshot).toMatchObject({
            inputTokens: 180,
            outputTokens: 90,
            cacheReadTokens: 25,
            cacheWriteTokens: 20,
            totalTokens: 315,
            estimatedCostUsd: 0.03,
            usageEntryCount: 2,
        })
    })

    it('returns deltas from the persisted totals without requiring a pre-existing snapshot', () => {
        const after = sessionUsageSnapshotFromEntries([
            assistantEntry({
                id: 'a',
                input: 100,
                output: 50,
                cacheRead: 25,
                cost: 0.01,
            }),
        ])

        expect(sessionUsageDelta(null, after, true)).toEqual({
            inputTokens: 100,
            outputTokens: 50,
            cachedTokens: 25,
            reasoningTokens: null,
            totalTokens: 175,
            estimatedCostUsd: 0.01,
            costKnown: true,
        })
    })

    it('does not report cost when the active model has no pricing', () => {
        const before = sessionUsageSnapshotFromEntries([
            assistantEntry({
                id: 'a',
                input: 100,
                output: 50,
                cost: 0,
            }),
        ])
        const after = sessionUsageSnapshotFromEntries([
            assistantEntry({
                id: 'a',
                input: 100,
                output: 50,
                cost: 0,
            }),
            assistantEntry({
                id: 'b',
                input: 25,
                output: 10,
                cost: 0,
            }),
        ])

        expect(sessionUsageDelta(before, after, false)).toEqual({
            inputTokens: 25,
            outputTokens: 10,
            cachedTokens: 0,
            reasoningTokens: null,
            totalTokens: 35,
            estimatedCostUsd: null,
            costKnown: false,
        })
    })
})
