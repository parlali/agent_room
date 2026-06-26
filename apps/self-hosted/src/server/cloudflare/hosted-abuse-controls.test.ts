import type { D1Database } from '@cloudflare/workers-types'
import { describe, expect, it, vi } from 'vitest'
import type { AgentRoomHostedEnv } from './bindings'
import {
    assertHostedQuotaAllowed,
    HostedQuotaDeniedError,
    hostedQuotaDeniedResponse,
} from './hosted-abuse-controls'
import { hostedTestEnv } from './hosted-env-test-support'

interface QuotaPolicyRow {
    status: 'active' | 'restricted' | 'suspended'
    limits: string
    restrictions: string
}

interface QuotaEventRow {
    scope: string
    action: string
    reason: string | null
}

interface AuditEventRow {
    action: string
}

interface UsageEventRow {
    kind: string
    billingStatus: string
}

class FakeQuotaD1 {
    policy: QuotaPolicyRow | null = null
    failPolicyRead = false
    activeWorkspaceBrowserbaseSessions = 0
    activeRoomBrowserbaseSessions = 0
    workspaceStorageBytes = 0
    roomStorageBytes = 0
    counters = new Map<string, number>()
    quotaEvents: QuotaEventRow[] = []
    auditEvents: AuditEventRow[] = []
    usageEvents: UsageEventRow[] = []

    prepare(sql: string) {
        return {
            bind: (...args: unknown[]) => this.statement(sql, args),
        }
    }

    private statement(sql: string, args: unknown[]) {
        return {
            first: async <T>() => this.first<T>(sql, args),
            all: async <T>() => ({ results: [] as T[] }),
            run: async () => this.run(sql, args),
        }
    }

    private async first<T>(sql: string, args: unknown[]): Promise<T | null> {
        if (/FROM hosted_quota_policy/.test(sql)) {
            if (this.failPolicyRead) {
                throw new Error('quota policy unavailable')
            }
            return this.policy as T | null
        }
        if (/FROM hosted_quota_counter/.test(sql)) {
            return {
                quantity: this.counters.get(counterKey(args)) ?? 0,
            } as T
        }
        if (/FROM hosted_browserbase_session/.test(sql)) {
            return {
                activeCount: /room_id = \?2/.test(sql)
                    ? this.activeRoomBrowserbaseSessions
                    : this.activeWorkspaceBrowserbaseSessions,
            } as T
        }
        if (/FROM hosted_room_file_index/.test(sql)) {
            return {
                byteLength: /room_id = \?2/.test(sql)
                    ? this.roomStorageBytes
                    : this.workspaceStorageBytes,
            } as T
        }
        return null
    }

    private async run(sql: string, args: unknown[]) {
        if (/INSERT INTO hosted_quota_counter/.test(sql)) {
            return this.incrementCounter(args)
        }
        if (/INSERT INTO hosted_quota_event/.test(sql)) {
            this.quotaEvents.push({
                scope: String(args[4]),
                action: String(args[6]),
                reason: args[7] === null ? null : String(args[7]),
            })
        } else if (/INSERT INTO hosted_audit_event/.test(sql)) {
            this.auditEvents.push({
                action: String(args[3]),
            })
        } else if (/INSERT INTO hosted_usage_event/.test(sql)) {
            this.usageEvents.push({
                kind: String(args[6]),
                billingStatus: String(args[20]),
            })
        }
        return {
            success: true,
            meta: {
                changes: 1,
            },
            results: [],
        }
    }

    private incrementCounter(args: unknown[]) {
        const key = counterKey(args)
        const amount = Number(args[4])
        const limit = Number(args[6])
        const current = this.counters.get(key) ?? 0
        if (amount > limit || current + amount > limit) {
            return {
                success: true,
                meta: {
                    changes: 0,
                },
                results: [],
            }
        }
        this.counters.set(key, current + amount)
        return {
            success: true,
            meta: {
                changes: 1,
            },
            results: [],
        }
    }
}

function counterKey(args: unknown[]): string {
    return [args[0], args[1], args[2], args[3]].map(String).join('\u0000')
}

