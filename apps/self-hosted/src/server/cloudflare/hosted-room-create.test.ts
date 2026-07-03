import type { D1Database } from '@cloudflare/workers-types'
import { describe, expect, it } from 'vitest'
import { sanitizeRuntimeError } from '#/domain/runtime-error'
import type { AgentRoomHostedEnv } from './bindings'
import type { HostedActor } from './hosted-auth'
import { hostedTestEnv } from './hosted-env-test-support'
import { createHostedRoom } from './hosted-room-lifecycle-service'

function actor(): HostedActor {
    return {
        authProvider: 'better-auth',
        userId: 'user_1',
        sessionId: 'session_1',
        email: 'owner@example.test',
        workspaceId: 'workspace_1',
    }
}

function activeBillingAccountRow() {
    return {
        workspaceId: 'workspace_1',
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        planKey: 'standard',
        planStatus: 'active',
        includedBalanceCents: 0,
        purchasedBalanceCents: 0,
        includedReservedCents: 0,
        purchasedReservedCents: 0,
        includedMonthlyCreditCents: 0,
        createdAt: '',
        updatedAt: '',
    }
}

function createRoomEnv(input: {
    activeCount: number
    batchError?: Error
    roomRow?: Record<string, unknown> | null
}): AgentRoomHostedEnv {
    const statement = (sql: string, args: unknown[]) => ({
        sql,
        args,
        first: async () => {
            if (/FROM\s+hosted_billing_account/.test(sql)) {
                return activeBillingAccountRow()
            }
            if (/COUNT\(\*\) AS activeCount/.test(sql)) {
                return { activeCount: input.activeCount }
            }
            if (/FROM hosted_room\b/.test(sql) && /display_name AS displayName/.test(sql)) {
                return input.roomRow ?? null
            }
            return null
        },
        run: async () => ({
            success: true,
            meta: {
                changes: 1,
            },
            results: [],
        }),
    })
    return hostedTestEnv({
        AGENT_ROOM_DB: {
            prepare: (sql: string) => ({
                bind: (...args: unknown[]) => statement(sql, args),
            }),
            batch: async (statements: Array<{ sql: string }>) => {
                if (input.batchError) {
                    throw input.batchError
                }
                return statements.map(() => ({
                    success: true,
                    meta: {
                        changes: 1,
                    },
                    results: [],
                }))
            },
        } as unknown as D1Database,
    })
}

describe('createHostedRoom failure surfacing', () => {
    it('denies creation with a plain-language room limit message when three rooms are genuinely running', async () => {
        const env = createRoomEnv({ activeCount: 3 })
        const attempt = createHostedRoom({
            env,
            actor: actor(),
            displayName: 'Fourth Room',
        })
        await expect(attempt).rejects.toThrow(
            'Room limit reached (3 rooms running). Pause a room to create or start another one.',
        )
        await attempt.catch((error: Error) => {
            expect(sanitizeRuntimeError(error.message)).toBe(error.message)
        })
    })

    it('allows creating a fourth room when the other three rooms slept and no longer count as running', async () => {
        const env = createRoomEnv({
            activeCount: 0,
            roomRow: {
                id: 'room_4',
                slug: 'fourth-room',
                displayName: 'Fourth Room',
                status: 'stopped',
                desiredState: 'stopped',
                createdByUserId: 'user_1',
                createdAt: new Date(0).toISOString(),
                updatedAt: new Date(0).toISOString(),
            },
        })
        const room = await createHostedRoom({
            env,
            actor: actor(),
            displayName: 'Fourth Room',
            startImmediately: false,
        })
        expect(room.slug).toBe('fourth-room')
    })

    it('maps a duplicate slug insert to a friendly already-exists error', async () => {
        const env = createRoomEnv({
            activeCount: 0,
            batchError: new Error(
                'D1_ERROR: UNIQUE constraint failed: hosted_room.workspace_id, hosted_room.slug: SQLITE_CONSTRAINT',
            ),
        })
        const attempt = createHostedRoom({
            env,
            actor: actor(),
            displayName: 'My Room',
            startImmediately: false,
        })
        await expect(attempt).rejects.toThrow(
            'A room named "my-room" already exists. Choose a different name.',
        )
        await attempt.catch((error: Error) => {
            expect(sanitizeRuntimeError(error.message)).toBe(error.message)
        })
    })

    it('rethrows non-unique insert failures unchanged', async () => {
        const env = createRoomEnv({
            activeCount: 0,
            batchError: new Error('D1 write failed'),
        })
        await expect(
            createHostedRoom({
                env,
                actor: actor(),
                displayName: 'My Room',
                startImmediately: false,
            }),
        ).rejects.toThrow('D1 write failed')
    })
})
