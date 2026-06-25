import type { D1Database, R2Bucket } from '@cloudflare/workers-types'
import { describe, expect, it, vi } from 'vitest'
import type { AgentRoomHostedEnv } from './bindings'
import { failClosedHostedRuntime } from './hosted-room-service'

function runtimeStateRow() {
    return {
        roomId: 'room_1',
        workspaceId: 'workspace_1',
        containerName: 'container_1',
        configObjectKey: 'config-key',
        tokenObjectKey: 'token-key',
        runtimeBundleObjectKey: 'bundle-key',
        providerCandidate: 'user_key',
        workspaceSnapshotKey: null,
        configVersion: 1,
        tokenVersion: 1,
        healthStatus: 'healthy',
        startedAt: new Date(0).toISOString(),
        lastHealthAt: new Date(0).toISOString(),
        lastError: null,
        updatedAt: new Date(0).toISOString(),
    }
}

function hostedEnv(input: {
    destroy?: () => Promise<void>
    deleteObjects?: (keys: string | string[]) => Promise<void>
    batch?: () => Promise<unknown[]>
}): {
    env: AgentRoomHostedEnv
    batch: ReturnType<typeof vi.fn>
    batchStatements: Array<{ sql: string }>
    deleteObjects: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
    events: string[]
} {
    const events: string[] = []
    const batchStatements: Array<{ sql: string }> = []
    const batch = vi.fn(
        input.batch ??
            (async (statements: Array<{ sql: string; run: () => Promise<unknown> }>) => {
                events.push('batch')
                batchStatements.push(...statements)
                const results = []
                for (const statement of statements) {
                    results.push(await statement.run())
                }
                return results
            }),
    )
    const deleteObjects = vi.fn(async (keys: string | string[]) => {
        events.push('delete')
        await input.deleteObjects?.(keys)
    })
    const destroy = vi.fn(async () => {
        events.push('destroy')
        await input.destroy?.()
    })
    const db = {
        prepare: (sql: string) => ({
            bind: () => ({
                sql,
                first: async () => runtimeStateRow(),
                run: async () => ({
                    meta: {
                        changes: 1,
                    },
                }),
            }),
        }),
        batch,
    } as unknown as D1Database
    return {
        env: {
            AGENT_ROOM_DB: db,
            AGENT_ROOM_WORKSPACE_BUCKET: {
                delete: deleteObjects,
            } as unknown as R2Bucket,
            AGENT_ROOM_RUNTIME: {
                getByName: () => ({
                    destroy,
                }),
            } as unknown as AgentRoomHostedEnv['AGENT_ROOM_RUNTIME'],
            AGENT_ROOM_RUNTIME_JOBS: {} as AgentRoomHostedEnv['AGENT_ROOM_RUNTIME_JOBS'],
            AGENT_ROOM_AUTH_MODE: 'better-auth',
            AGENT_ROOM_BILLING_MODE: 'disabled',
            AGENT_ROOM_BILLING_PLANS: '[]',
            AGENT_ROOM_BILLING_USAGE_MARKUP_BPS: '13000',
            AGENT_ROOM_BILLING_TAX_MODE: 'automatic',
            AGENT_ROOM_BILLING_MAX_CONCURRENT_ROOMS: '3',
            AGENT_ROOM_RUNTIME_BACKEND: 'cloudflare-containers',
            AGENT_ROOM_RUNTIME_STORAGE: 'r2',
            BETTER_AUTH_SECRET: 'a'.repeat(32),
            BETTER_AUTH_URL: 'https://rooms.example.test',
            AGENT_ROOM_HOSTED_ENCRYPTION_KEY_B64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
            AGENT_ROOM_EMAIL_WEBHOOK_URL: 'https://mail.example.test/send',
            AGENT_ROOM_EMAIL_WEBHOOK_BEARER_TOKEN: 'b'.repeat(16),
            AGENT_ROOM_EMAIL_FROM: 'Agent Room <noreply@example.test>',
        },
        batch,
        deleteObjects,
        destroy,
        batchStatements,
        events,
    }
}

describe('hosted room lifecycle cleanup', () => {
    it('does not clear runtime authority when cleanup fails', async () => {
        const store = hostedEnv({
            destroy: async () => {
                throw new Error('destroy failed')
            },
            deleteObjects: async () => {
                throw new Error('delete failed')
            },
        })

        await expect(
            failClosedHostedRuntime({
                env: store.env,
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                error: new Error('materialize failed'),
            }),
        ).rejects.toThrow('destroy failed')

        expect(store.batch).not.toHaveBeenCalled()
        expect(store.destroy).toHaveBeenCalledTimes(1)
        expect(store.deleteObjects).not.toHaveBeenCalled()
    })

    it('clears runtime authority after required cleanup succeeds', async () => {
        const store = hostedEnv({})

        await expect(
            failClosedHostedRuntime({
                env: store.env,
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                error: new Error('materialize failed'),
            }),
        ).resolves.toBeUndefined()

        expect(store.events).toEqual(['destroy', 'delete', 'batch'])
        expect(store.batch).toHaveBeenCalledTimes(1)
        expect(
            store.batchStatements.some(
                (statement) =>
                    /UPDATE\s+hosted_room_runtime_state/.test(statement.sql) &&
                    /config_object_key = NULL/.test(statement.sql) &&
                    /token_object_key = NULL/.test(statement.sql) &&
                    /runtime_bundle_object_key = NULL/.test(statement.sql) &&
                    /provider_candidate = NULL/.test(statement.sql),
            ),
        ).toBe(true)
        expect(store.deleteObjects).toHaveBeenCalledWith(['config-key', 'token-key', 'bundle-key'])
    })
})
