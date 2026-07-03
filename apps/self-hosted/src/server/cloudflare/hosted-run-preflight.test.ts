import type { D1Database } from '@cloudflare/workers-types'
import { describe, expect, it } from 'vitest'
import type { AgentRoomHostedEnv } from './bindings'
import { assertHostedRunAllowed } from './hosted-execution-context'
import { hostedTestEnv } from './hosted-env-test-support'

interface SeededAccount {
    workspaceId: string
    stripeCustomerId: string | null
    stripeSubscriptionId: string | null
    planKey: string
    planStatus: string
    billingFrozen: number
    includedBalanceCents: number
    purchasedBalanceCents: number
    includedReservedCents: number
    purchasedReservedCents: number
    includedMonthlyCreditCents: number
    createdAt: string
    updatedAt: string
}

class FakePreflightD1 {
    statements: string[] = []
    account: SeededAccount

    constructor(input: { includedBalanceCents: number }) {
        this.account = {
            workspaceId: 'workspace_1',
            stripeCustomerId: null,
            stripeSubscriptionId: null,
            planKey: 'starter',
            planStatus: 'active',
            billingFrozen: 0,
            includedBalanceCents: input.includedBalanceCents,
            purchasedBalanceCents: 0,
            includedReservedCents: 0,
            purchasedReservedCents: 0,
            includedMonthlyCreditCents: 0,
            createdAt: '1970-01-01T00:00:00.000Z',
            updatedAt: '1970-01-01T00:00:00.000Z',
        }
    }

    countStatements(pattern: RegExp): number {
        return this.statements.filter((sql) => pattern.test(sql)).length
    }

    prepare(sql: string) {
        this.statements.push(sql)
        return {
            bind: (..._args: unknown[]) => ({
                first: async <T>() => this.first<T>(sql),
                all: async <T>() => this.all<T>(sql),
                run: async () => this.run(sql),
            }),
        }
    }

    private async first<T>(sql: string): Promise<T | null> {
        if (/FROM hosted_billing_account/.test(sql)) {
            return this.account as unknown as T
        }
        return null
    }

    private async all<T>(sql: string): Promise<{ results: T[] }> {
        if (/hosted_quota_counter/.test(sql) && /WITH wanted/.test(sql)) {
            return { results: [] as T[] }
        }
        return { results: [] as T[] }
    }

    private async run(sql: string) {
        if (/INSERT INTO hosted_quota_counter/.test(sql) && /WITH increments/.test(sql)) {
            return {
                success: true,
                meta: {
                    changes: 1,
                },
                results: [],
            }
        }
        return {
            success: true,
            meta: {
                changes: 0,
            },
            results: [],
        }
    }
}

function preflightEnv(db: FakePreflightD1): AgentRoomHostedEnv {
    return hostedTestEnv({
        AGENT_ROOM_DB: db as unknown as D1Database,
    })
}

describe('hosted run preflight round trips', () => {
    it('runs the warm managed-model preflight without the removed billing and quota reads', async () => {
        const db = new FakePreflightD1({ includedBalanceCents: 100000 })
        const env = preflightEnv(db)

        await assertHostedRunAllowed({
            env,
            workspaceId: 'workspace_1',
            roomId: 'room_1',
            actorUserId: 'user_1',
            sessionKey: 'session_1',
            resolvedProviderCandidate: 'hosted_openrouter',
        })

        expect(db.statements).toHaveLength(5)
        expect(db.countStatements(/FROM hosted_room_runtime_state/)).toBe(0)
        expect(db.countStatements(/FROM hosted_billing_reservation/)).toBe(0)
        expect(db.countStatements(/SELECT[\s\S]*FROM hosted_billing_account/)).toBe(1)
        expect(db.countStatements(/hosted_quota_policy/)).toBe(1)
        expect(db.countStatements(/WITH wanted/)).toBe(1)
        expect(db.countStatements(/FROM hosted_quota_counter\s+WHERE/)).toBe(0)
        expect(db.countStatements(/WITH increments/)).toBe(1)
    })

    it('denies on exhausted balance before consuming any quota counter', async () => {
        const db = new FakePreflightD1({ includedBalanceCents: 0 })
        const env = preflightEnv(db)

        await expect(
            assertHostedRunAllowed({
                env,
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                actorUserId: 'user_1',
                sessionKey: 'session_1',
                resolvedProviderCandidate: 'hosted_openrouter',
            }),
        ).rejects.toThrow('Hosted billing balance is exhausted')

        expect(db.countStatements(/WITH increments/)).toBe(0)
    })
})
