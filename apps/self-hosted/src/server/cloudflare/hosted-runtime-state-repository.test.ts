import type { D1Database } from '@cloudflare/workers-types'
import { describe, expect, it } from 'vitest'
import type { AgentRoomHostedEnv } from './bindings'
import { evaluateHostedRuntimeAccess } from './hosted-runtime-access'
import { hostedTestEnv } from './hosted-env-test-support'
import {
    countActiveHostedRuntimesForWorkspace,
    writeHostedRuntimeStateTransition,
} from './hosted-runtime-state-repository'

interface RuntimeStatement {
    sql: string
    args: unknown[]
    first?: () => Promise<unknown>
}

function hostedEnv(input: { batchChanges?: number[]; countRow?: unknown }): AgentRoomHostedEnv {
    return hostedTestEnv({
        AGENT_ROOM_DB: {
            prepare: (sql: string) => ({
                bind: (...args: unknown[]): RuntimeStatement => ({
                    sql,
                    args,
                    first: async () => input.countRow ?? null,
                }),
            }),
            batch: async (statements: RuntimeStatement[]) =>
                statements.map((_, index) => ({
                    success: true,
                    meta: {
                        changes: input.batchChanges?.[index] ?? 1,
                    },
                    results: [],
                })),
        } as unknown as D1Database,
    })
}

describe('hosted runtime state repository', () => {
    it('fails closed when a runtime state transition updates no runtime row', async () => {
        await expect(
            writeHostedRuntimeStateTransition({
                env: hostedEnv({
                    batchChanges: [0, 1],
                }),
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                transition: {
                    kind: 'starting',
                },
                now: new Date(0).toISOString(),
            }),
        ).rejects.toThrow(/statement 1/)
    })

    it('fails closed when a runtime state transition updates no room row', async () => {
        await expect(
            writeHostedRuntimeStateTransition({
                env: hostedEnv({
                    batchChanges: [1, 0],
                }),
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                transition: {
                    kind: 'running',
                },
                now: new Date(0).toISOString(),
            }),
        ).rejects.toThrow(/statement 2/)
    })

    it('counts hosted rooms in starting or running states for the workspace', async () => {
        const count = await countActiveHostedRuntimesForWorkspace({
            env: hostedEnv({ countRow: { activeCount: 2 } }),
            workspaceId: 'workspace_1',
            excludeRoomId: 'room_excluded',
        })
        expect(count).toBe(2)
    })

    it('returns zero active runtimes when no rows match', async () => {
        const count = await countActiveHostedRuntimesForWorkspace({
            env: hostedEnv({ countRow: null }),
            workspaceId: 'workspace_1',
            excludeRoomId: 'room_excluded',
        })
        expect(count).toBe(0)
    })

    it('passes excludeRoomId as a bind argument so the named room is excluded from the active count', async () => {
        let capturedArgs: unknown[] = []
        const captureEnv: AgentRoomHostedEnv = {
            ...hostedEnv({ countRow: { activeCount: 2 } }),
            AGENT_ROOM_DB: {
                prepare: (sql: string) => ({
                    bind: (...args: unknown[]) => {
                        capturedArgs = args
                        return {
                            sql,
                            args,
                            first: async () => ({ activeCount: 2 }),
                        }
                    },
                }),
            } as unknown as D1Database,
        }
        await countActiveHostedRuntimesForWorkspace({
            env: captureEnv,
            workspaceId: 'workspace_1',
            excludeRoomId: 'room_x',
        })
        expect(capturedArgs[0]).toBe('workspace_1')
        expect(capturedArgs[1]).toBe('room_x')
    })
})

describe('hosted runtime access room-cap self-exclusion', () => {
    function envWithCounts(input: {
        billingAccountRow: unknown
        countRow: unknown
    }): AgentRoomHostedEnv {
        return hostedTestEnv({
            AGENT_ROOM_DB: {
                prepare: (sql: string) => ({
                    bind: (...args: unknown[]) => ({
                        sql,
                        args,
                        first: async () => {
                            if (/FROM\s+hosted_billing_account/.test(sql)) {
                                return input.billingAccountRow
                            }
                            if (/COUNT/.test(sql)) {
                                return input.countRow
                            }
                            return null
                        },
                    }),
                }),
            } as unknown as D1Database,
        })
    }

    it('allows a room at the cap when excludeRoomId removes it from the active count', async () => {
        const atCapWithSelf = await evaluateHostedRuntimeAccess({
            env: envWithCounts({
                billingAccountRow: {
                    planStatus: 'active',
                    planKey: 'standard',
                    workspaceId: 'workspace_1',
                    stripeCustomerId: null,
                    stripeSubscriptionId: null,
                    includedBalanceCents: 0,
                    purchasedBalanceCents: 0,
                    includedMonthlyCreditCents: 0,
                    createdAt: '',
                    updatedAt: '',
                },
                countRow: { activeCount: 2 },
            }),
            workspaceId: 'workspace_1',
            roomId: 'room_x',
        })
        expect(atCapWithSelf.allowed).toBe(true)

        const atCapWithoutSelf = await evaluateHostedRuntimeAccess({
            env: envWithCounts({
                billingAccountRow: {
                    planStatus: 'active',
                    planKey: 'standard',
                    workspaceId: 'workspace_1',
                    stripeCustomerId: null,
                    stripeSubscriptionId: null,
                    includedBalanceCents: 0,
                    purchasedBalanceCents: 0,
                    includedMonthlyCreditCents: 0,
                    createdAt: '',
                    updatedAt: '',
                },
                countRow: { activeCount: 3 },
            }),
            workspaceId: 'workspace_1',
            roomId: 'room_x',
        })
        expect(atCapWithoutSelf.allowed).toBe(false)
        expect(atCapWithoutSelf.allowed === false && atCapWithoutSelf.reason).toBe('room_limit')
    })

    it('denies runtime access when a workspace has no active subscription', async () => {
        const decision = await evaluateHostedRuntimeAccess({
            env: envWithCounts({
                billingAccountRow: {
                    planStatus: 'none',
                    planKey: 'starter',
                    workspaceId: 'workspace_1',
                    stripeCustomerId: null,
                    stripeSubscriptionId: null,
                    includedBalanceCents: 0,
                    purchasedBalanceCents: 2000,
                    includedMonthlyCreditCents: 0,
                    createdAt: '',
                    updatedAt: '',
                },
                countRow: { activeCount: 0 },
            }),
            workspaceId: 'workspace_1',
            roomId: 'room_x',
        })

        expect(decision.allowed).toBe(false)
        expect(decision.allowed === false && decision.reason).toBe('no_subscription')
    })
})
