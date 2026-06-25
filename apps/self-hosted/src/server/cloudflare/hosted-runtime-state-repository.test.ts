import type { D1Database, R2Bucket } from '@cloudflare/workers-types'
import { describe, expect, it } from 'vitest'
import type { AgentRoomHostedEnv } from './bindings'
import { evaluateHostedRuntimeAccess } from './hosted-runtime-access'
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
    return {
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
        AGENT_ROOM_WORKSPACE_BUCKET: {} as R2Bucket,
        AGENT_ROOM_RUNTIME_JOBS: {} as AgentRoomHostedEnv['AGENT_ROOM_RUNTIME_JOBS'],
        AGENT_ROOM_RUNTIME: {} as AgentRoomHostedEnv['AGENT_ROOM_RUNTIME'],
        AGENT_ROOM_AUTH_MODE: 'better-auth',
        AGENT_ROOM_BILLING_PLANS:
            '[{"key":"starter","priceId":"price_test_starter_000000","monthlyCents":700,"includedCents":0}]',
        AGENT_ROOM_BILLING_USAGE_MARKUP_BPS: '13000',
        AGENT_ROOM_BILLING_TAX_MODE: 'automatic',
        AGENT_ROOM_BILLING_MAX_CONCURRENT_ROOMS: '3',
        AGENT_ROOM_RUNTIME_BACKEND: 'cloudflare-containers',
        AGENT_ROOM_RUNTIME_STORAGE: 'r2',
        BETTER_AUTH_SECRET: 'a'.repeat(32),
        BETTER_AUTH_URL: 'https://rooms.example.test',
        AGENT_ROOM_HOSTED_ENCRYPTION_KEY_B64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        GOOGLE_CLIENT_ID: 'google-client',
        GOOGLE_CLIENT_SECRET: 'google-secret',
        STRIPE_SECRET_KEY: 'stripe-secret-test-value',
        STRIPE_WEBHOOK_SECRET: 'stripe-webhook-test-value',
        STRIPE_CREDIT_TOPUP_PRICE_ID: 'price_test_topup_000000',
        AGENT_ROOM_EMAIL_WEBHOOK_URL: 'https://mail.example.test/send',
        AGENT_ROOM_EMAIL_WEBHOOK_BEARER_TOKEN: 'b'.repeat(16),
        AGENT_ROOM_EMAIL_FROM: 'Agent Room <noreply@example.test>',
        AGENT_ROOM_HOSTED_OPENROUTER_API_KEY: 'openrouter-platform-key',
        AGENT_ROOM_HOSTED_BRAVE_API_KEY: 'brave-platform-key',
    }
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
    it('allows a room at the cap when excludeRoomId removes it from the active count', async () => {
        function envWithCounts(input: {
            billingAccountRow: unknown
            countRow: unknown
        }): AgentRoomHostedEnv {
            return {
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
                AGENT_ROOM_WORKSPACE_BUCKET: {} as R2Bucket,
                AGENT_ROOM_RUNTIME_JOBS: {} as AgentRoomHostedEnv['AGENT_ROOM_RUNTIME_JOBS'],
                AGENT_ROOM_RUNTIME: {} as AgentRoomHostedEnv['AGENT_ROOM_RUNTIME'],
                AGENT_ROOM_AUTH_MODE: 'better-auth',
                AGENT_ROOM_BILLING_PLANS:
                    '[{"key":"standard","priceId":"price_std","monthlyCents":2000,"includedCents":1200}]',
                STRIPE_SECRET_KEY: 'stripe-secret-test-value',
                STRIPE_WEBHOOK_SECRET: 'stripe-webhook-test-value',
                STRIPE_CREDIT_TOPUP_PRICE_ID: 'price_test_topup_000000',
                AGENT_ROOM_BILLING_USAGE_MARKUP_BPS: '13000',
                AGENT_ROOM_BILLING_TAX_MODE: 'automatic',
                AGENT_ROOM_BILLING_MAX_CONCURRENT_ROOMS: '3',
                AGENT_ROOM_RUNTIME_BACKEND: 'cloudflare-containers',
                AGENT_ROOM_RUNTIME_STORAGE: 'r2',
                BETTER_AUTH_SECRET: 'a'.repeat(32),
                BETTER_AUTH_URL: 'https://rooms.example.test',
                AGENT_ROOM_HOSTED_ENCRYPTION_KEY_B64:
                    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
                AGENT_ROOM_EMAIL_WEBHOOK_URL: 'https://mail.example.test/send',
                AGENT_ROOM_EMAIL_WEBHOOK_BEARER_TOKEN: 'b'.repeat(16),
                AGENT_ROOM_EMAIL_FROM: 'Agent Room <noreply@example.test>',
                AGENT_ROOM_HOSTED_OPENROUTER_API_KEY: 'openrouter-platform-key',
                AGENT_ROOM_HOSTED_BRAVE_API_KEY: 'brave-platform-key',
            }
        }

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
            codexAvailable: false,
            userKeyAvailable: false,
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
            codexAvailable: false,
            userKeyAvailable: false,
        })
        expect(atCapWithoutSelf.allowed).toBe(false)
        expect(atCapWithoutSelf.allowed === false && atCapWithoutSelf.reason).toBe('room_limit')
    })
})
