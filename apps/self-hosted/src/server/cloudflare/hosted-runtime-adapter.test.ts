import type { D1Database, R2Bucket } from '@cloudflare/workers-types'
import { describe, expect, it } from 'vitest'
import type { AgentRoomHostedEnv, AgentRoomRuntimeJobMessage } from './bindings'
import { hostedRuntimeConfigPath, reconcileHostedRuntimeJob } from './hosted-runtime-adapter'

interface RuntimeUpdate {
    sql: string
    args: unknown[]
}

interface RuntimeStatement extends RuntimeUpdate {
    first: () => Promise<unknown>
    run: () => Promise<{ success: true }>
}

function hostedEnv(input: {
    runtimeRow: unknown
    objectKeys: string[]
    start?: (name: string, args: unknown) => Promise<void>
    updates?: RuntimeUpdate[]
    batches?: RuntimeUpdate[][]
    billingMode?: string
    billingAccountRow?: unknown
    activeRuntimeCountRow?: unknown
}): AgentRoomHostedEnv {
    const updates = input.updates ?? []
    const batches = input.batches ?? []
    const objectKeys = new Set(input.objectKeys)

    return {
        AGENT_ROOM_DB: {
            prepare: (sql: string) => ({
                bind: (...args: unknown[]): RuntimeStatement => ({
                    sql,
                    args,
                    first: async () => {
                        if (/FROM\s+hosted_billing_account/.test(sql)) {
                            return input.billingAccountRow ?? null
                        }
                        if (
                            /FROM\s+hosted_room\b(?![\s\S]*INNER JOIN)/.test(sql) &&
                            /COUNT/.test(sql)
                        ) {
                            return input.activeRuntimeCountRow ?? { activeCount: 0 }
                        }
                        return input.runtimeRow
                    },
                    run: async () => {
                        updates.push({ sql, args })
                        return { success: true }
                    },
                }),
            }),
            batch: async (statements: RuntimeStatement[]) => {
                const batch = statements.map((statement) => ({
                    sql: statement.sql,
                    args: statement.args,
                }))
                batches.push(batch)
                updates.push(...batch)
                return batch.map(() => ({
                    success: true,
                    meta: {
                        changes: 1,
                    },
                    results: [],
                }))
            },
        } as unknown as D1Database,
        AGENT_ROOM_WORKSPACE_BUCKET: {
            head: async (key: string) => (objectKeys.has(key) ? {} : null),
        } as unknown as R2Bucket,
        AGENT_ROOM_RUNTIME_JOBS: {} as AgentRoomHostedEnv['AGENT_ROOM_RUNTIME_JOBS'],
        AGENT_ROOM_RUNTIME: {
            getByName: (name: string) => ({
                startAndWaitForPorts: async (args: unknown) => {
                    await input.start?.(name, args)
                },
            }),
        } as unknown as AgentRoomHostedEnv['AGENT_ROOM_RUNTIME'],
        AGENT_ROOM_AUTH_MODE: 'better-auth',
        AGENT_ROOM_BILLING_MODE: input.billingMode ?? 'disabled',
        AGENT_ROOM_BILLING_PLANS:
            '[{"key":"standard","priceId":"price_standard_placeholder","monthlyCents":2000,"includedCents":1200}]',
        AGENT_ROOM_BILLING_USAGE_MARKUP_BPS: '13000',
        AGENT_ROOM_BILLING_TAX_MODE: 'automatic',
        AGENT_ROOM_BILLING_MAX_CONCURRENT_ROOMS: '3',
        STRIPE_SECRET_KEY: 'sk_test_placeholder',
        STRIPE_WEBHOOK_SECRET: 'whsec_placeholder',
        STRIPE_CREDIT_TOPUP_PRICE_ID: 'price_topup_placeholder',
        AGENT_ROOM_RUNTIME_BACKEND: 'cloudflare-containers',
        AGENT_ROOM_RUNTIME_STORAGE: 'r2',
        BETTER_AUTH_SECRET: 'a'.repeat(32),
        BETTER_AUTH_URL: 'https://rooms.example.test',
        GOOGLE_CLIENT_ID: 'google-client',
        GOOGLE_CLIENT_SECRET: 'google-secret',
        AGENT_ROOM_EMAIL_WEBHOOK_URL: 'https://mail.example.test/send',
        AGENT_ROOM_EMAIL_WEBHOOK_BEARER_TOKEN: 'b'.repeat(16),
        AGENT_ROOM_EMAIL_FROM: 'Agent Room <noreply@example.test>',
    }
}