function quotaEnv(
    db: FakeQuotaD1,
    overrides: Partial<AgentRoomHostedEnv> = {},
): AgentRoomHostedEnv {
    return hostedTestEnv({
        AGENT_ROOM_DB: db as unknown as D1Database,
        ...overrides,
    })
}

async function expectDenied(run: () => Promise<void>): Promise<HostedQuotaDeniedError> {
    try {
        await run()
    } catch (error) {
        expect(error).toBeInstanceOf(HostedQuotaDeniedError)
        return error as HostedQuotaDeniedError
    }
    throw new Error('Expected hosted quota denial')
}

describe('hosted abuse controls', () => {
    it('fails closed under operator kill switches and records sanitized blocked usage', async () => {
        const db = new FakeQuotaD1()
        const env = quotaEnv(db, {
            AGENT_ROOM_HOSTED_DISABLE_HOSTED_MODELS: 'true',
        })

        const error = await expectDenied(() =>
            assertHostedQuotaAllowed({
                env,
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                action: 'provider_openrouter',
                providerPath: '/chat/completions',
                amount: {
                    count: 1,
                    cents: 1,
                },
            }),
        )

        expect(error.decision.reason).toBe('capability_disabled')
        expect(db.quotaEvents).toEqual([
            {
                scope: 'workspace',
                action: 'provider_openrouter',
                reason: 'capability_disabled',
            },
        ])
        expect(db.auditEvents).toEqual([{ action: 'hosted_quota.denied' }])
        expect(db.usageEvents).toEqual([{ kind: 'provider', billingStatus: 'blocked' }])
        expect(db.counters.size).toBe(0)
        const response = hostedQuotaDeniedResponse(error)
        if (!response) {
            throw new Error('Expected hosted quota denial response')
        }
        expect(response.status).toBe(403)
        await expect(response.json()).resolves.toMatchObject({
            code: 'hosted_quota_denied',
            reason: 'capability_disabled',
        })
    })

    it('consumes bounded counters and denies later work in the same window', async () => {
        const db = new FakeQuotaD1()
        db.policy = {
            status: 'active',
            limits: JSON.stringify({
                maxWorkspaceRunStartsPerMinute: 1,
            }),
            restrictions: '{}',
        }
        const env = quotaEnv(db)
        const now = new Date('2026-01-01T00:00:30.000Z')

        await assertHostedQuotaAllowed({
            env,
            workspaceId: 'workspace_1',
            roomId: 'room_1',
            action: 'run_start',
            amount: {
                count: 1,
            },
            now,
        })
        const error = await expectDenied(() =>
            assertHostedQuotaAllowed({
                env,
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                action: 'run_start',
                amount: {
                    count: 1,
                },
                now,
            }),
        )

        expect(error.decision.reason).toBe('scope_rate_limited')
        expect(error.decision.scope).toBe('workspace')
        expect(error.decision.current).toBe(1)
    })

    it('denies Browserbase session starts at active workspace concurrency cap', async () => {
        const db = new FakeQuotaD1()
        db.activeWorkspaceBrowserbaseSessions = 1
        db.policy = {
            status: 'active',
            limits: JSON.stringify({
                maxWorkspaceBrowserbaseActiveSessions: 1,
            }),
            restrictions: '{}',
        }
        const env = quotaEnv(db)

        const error = await expectDenied(() =>
            assertHostedQuotaAllowed({
                env,
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                action: 'browserbase_session_start',
                amount: {
                    count: 1,
                },
            }),
        )

        expect(error.decision.reason).toBe('concurrency_limit')
        expect(db.counters.size).toBe(0)
    })

    it('fails closed when quota state cannot be read', async () => {
        const db = new FakeQuotaD1()
        db.failPolicyRead = true
        const env = quotaEnv(db)
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
            const error = await expectDenied(() =>
                assertHostedQuotaAllowed({
                    env,
                    workspaceId: 'workspace_1',
                    roomId: 'room_1',
                    action: 'run_start',
                }),
            )

            expect(error.decision.reason).toBe('quota_unavailable')
            expect(db.usageEvents).toEqual([{ kind: 'run', billingStatus: 'blocked' }])
        } finally {
            consoleError.mockRestore()
        }
    })
})
