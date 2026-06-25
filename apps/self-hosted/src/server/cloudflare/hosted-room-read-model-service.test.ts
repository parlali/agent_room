import { describe, expect, it } from 'vitest'
import type { D1Database } from '@cloudflare/workers-types'
import type { AgentRoomHostedEnv } from './bindings'
import type { HostedActor } from './hosted-auth'
import { listHostedUsage } from './hosted-room-read-model-service'

function usageRow(id: string, totalTokens: number, estimatedCostUsd: string) {
    return {
        id,
        roomId: 'room_1',
        sessionKey: 'thread_1',
        runId: 'run_1',
        jobId: null,
        kind: 'run',
        provider: 'openrouter',
        model: 'openrouter/auto',
        toolName: null,
        inputTokens: totalTokens,
        outputTokens: 0,
        cachedTokens: 0,
        reasoningTokens: null,
        totalTokens,
        durationMs: 100,
        activeDurationMs: 100,
        idleDurationMs: 0,
        estimatedCostUsd,
        metadata: '{}',
        createdAt: '2026-06-24T00:00:00.000Z',
    }
}

describe('hosted room read model usage', () => {
    it('returns persisted aggregate totals rather than page totals', async () => {
        const binds: unknown[][] = []
        const db = {
            prepare: (sql: string) => ({
                bind: (...args: unknown[]) => {
                    binds.push(args)
                    return {
                        all: async () => ({
                            results: [
                                usageRow('usage_1', 10, '0.01'),
                                usageRow('usage_2', 20, '0.02'),
                            ],
                        }),
                        first: async () =>
                            /COUNT\(\*\)/.test(sql)
                                ? {
                                      eventCount: 3,
                                      durationMs: 600,
                                      totalTokens: 60,
                                      estimatedCostUsd: 0.06,
                                      unknownTokenEvents: 0,
                                  }
                                : null,
                    }
                },
            }),
        }
        const actor = {
            workspaceId: 'workspace_1',
            userId: 'user_1',
        } as HostedActor

        const usage = await listHostedUsage({
            env: {
                AGENT_ROOM_DB: db as unknown as D1Database,
            } as AgentRoomHostedEnv,
            actor,
            roomId: 'room_1',
            limit: 2,
        })

        expect(usage.events).toHaveLength(2)
        expect(usage.totals).toEqual({
            eventCount: 3,
            durationMs: 600,
            totalTokens: 60,
            estimatedCostUsd: 0.06,
            unknownTokenEvents: 0,
        })
        expect(binds).toEqual([
            ['workspace_1', 'room_1', 2],
            ['workspace_1', 'room_1'],
        ])
    })

    it('preserves unknown aggregate token and cost semantics for workspace-wide totals', async () => {
        const binds: unknown[][] = []
        const db = {
            prepare: (sql: string) => ({
                bind: (...args: unknown[]) => {
                    binds.push(args)
                    return {
                        all: async () => ({
                            results: [],
                        }),
                        first: async () =>
                            /COUNT\(\*\)/.test(sql)
                                ? {
                                      eventCount: 2,
                                      durationMs: null,
                                      totalTokens: null,
                                      estimatedCostUsd: null,
                                      unknownTokenEvents: 2,
                                  }
                                : null,
                    }
                },
            }),
        }
        const actor = {
            workspaceId: 'workspace_1',
            userId: 'user_1',
        } as HostedActor

        const usage = await listHostedUsage({
            env: {
                AGENT_ROOM_DB: db as unknown as D1Database,
            } as AgentRoomHostedEnv,
            actor,
            limit: 2,
        })

        expect(usage.totals).toEqual({
            eventCount: 2,
            durationMs: null,
            totalTokens: null,
            estimatedCostUsd: null,
            unknownTokenEvents: 2,
        })
        expect(binds).toEqual([['workspace_1', 2], ['workspace_1']])
    })
})
