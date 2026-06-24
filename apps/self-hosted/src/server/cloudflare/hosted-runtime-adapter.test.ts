import type { D1Database, R2Bucket } from '@cloudflare/workers-types'
import { describe, expect, it } from 'vitest'
import type { AgentRoomHostedEnv, AgentRoomRuntimeJobMessage } from './bindings'
import { hostedRuntimeConfigPath, reconcileHostedRuntimeJob } from './hosted-runtime-adapter'
import { hostedProviderAuthPath } from './hosted-runtime-paths'
import { encryptHostedSecret } from './hosted-secret-store'
import { hostedRuntimeManagedOpenRouterEnvKey } from '../rooms/pi-runtime-contract'

interface RuntimeUpdate {
    sql: string
    args: unknown[]
}

interface RuntimeStatement extends RuntimeUpdate {
    first: () => Promise<unknown>
    all: () => Promise<{ results: unknown[] }>
    run: () => Promise<{ success: true; meta: { changes: number } }>
}

function decodeRuntimeBundle(args: unknown): Array<{ path: string; contentBase64: string }> {
    const envVars = runtimeEnvVars(args)
    const encodedBundle = envVars?.AGENT_ROOM_PI_RUNTIME_FILE_BUNDLE_B64
    expect(encodedBundle).toBeTruthy()
    return JSON.parse(Buffer.from(encodedBundle!, 'base64url').toString('utf8')) as Array<{
        path: string
        contentBase64: string
    }>
}

function runtimeEnvVars(args: unknown): Record<string, string> | undefined {
    if (!args || typeof args !== 'object') {
        return undefined
    }
    return (
        args as {
            startOptions?: {
                envVars?: Record<string, string>
            }
        }
    ).startOptions?.envVars
}

function bundledFileText(
    bundle: Array<{ path: string; contentBase64: string }>,
    path: string,
): string {
    const entry = bundle.find((file) => file.path === path)
    expect(entry).toBeTruthy()
    return Buffer.from(entry!.contentBase64, 'base64url').toString('utf8')
}

