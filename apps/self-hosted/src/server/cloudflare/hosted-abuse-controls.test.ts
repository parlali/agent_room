import type { D1Database } from '@cloudflare/workers-types'
import { describe, expect, it, vi } from 'vitest'
import type { AgentRoomHostedEnv } from './bindings'
import {
    assertHostedQuotaAllowed,
    HostedQuotaDeniedError,
    hostedQuotaDeniedResponse,
    readHostedQuotaPolicy,
    recordHostedProviderSpend,
    refundHostedProviderSpend,
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
    beforeCounterWrite: (() => void) | null = null
    forceCounterWriteMiss = false
    failUsageEventWrite = false
    quotaEvents: QuotaEventRow[] = []
    auditEvents: AuditEventRow[] = []
    usageEvents: UsageEventRow[] = []
    statements: string[] = []

    prepare(sql: string) {
        this.statements.push(sql)
        return {
            bind: (...args: unknown[]) => this.statement(sql, args),
        }
    }

    countStatements(pattern: RegExp): number {
        return this.statements.filter((sql) => pattern.test(sql)).length
    }

    private statement(sql: string, args: unknown[]) {
        return {
            first: async <T>() => this.first<T>(sql, args),
            all: async <T>() => this.all<T>(sql, args),
            run: async () => this.run(sql, args),
        }
    }

    private async all<T>(sql: string, args: unknown[]): Promise<{ results: T[] }> {
        if (/hosted_quota_counter/.test(sql) && /WITH wanted/.test(sql)) {
            const results: Array<{ idx: number; quantity: number }> = []
            for (let offset = 0; offset + 5 <= args.length; offset += 5) {
                const key = counterKey(args, offset + 1)
                results.push({
                    idx: Number(args[offset]),
                    quantity: this.counters.get(key) ?? 0,
                })
            }
            return { results: results as unknown as T[] }
        }
        return { results: [] as T[] }
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

    async batch(statements: Array<{ run: () => Promise<unknown> }>) {
        const results = []
        for (const statement of statements) {
            results.push(await statement.run())
        }
        return results
    }

    private async run(sql: string, args: unknown[]) {
        if (/INSERT INTO hosted_quota_counter/.test(sql)) {
            if (/WITH increments/.test(sql)) {
                return this.incrementCounters(args)
            }
            return this.upsertCounters(args)
        }
        if (/UPDATE hosted_quota_counter/.test(sql)) {
            return this.refundCounter(args)
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
            if (this.failUsageEventWrite) {
                throw new Error('usage event write failed')
            }
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

    private upsertCounters(args: unknown[]) {
        for (let index = 0; index < args.length; index += 6) {
            const key = counterKey(args, index)
            this.counters.set(key, (this.counters.get(key) ?? 0) + Number(args[index + 4]))
        }
        return {
            success: true,
            meta: {
                changes: args.length / 6,
            },
            results: [],
        }
    }

    private refundCounter(args: unknown[]) {
        const key = counterKey(args)
        const current = this.counters.get(key)
        if (current !== undefined) {
            this.counters.set(key, Math.max(0, current - Number(args[4])))
        }
        return {
            success: true,
            meta: {
                changes: current === undefined ? 0 : 1,
            },
            results: [],
        }
    }

    private incrementCounters(args: unknown[]) {
        this.beforeCounterWrite?.()
        this.beforeCounterWrite = null
        if (this.forceCounterWriteMiss) {
            return {
                success: true,
                meta: {
                    changes: 0,
                },
                results: [],
            }
        }
        const next = new Map(this.counters)
        for (let index = 0; index < args.length; index += 7) {
            const key = counterKey(args, index)
            const amount = Number(args[index + 4])
            const limit = Number(args[index + 6])
            const current = next.get(key) ?? 0
            if (amount > limit || current + amount > limit) {
                return {
                    success: true,
                    meta: {
                        changes: 0,
                    },
                    results: [],
                }
            }
            next.set(key, current + amount)
        }
        this.counters = next
        return {
            success: true,
            meta: {
                changes: args.length / 7,
            },
            results: [],
        }
    }
}

function counterKey(args: unknown[], offset = 0): string {
    return [args[offset], args[offset + 1], args[offset + 2], args[offset + 3]]
        .map(String)
        .join('\u0000')
}

function runStartCounterKey(input: {
    scope: 'workspace' | 'room' | 'ip'
    scopeId: string
    now: Date
}): string {
    return [input.scope, input.scopeId, `${input.now.toISOString().slice(0, 16)}Z`, 'run_starts']
        .map(String)
        .join('\u0000')
}

function stateSyncCounterKey(input: {
    scope: 'workspace' | 'room'
    scopeId: string
    now: Date
}): string {
    return [
        input.scope,
        input.scopeId,
        `${input.now.toISOString().slice(0, 16)}Z`,
        'state_syncs',
    ].join(String.fromCharCode(0))
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

    it('reads every run_start counter in a single batched statement', async () => {
        const db = new FakeQuotaD1()
        db.policy = {
            status: 'active',
            limits: JSON.stringify({
                maxWorkspaceRunStartsPerMinute: 30,
                maxUserRunStartsPerMinute: 20,
                maxIpRunStartsPerMinute: 30,
                maxRoomRunStartsPerMinute: 10,
            }),
            restrictions: '{}',
        }
        const env = quotaEnv(db)
        const now = new Date('2026-01-01T00:00:30.000Z')

        await assertHostedQuotaAllowed({
            env,
            workspaceId: 'workspace_1',
            roomId: 'room_1',
            actorUserId: 'user_1',
            action: 'run_start',
            amount: {
                count: 1,
            },
            now,
        })

        expect(db.countStatements(/WITH wanted/)).toBe(1)
        expect(db.countStatements(/FROM hosted_quota_counter\s+WHERE/)).toBe(0)
        expect(db.countStatements(/hosted_quota_policy/)).toBe(1)
        expect(db.countStatements(/WITH increments/)).toBe(1)
    })

    it('does not read the quota policy when a prefetched policy is supplied', async () => {
        const db = new FakeQuotaD1()
        db.policy = {
            status: 'active',
            limits: JSON.stringify({
                maxWorkspaceRunStartsPerMinute: 30,
            }),
            restrictions: '{}',
        }
        const env = quotaEnv(db)
        const now = new Date('2026-01-01T00:00:30.000Z')
        const policy = await readHostedQuotaPolicy({
            env,
            workspaceId: 'workspace_1',
        })
        db.statements = []

        await assertHostedQuotaAllowed(
            {
                env,
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                actorUserId: 'user_1',
                action: 'run_start',
                amount: {
                    count: 1,
                },
                now,
            },
            { policy },
        )

        expect(db.countStatements(/hosted_quota_policy/)).toBe(0)
        expect(db.countStatements(/WITH wanted/)).toBe(1)
        expect(db.countStatements(/WITH increments/)).toBe(1)
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

    it('does not consume partial counters when a concurrent scope wins the quota race', async () => {
        const db = new FakeQuotaD1()
        db.policy = {
            status: 'active',
            limits: JSON.stringify({
                maxWorkspaceRunStartsPerMinute: 10,
                maxRoomRunStartsPerMinute: 1,
            }),
            restrictions: '{}',
        }
        const env = quotaEnv(db)
        const now = new Date('2026-01-01T00:00:30.000Z')
        const workspaceKey = runStartCounterKey({
            scope: 'workspace',
            scopeId: 'workspace_1',
            now,
        })
        const roomKey = runStartCounterKey({
            scope: 'room',
            scopeId: 'room_1',
            now,
        })
        db.beforeCounterWrite = () => {
            db.counters.set(roomKey, 1)
        }

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
        expect(error.decision.scope).toBe('room')
        expect(db.counters.get(roomKey)).toBe(1)
        expect(db.counters.get(workspaceKey) ?? 0).toBe(0)
    })

    it('fails closed when counter consumption does not report a committed rule set', async () => {
        const db = new FakeQuotaD1()
        db.forceCounterWriteMiss = true
        const env = quotaEnv(db)

        const error = await expectDenied(() =>
            assertHostedQuotaAllowed({
                env,
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                action: 'run_start',
            }),
        )

        expect(error.decision.reason).toBe('quota_unavailable')
        expect(db.counters.size).toBe(0)
    })

    it('counts actual written bytes for file-write counters instead of net storage growth', async () => {
        const db = new FakeQuotaD1()
        db.policy = {
            status: 'active',
            limits: JSON.stringify({
                maxWorkspaceFileWriteBytesPerDay: 5,
            }),
            restrictions: '{}',
        }
        const env = quotaEnv(db)

        const error = await expectDenied(() =>
            assertHostedQuotaAllowed({
                env,
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                action: 'runtime_file_sync',
                amount: {
                    bytes: 10,
                    storageBytes: 0,
                },
            }),
        )

        expect(error.decision.reason).toBe('storage_quota_exceeded')
        expect(error.decision.counterKey).toBe('file_write_bytes')
    })

    it('rate limits runtime state sync per minute and recovers once the window advances', async () => {
        const db = new FakeQuotaD1()
        db.policy = {
            status: 'active',
            limits: JSON.stringify({
                maxWorkspaceRuntimeStateSyncsPerMinute: 5,
                maxRoomRuntimeStateSyncsPerMinute: 2,
            }),
            restrictions: '{}',
        }
        const env = quotaEnv(db)
        const firstMinute = new Date('2026-07-04T00:00:30.000Z')
        const roomKey = stateSyncCounterKey({
            scope: 'room',
            scopeId: 'room_1',
            now: firstMinute,
        })
        db.counters.set(roomKey, 2)

        const error = await expectDenied(() =>
            assertHostedQuotaAllowed({
                env,
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                action: 'runtime_state_sync',
                amount: {
                    bytes: 4096,
                },
                now: firstMinute,
            }),
        )

        expect(error.decision.reason).toBe('scope_rate_limited')
        expect(error.decision.scope).toBe('room')
        expect(error.decision.counterKey).toBe('state_syncs')
        expect(error.decision.message).toBe(
            'This room is temporarily rate limited. It will recover shortly.',
        )
        expect(db.counters.get(roomKey)).toBe(2)

        const nextMinute = new Date('2026-07-04T00:01:05.000Z')
        await assertHostedQuotaAllowed({
            env,
            workspaceId: 'workspace_1',
            roomId: 'room_1',
            action: 'runtime_state_sync',
            amount: {
                bytes: 4096,
            },
            now: nextMinute,
        })

        const nextRoomKey = stateSyncCounterKey({
            scope: 'room',
            scopeId: 'room_1',
            now: nextMinute,
        })
        expect(db.counters.get(nextRoomKey)).toBe(1)
    })

    it('fails closed when persisted quota policy values are malformed', async () => {
        const db = new FakeQuotaD1()
        db.policy = {
            status: 'active',
            limits: JSON.stringify({
                maxWorkspaceRunStartsPerMinute: 'not-a-number',
            }),
            restrictions: '{}',
        }
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
            expect(db.counters.size).toBe(0)
        } finally {
            consoleError.mockRestore()
        }
    })

    it('fails closed when quota denial evidence cannot be recorded', async () => {
        const db = new FakeQuotaD1()
        db.failUsageEventWrite = true
        db.policy = {
            status: 'active',
            limits: JSON.stringify({
                maxWorkspaceRunStartsPerMinute: 0,
            }),
            restrictions: '{}',
        }
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
        } finally {
            consoleError.mockRestore()
        }
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

    it('refunds consumed spend counters after a failed provider call, bounded at zero', async () => {
        const db = new FakeQuotaD1()
        const env = quotaEnv(db)
        const now = new Date('2026-01-02T03:04:05.000Z')
        const spendInput = {
            env,
            workspaceId: 'workspace_1',
            roomId: 'room_1',
            runId: 'run_1',
            action: 'provider_brave' as const,
            cents: 2,
            now,
        }
        const dayKey = ['workspace', 'workspace_1', '2026-01-02', 'spend_cents'].join('\u0000')
        const monthKey = ['workspace', 'workspace_1', '2026-01', 'spend_cents'].join('\u0000')
        const runKey = ['runtime', 'workspace_1:run_1', 'run', 'spend_cents'].join('\u0000')

        await recordHostedProviderSpend(spendInput)
        expect(db.counters.get(dayKey)).toBe(2)
        expect(db.counters.get(monthKey)).toBe(2)
        expect(db.counters.get(runKey)).toBe(2)

        const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
        try {
            await refundHostedProviderSpend(spendInput)
            expect(db.counters.get(dayKey)).toBe(0)
            expect(db.counters.get(monthKey)).toBe(0)
            expect(db.counters.get(runKey)).toBe(0)

            await refundHostedProviderSpend({
                ...spendInput,
                cents: 5,
            })
            expect(db.counters.get(dayKey)).toBe(0)
            expect(db.counters.get(monthKey)).toBe(0)
            expect(db.counters.get(runKey)).toBe(0)
        } finally {
            consoleLog.mockRestore()
        }
    })
})
