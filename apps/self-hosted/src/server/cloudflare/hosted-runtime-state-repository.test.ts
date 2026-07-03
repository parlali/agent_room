import type { D1Database } from '@cloudflare/workers-types'
import { describe, expect, it } from 'vitest'
import { sanitizeRuntimeError } from '#/domain/runtime-error'
import type { AgentRoomHostedEnv } from './bindings'
import {
    evaluateHostedRuntimeAccess,
    hostedRuntimeAccessDeniedMessage,
} from './hosted-runtime-access'
import { hostedTestEnv } from './hosted-env-test-support'
import {
    countActiveHostedRuntimesForWorkspace,
    hostedRuntimeStartingActiveWindowMs,
    markHostedRuntimeContainerStopped,
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

    it('returns the live room count reported by the database', async () => {
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

    it('counts only running rooms and starting rooms younger than the bounded window, so slept and stale rooms free the cap', async () => {
        let capturedSql = ''
        let capturedArgs: unknown[] = []
        const captureEnv: AgentRoomHostedEnv = {
            ...hostedEnv({}),
            AGENT_ROOM_DB: {
                prepare: (sql: string) => ({
                    bind: (...args: unknown[]) => {
                        capturedSql = sql
                        capturedArgs = args
                        return {
                            sql,
                            args,
                            first: async () => ({ activeCount: 0 }),
                        }
                    },
                }),
            } as unknown as D1Database,
        }
        const now = new Date('2026-07-02T12:00:00.000Z')
        await countActiveHostedRuntimesForWorkspace({
            env: captureEnv,
            workspaceId: 'workspace_1',
            excludeRoomId: 'room_x',
            now,
        })
        expect(capturedSql).toMatch(/status = 'running'/)
        expect(capturedSql).toMatch(/status = 'starting' AND updated_at >= \?3/)
        expect(capturedSql).not.toMatch(/IN \('starting', 'running'\)/)
        expect(capturedArgs[2]).toBe(
            new Date(now.getTime() - hostedRuntimeStartingActiveWindowMs).toISOString(),
        )
    })
})

describe('hosted runtime container stop transition', () => {
    function captureBatchEnv(input: { batchChanges: number[] }): {
        env: AgentRoomHostedEnv
        statements: Array<{ sql: string; args: unknown[] }>
    } {
        const statements: Array<{ sql: string; args: unknown[] }> = []
        const env = hostedTestEnv({
            AGENT_ROOM_DB: {
                prepare: (sql: string) => ({
                    bind: (...args: unknown[]) => ({ sql, args }),
                }),
                batch: async (batched: Array<{ sql: string; args: unknown[] }>) => {
                    statements.push(...batched)
                    return batched.map((_, index) => ({
                        success: true,
                        meta: {
                            changes: input.batchChanges[index] ?? 0,
                        },
                        results: [],
                    }))
                },
            } as unknown as D1Database,
        })
        return { env, statements }
    }

    it('moves a running room to stopped without touching desired_state and guards both writes on running status', async () => {
        const { env, statements } = captureBatchEnv({ batchChanges: [1, 1] })
        const transitioned = await markHostedRuntimeContainerStopped({
            env,
            workspaceId: 'workspace_1',
            roomId: 'room_1',
            now: new Date(0).toISOString(),
        })
        expect(transitioned).toBe(true)
        expect(statements).toHaveLength(2)
        expect(statements[0].sql).toMatch(/UPDATE hosted_room_runtime_state/)
        expect(statements[0].sql).toMatch(/health_status = 'unknown'/)
        expect(statements[0].sql).toMatch(/hosted_room\.status = 'running'/)
        expect(statements[1].sql).toMatch(/UPDATE hosted_room/)
        expect(statements[1].sql).toMatch(/SET status = 'stopped'/)
        expect(statements[1].sql).toMatch(/AND status = 'running'/)
        expect(statements[1].sql).not.toMatch(/desired_state/)
    })

    it('is a no-op instead of failing when the room already left running status, so a concurrent restart is never clobbered', async () => {
        const { env } = captureBatchEnv({ batchChanges: [0, 0] })
        const transitioned = await markHostedRuntimeContainerStopped({
            env,
            workspaceId: 'workspace_1',
            roomId: 'room_1',
        })
        expect(transitioned).toBe(false)
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
        expect(
            atCapWithoutSelf.allowed === false &&
                atCapWithoutSelf.reason === 'room_limit' &&
                atCapWithoutSelf.maxConcurrentRooms,
        ).toBe(3)
    })

    it('produces plain-language denial messages that survive the runtime error sanitizer', () => {
        const roomLimitMessage = hostedRuntimeAccessDeniedMessage('room_limit', 3)
        expect(roomLimitMessage).toBe(
            'Room limit reached (3 rooms running). Pause a room to create or start another one.',
        )
        expect(sanitizeRuntimeError(roomLimitMessage)).toBe(roomLimitMessage)

        const genericRoomLimitMessage = hostedRuntimeAccessDeniedMessage('room_limit')
        expect(sanitizeRuntimeError(genericRoomLimitMessage)).toBe(genericRoomLimitMessage)

        const subscriptionMessage = hostedRuntimeAccessDeniedMessage('no_subscription')
        expect(sanitizeRuntimeError(subscriptionMessage)).toBe(subscriptionMessage)
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