function runtimeMessage(): AgentRoomRuntimeJobMessage {
    return {
        kind: 'room-runtime-reconcile',
        workspaceId: 'workspace_1',
        roomId: 'room_1',
        actorUserId: 'user_1',
        requestedAt: new Date(0).toISOString(),
    }
}

describe('hosted runtime reconciliation', () => {
    it('starts the canonical room container after D1 and R2 state are verified', async () => {
        const updates: RuntimeUpdate[] = []
        const batches: RuntimeUpdate[][] = []
        const starts: Array<{ name: string; args: unknown }> = []
        const env = hostedEnv({
            updates,
            batches,
            objectKeys: [
                'workspaces/workspace_1/rooms/room_1/runtime/config.json',
                'workspaces/workspace_1/rooms/room_1/snapshots/snapshot_1.tar.zst',
            ],
            runtimeRow: {
                roomId: 'room_1',
                workspaceId: 'workspace_1',
                desiredState: 'running',
                containerName: 'workspace:workspace_1:room:room_1',
                configObjectKey: 'workspaces/workspace_1/rooms/room_1/runtime/config.json',
                workspaceSnapshotKey:
                    'workspaces/workspace_1/rooms/room_1/snapshots/snapshot_1.tar.zst',
            },
            start: async (name, args) => {
                starts.push({ name, args })
            },
        })

        await reconcileHostedRuntimeJob(env, runtimeMessage())

        expect(starts).toHaveLength(1)
        expect(starts[0]?.name).toBe('workspace:workspace_1:room:room_1')
        expect(starts[0]?.args).toMatchObject({
            ports: 3000,
            startOptions: {
                enableInternet: false,
                envVars: {
                    AGENT_ROOM_PI_RUNTIME_CONFIG_PATH: hostedRuntimeConfigPath,
                    AGENT_ROOM_HOSTED_WORKSPACE_ID: 'workspace_1',
                    AGENT_ROOM_HOSTED_ROOM_ID: 'room_1',
                    AGENT_ROOM_HOSTED_CONTROL_PLANE_ORIGIN: 'https://rooms.example.test',
                },
                labels: {
                    workspace_id: 'workspace_1',
                    room_id: 'room_1',
                    runtime: 'pi',
                },
            },
        })
        expect(updates.some((update) => update.args.includes('running'))).toBe(true)
        expect(
            batches.some(
                (batch) =>
                    batch.length === 2 &&
                    batch.some((update) => /UPDATE\s+hosted_room_runtime_state/.test(update.sql)) &&
                    batch.some((update) => /UPDATE\s+hosted_room\s/.test(update.sql)),
            ),
        ).toBe(true)
    })

    it('fails closed when persisted container name does not match canonical identity', async () => {
        const updates: RuntimeUpdate[] = []
        const env = hostedEnv({
            updates,
            objectKeys: ['workspaces/workspace_1/rooms/room_1/runtime/config.json'],
            runtimeRow: {
                roomId: 'room_1',
                workspaceId: 'workspace_1',
                desiredState: 'running',
                containerName: 'workspace:other:room:room_1',
                configObjectKey: 'workspaces/workspace_1/rooms/room_1/runtime/config.json',
                workspaceSnapshotKey: null,
            },
        })

        await expect(reconcileHostedRuntimeJob(env, runtimeMessage())).rejects.toThrow(
            /container name/,
        )
        expect(updates.some((update) => update.args.includes('failed'))).toBe(true)
    })

    it('fails closed when the runtime config object is missing from R2', async () => {
        const updates: RuntimeUpdate[] = []
        const batches: RuntimeUpdate[][] = []
        const env = hostedEnv({
            updates,
            batches,
            objectKeys: [],
            runtimeRow: {
                roomId: 'room_1',
                workspaceId: 'workspace_1',
                desiredState: 'running',
                containerName: 'workspace:workspace_1:room:room_1',
                configObjectKey: 'workspaces/workspace_1/rooms/room_1/runtime/config.json',
                workspaceSnapshotKey: null,
            },
        })

        await expect(reconcileHostedRuntimeJob(env, runtimeMessage())).rejects.toThrow(
            /Runtime config object/,
        )
        expect(updates.some((update) => update.args.includes('failed'))).toBe(true)
        expect(batches).toHaveLength(1)
    })

    it('starts the container when stripe billing access allows an active subscription', async () => {
        const starts: Array<{ name: string; args: unknown }> = []
        const env = hostedEnv({
            billingMode: 'stripe',
            billingAccountRow: { planStatus: 'active' },
            activeRuntimeCountRow: { activeCount: 0 },
            objectKeys: ['workspaces/workspace_1/rooms/room_1/runtime/config.json'],
            runtimeRow: {
                roomId: 'room_1',
                workspaceId: 'workspace_1',
                desiredState: 'running',
                containerName: 'workspace:workspace_1:room:room_1',
                configObjectKey: 'workspaces/workspace_1/rooms/room_1/runtime/config.json',
                workspaceSnapshotKey: null,
            },
            start: async (name, args) => {
                starts.push({ name, args })
            },
        })

        await reconcileHostedRuntimeJob(env, runtimeMessage())

        expect(starts).toHaveLength(1)
    })

    it('fails closed without starting when stripe billing has no active subscription', async () => {
        const updates: RuntimeUpdate[] = []
        const starts: Array<{ name: string; args: unknown }> = []
        const env = hostedEnv({
            updates,
            billingMode: 'stripe',
            billingAccountRow: { planStatus: 'canceled' },
            activeRuntimeCountRow: { activeCount: 0 },
            objectKeys: ['workspaces/workspace_1/rooms/room_1/runtime/config.json'],
            runtimeRow: {
                roomId: 'room_1',
                workspaceId: 'workspace_1',
                desiredState: 'running',
                containerName: 'workspace:workspace_1:room:room_1',
                configObjectKey: 'workspaces/workspace_1/rooms/room_1/runtime/config.json',
                workspaceSnapshotKey: null,
            },
            start: async (name, args) => {
                starts.push({ name, args })
            },
        })

        await reconcileHostedRuntimeJob(env, runtimeMessage())

        expect(starts).toHaveLength(0)
        expect(updates.some((update) => update.args.includes('failed'))).toBe(true)
    })

    it('fails closed without starting when the workspace concurrent room limit is reached', async () => {
        const updates: RuntimeUpdate[] = []
        const starts: Array<{ name: string; args: unknown }> = []
        const env = hostedEnv({
            updates,
            billingMode: 'stripe',
            billingAccountRow: { planStatus: 'active' },
            activeRuntimeCountRow: { activeCount: 3 },
            objectKeys: ['workspaces/workspace_1/rooms/room_1/runtime/config.json'],
            runtimeRow: {
                roomId: 'room_1',
                workspaceId: 'workspace_1',
                desiredState: 'running',
                containerName: 'workspace:workspace_1:room:room_1',
                configObjectKey: 'workspaces/workspace_1/rooms/room_1/runtime/config.json',
                workspaceSnapshotKey: null,
            },
            start: async (name, args) => {
                starts.push({ name, args })
            },
        })

        await reconcileHostedRuntimeJob(env, runtimeMessage())

        expect(starts).toHaveLength(0)
        expect(updates.some((update) => update.args.includes('failed'))).toBe(true)
    })
})