function hostedEnv(input: {
    runtimeRow: unknown
    objectKeys: string[]
    start?: (name: string, args: unknown) => Promise<void>
    setAllowedHosts?: (name: string, hosts: string[]) => Promise<void>
    setDeniedHosts?: (name: string, hosts: string[]) => Promise<void>
    destroy?: (name: string) => Promise<void>
    updates?: RuntimeUpdate[]
    batches?: RuntimeUpdate[][]
    billingMode?: string
    billingAccountRow?: unknown
    activeRuntimeCountRow?: unknown
    providerRows?: unknown[]
    roomConfigRow?: Record<string, unknown>
    workspaceSettingsRow?: Record<string, unknown>
    persistPuts?: boolean
    puts?: string[]
    tokenValue?: string
}): AgentRoomHostedEnv {
    const updates = input.updates ?? []
    const batches = input.batches ?? []
    const puts = input.puts ?? []
    const objectKeys = new Set(input.objectKeys)
    const now = new Date(0).toISOString()
    const runtimeRow = {
        roomId: 'room_1',
        workspaceId: 'workspace_1',
        desiredState: 'running',
        containerName: 'workspace:workspace_1:room:room_1',
        configObjectKey: null,
        tokenObjectKey: null,
        runtimeBundleObjectKey: null,
        providerCandidate: 'hosted_openrouter',
        managedBraveSearchEnabled: false,
        workspaceSnapshotKey: null,
        configVersion: 1,
        tokenVersion: 1,
        healthStatus: 'unknown',
        startedAt: null,
        lastHealthAt: null,
        lastError: null,
        updatedAt: now,
        ...(input.runtimeRow as Record<string, unknown>),
    }
    const billingAccountRow = {
        workspaceId: 'workspace_1',
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        planKey: 'standard',
        planStatus: 'active',
        includedBalanceCents: 1200,
        purchasedBalanceCents: 0,
        includedMonthlyCreditCents: 1200,
        createdAt: now,
        updatedAt: now,
        ...(input.billingAccountRow as Record<string, unknown> | undefined),
    }
    const hosted: AgentRoomHostedEnv = {
        AGENT_ROOM_DB: {
            prepare: (sql: string) => ({
                bind: (...args: unknown[]): RuntimeStatement => ({
                    sql,
                    args,
                    first: async () => {
                        if (/FROM\s+hosted_billing_account/.test(sql)) {
                            return billingAccountRow
                        }
                        if (
                            /FROM\s+hosted_room\b(?![\s\S]*INNER JOIN)/.test(sql) &&
                            /COUNT/.test(sql)
                        ) {
                            return input.activeRuntimeCountRow ?? { activeCount: 0 }
                        }
                        if (
                            /FROM\s+hosted_room AS room\s+INNER JOIN\s+hosted_room_runtime_state/.test(
                                sql,
                            )
                        ) {
                            return runtimeRow
                        }
                        if (/FROM\s+hosted_room_runtime_state/.test(sql)) {
                            return runtimeRow
                        }
                        if (/FROM\s+hosted_room_config/.test(sql)) {
                            return {
                                roomId: runtimeRow.roomId,
                                instructions: '',
                                providerMode: 'app_default',
                                providerConnectionId: null,
                                roomMode: 'coworker',
                                capabilityOverrides: '{}',
                                imageProvider: null,
                                imageModel: null,
                                imageSecretId: null,
                                cronTimezone: 'UTC',
                                browserActionBudget: 50,
                                createdAt: now,
                                updatedAt: now,
                                ...input.roomConfigRow,
                            }
                        }
                        if (/FROM\s+hosted_workspace_settings/.test(sql)) {
                            return {
                                workspaceId: runtimeRow.workspaceId,
                                defaultProviderConnectionId: 'provider_1',
                                defaultModel: 'openrouter/auto',
                                capabilityDefaults: '{}',
                                searchConfig: '{}',
                                imageConfig: '{}',
                                onboardingCompletedAt: now,
                                createdAt: now,
                                updatedAt: now,
                                ...input.workspaceSettingsRow,
                            }
                        }
                        if (/FROM\s+hosted_room\b/.test(sql)) {
                            return {
                                id: runtimeRow.roomId,
                                slug: 'room-1',
                                displayName: 'Room 1',
                                status: 'starting',
                                desiredState: runtimeRow.desiredState,
                                createdByUserId: 'user_1',
                                createdAt: now,
                                updatedAt: now,
                            }
                        }
                        if (/FROM\s+hosted_secret/.test(sql)) {
                            return encryptHostedSecret({
                                env: hosted,
                                plainText: 'runtime-openrouter-api-key',
                            })
                        }
                        return null
                    },
                    all: async () => {
                        if (/FROM\s+hosted_provider_connection/.test(sql)) {
                            return {
                                results: input.providerRows ?? [
                                    {
                                        id: 'provider_1',
                                        label: 'OpenRouter BYOK',
                                        provider: 'openrouter',
                                        authMode: 'api_key',
                                        api: 'openai-completions',
                                        baseUrl: null,
                                        defaultModel: 'openrouter/auto',
                                        fallbackModels: '[]',
                                        credentialSecretId: 'secret_provider_1',
                                        status: 'ready',
                                        validationMessage: null,
                                        lastValidatedAt: now,
                                        createdByUserId: 'user_1',
                                        createdAt: now,
                                        updatedAt: now,
                                    },
                                ],
                            }
                        }
                        return {
                            results: [],
                        }
                    },
                    run: async () => {
                        updates.push({ sql, args })
                        return {
                            success: true,
                            meta: {
                                changes: 1,
                            },
                        }
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
            list: async (options?: { prefix?: string; cursor?: string }) => ({
                objects: [...objectKeys]
                    .filter((key) => key.startsWith(options?.prefix ?? ''))
                    .map((key) => ({ key })),
                truncated: false,
                cursor: undefined,
            }),
            get: async (key: string) =>
                objectKeys.has(key)
                    ? {
                          text: async () =>
                              input.tokenValue ?? 'stored-runtime-token-value-aaaaaaaa',
                      }
                    : null,
            put: async (key: string) => {
                puts.push(key)
                if (input.persistPuts !== false) {
                    objectKeys.add(key)
                }
                return null
            },
            delete: async (keys: string | string[]) => {
                for (const key of Array.isArray(keys) ? keys : [keys]) {
                    objectKeys.delete(key)
                }
            },
        } as unknown as R2Bucket,
        AGENT_ROOM_RUNTIME_JOBS: {} as AgentRoomHostedEnv['AGENT_ROOM_RUNTIME_JOBS'],
        AGENT_ROOM_RUNTIME: {
            getByName: (name: string) => ({
                setAllowedHosts: async (hosts: string[]) => {
                    await input.setAllowedHosts?.(name, hosts)
                },
                setDeniedHosts: async (hosts: string[]) => {
                    await input.setDeniedHosts?.(name, hosts)
                },
                getState: async () => ({
                    status: 'healthy',
                    lastChange: 0,
                }),
                startAndWaitForPorts: async (args: unknown) => {
                    await input.start?.(name, args)
                },
                destroy: async () => {
                    await input.destroy?.(name)
                },
            }),
        } as unknown as AgentRoomHostedEnv['AGENT_ROOM_RUNTIME'],
        AGENT_ROOM_AUTH_MODE: 'better-auth',
        AGENT_ROOM_BILLING_MODE: input.billingMode ?? 'disabled',
        AGENT_ROOM_BILLING_PLANS:
            '[{"key":"standard","priceId":"price_test_standard_000000","monthlyCents":2000,"includedCents":1200}]',
        AGENT_ROOM_BILLING_USAGE_MARKUP_BPS: '13000',
        AGENT_ROOM_BILLING_TAX_MODE: 'automatic',
        AGENT_ROOM_BILLING_MAX_CONCURRENT_ROOMS: '3',
        STRIPE_SECRET_KEY: 'stripe-secret-test-value',
        STRIPE_WEBHOOK_SECRET: 'stripe-webhook-test-value',
        STRIPE_CREDIT_TOPUP_PRICE_ID: 'price_test_topup_000000',
        AGENT_ROOM_RUNTIME_BACKEND: 'cloudflare-containers',
        AGENT_ROOM_RUNTIME_STORAGE: 'r2',
        BETTER_AUTH_SECRET: 'a'.repeat(32),
        BETTER_AUTH_URL: 'https://rooms.example.test',
        AGENT_ROOM_HOSTED_ENCRYPTION_KEY_B64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        GOOGLE_CLIENT_ID: 'google-client',
        GOOGLE_CLIENT_SECRET: 'google-secret',
        AGENT_ROOM_EMAIL_WEBHOOK_URL: 'https://mail.example.test/send',
        AGENT_ROOM_EMAIL_WEBHOOK_BEARER_TOKEN: 'b'.repeat(16),
        AGENT_ROOM_EMAIL_FROM: 'Agent Room <noreply@example.test>',
        AGENT_ROOM_HOSTED_OPENROUTER_API_KEY: 'openrouter-platform-key',
    }
    return hosted
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
        const allowedHosts: Array<{ name: string; hosts: string[] }> = []
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
            setAllowedHosts: async (name, hosts) => {
                allowedHosts.push({ name, hosts })
            },
        })

        await reconcileHostedRuntimeJob(env, runtimeMessage())

        expect(starts).toHaveLength(1)
        expect(allowedHosts).toEqual([
            {
                name: 'workspace:workspace_1:room:room_1',
                hosts: ['openrouter.ai', 'rooms.example.test', 'searxng'],
            },
        ])
        expect(starts[0]?.name).toBe('workspace:workspace_1:room:room_1')
        expect(starts[0]?.args).toMatchObject({
            ports: 3000,
            startOptions: {
                enableInternet: false,
                envVars: {
                    AGENT_ROOM_PI_RUNTIME_CONFIG_PATH: hostedRuntimeConfigPath,
                    AGENT_ROOM_HOSTED_WORKSPACE_ID: 'workspace_1',
                    AGENT_ROOM_HOSTED_ROOM_ID: 'room_1',
                },
                labels: {
                    workspace_id: 'workspace_1',
                    room_id: 'room_1',
                    runtime: 'pi',
                },
            },
        })
        expect(
            runtimeEnvVars(starts[0]?.args)?.[hostedRuntimeManagedOpenRouterEnvKey],
        ).toBeUndefined()
        const bundle = decodeRuntimeBundle(starts[0]?.args)
        const providerAuth = bundledFileText(bundle, hostedProviderAuthPath)
        expect(providerAuth).not.toContain('openrouter-hosted-key')
        expect(providerAuth).toContain('runtime-openrouter-api-key')
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

    it('marks only managed hosted OpenRouter runtimes for managed cost truth', async () => {
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
            providerRows: [],
            workspaceSettingsRow: {
                defaultProviderConnectionId: null,
                defaultModel: 'openrouter/auto',
            },
            start: async (name, args) => {
                starts.push({ name, args })
            },
        })

        await reconcileHostedRuntimeJob(env, runtimeMessage())

        expect(runtimeEnvVars(starts[0]?.args)?.[hostedRuntimeManagedOpenRouterEnvKey]).toBe('1')
    })

    it('does not materialize app image secrets for a room-scoped image provider', async () => {
        const starts: Array<{ name: string; args: unknown }> = []
        const env = hostedEnv({
            objectKeys: ['workspaces/workspace_1/rooms/room_1/runtime/config.json'],
            runtimeRow: {
                roomId: 'room_1',
                workspaceId: 'workspace_1',
                desiredState: 'running',
                containerName: 'workspace:workspace_1:room:room_1',
                configObjectKey: 'workspaces/workspace_1/rooms/room_1/runtime/config.json',
                workspaceSnapshotKey: null,
            },
            roomConfigRow: {
                imageProvider: 'gemini',
                imageModel: 'imagen-3',
                imageSecretId: null,
            },
            workspaceSettingsRow: {
                imageConfig: JSON.stringify({
                    provider: 'openai',
                    model: 'gpt-image-1',
                    secretId: 'app_image_secret',
                }),
            },
            start: async (name, args) => {
                starts.push({ name, args })
            },
        })

        await reconcileHostedRuntimeJob(env, runtimeMessage())

        const envVars = runtimeEnvVars(starts[0]?.args)
        expect(envVars?.OPENAI_API_KEY).toBeUndefined()
        expect(envVars?.GEMINI_API_KEY).toBeUndefined()
        const bundle = decodeRuntimeBundle(starts[0]?.args)
        const runtimeConfig = JSON.parse(
            bundledFileText(bundle, hostedRuntimeConfigPath),
        ) as Record<string, unknown>
        expect(runtimeConfig).toMatchObject({
            image: {
                enabled: false,
                provider: 'gemini',
                model: 'imagen-3',
                envKey: null,
            },
        })
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
        expect(updates.some((update) => /status = 'failed'/.test(update.sql))).toBe(true)
    })

    it('fails closed when the runtime config object is missing from R2', async () => {
        const updates: RuntimeUpdate[] = []
        const batches: RuntimeUpdate[][] = []
        const env = hostedEnv({
            updates,
            batches,
            objectKeys: [],
            persistPuts: false,
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
        expect(updates.some((update) => /status = 'failed'/.test(update.sql))).toBe(true)
        expect(
            batches.some((batch) =>
                batch.some(
                    (update) =>
                        /UPDATE\s+hosted_room_runtime_state/.test(update.sql) &&
                        /token_object_key = NULL/.test(update.sql),
                ),
            ),
        ).toBe(true)
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

    it('fails closed without materializing when stripe billing has no active subscription or BYOK provider', async () => {
        const updates: RuntimeUpdate[] = []
        const starts: Array<{ name: string; args: unknown }> = []
        const destroys: string[] = []
        const puts: string[] = []
        const env = hostedEnv({
            updates,
            puts,
            providerRows: [],
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
            destroy: async (name) => {
                destroys.push(name)
            },
        })

        await reconcileHostedRuntimeJob(env, runtimeMessage())

        expect(starts).toHaveLength(0)
        expect(destroys).toEqual(['workspace:workspace_1:room:room_1'])
        expect(updates.some((update) => /status = 'failed'/.test(update.sql))).toBe(true)
        expect(
            updates.some(
                (update) =>
                    /UPDATE\s+hosted_room_runtime_state/.test(update.sql) &&
                    /config_object_key = NULL/.test(update.sql) &&
                    /token_object_key = NULL/.test(update.sql) &&
                    /runtime_bundle_object_key = NULL/.test(update.sql) &&
                    /provider_candidate = NULL/.test(update.sql),
            ),
        ).toBe(true)
        expect(puts).toHaveLength(0)
    })

    it('fails closed without starting or materializing when the workspace concurrent room limit is reached', async () => {
        const updates: RuntimeUpdate[] = []
        const starts: Array<{ name: string; args: unknown }> = []
        const destroys: string[] = []
        const puts: string[] = []
        const env = hostedEnv({
            updates,
            puts,
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
            destroy: async (name) => {
                destroys.push(name)
            },
        })

        await reconcileHostedRuntimeJob(env, runtimeMessage())

        expect(starts).toHaveLength(0)
        expect(destroys).toEqual(['workspace:workspace_1:room:room_1'])
        expect(updates.some((update) => /status = 'failed'/.test(update.sql))).toBe(true)
        expect(
            updates.some(
                (update) =>
                    /UPDATE\s+hosted_room_runtime_state/.test(update.sql) &&
                    /token_object_key = NULL/.test(update.sql),
            ),
        ).toBe(true)
        expect(puts).toHaveLength(0)
    })

    it('rotates the runtime token across reconciles so stale containers cannot keep posting callbacks', async () => {
        const updates: RuntimeUpdate[] = []
        const puts: string[] = []
        const starts: Array<{ name: string; args: unknown }> = []
        const tokenValue = 'persistent-runtime-token-value-bbbbbbbb'
        const env = hostedEnv({
            updates,
            puts,
            tokenValue,
            objectKeys: [
                'workspaces/workspace_1/rooms/room_1/runtime/config-v3.json',
                'workspaces/workspace_1/rooms/room_1/runtime/token-v2.txt',
                'workspaces/workspace_1/rooms/room_1/runtime/bundle-v3.json',
            ],
            runtimeRow: {
                roomId: 'room_1',
                workspaceId: 'workspace_1',
                desiredState: 'running',
                containerName: 'workspace:workspace_1:room:room_1',
                configObjectKey: 'workspaces/workspace_1/rooms/room_1/runtime/config-v3.json',
                tokenObjectKey: 'workspaces/workspace_1/rooms/room_1/runtime/token-v2.txt',
                runtimeBundleObjectKey:
                    'workspaces/workspace_1/rooms/room_1/runtime/bundle-v3.json',
                configVersion: 3,
                tokenVersion: 2,
                workspaceSnapshotKey: null,
            },
            start: async (name, args) => {
                starts.push({ name, args })
            },
        })

        await reconcileHostedRuntimeJob(env, runtimeMessage())

        expect(starts).toHaveLength(1)
        const nextTokenKey = puts.find((key) =>
            /^workspaces\/workspace_1\/rooms\/room_1\/runtime\/token-v3-[^.]+\.txt$/.test(key),
        )
        expect(nextTokenKey).toBeTruthy()
        expect(
            updates.some(
                (update) =>
                    /UPDATE\s+hosted_room_runtime_state/.test(update.sql) &&
                    update.args.includes(nextTokenKey ?? ''),
            ),
        ).toBe(true)
        const startArgs = starts[0]?.args as { startOptions: { envVars: Record<string, string> } }
        expect(startArgs.startOptions.envVars.AGENT_ROOM_PI_RUNTIME_TOKEN).toBeTruthy()
        expect(startArgs.startOptions.envVars.AGENT_ROOM_PI_RUNTIME_TOKEN).not.toBe(tokenValue)
    })
})
