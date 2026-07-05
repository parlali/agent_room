import type { D1Database, R2Bucket } from '@cloudflare/workers-types'
import { describe, expect, it, vi } from 'vitest'
import type { AgentRoomHostedEnv, AgentRoomRuntimeJobMessage } from './bindings'
import {
    confirmHostedRuntimeContainerStopped,
    convergeHostedRuntimeHealthIfReady,
    hostedRuntimeConfigPath,
    HostedRuntimeRecreateDeferredError,
    reconcileHostedRuntimeJob,
    waitForHostedRuntimeReady,
    withHostedRuntimeStarted,
} from './hosted-runtime-adapter'
import { hostedProviderAuthPath } from './hosted-runtime-paths'
import { hostedRuntimeDeniedHosts, type HostedRuntimeContainerStub } from './runtime-contract'
import { encryptHostedSecret } from './hosted-secret-store'
import { hostedRuntimeManagedOpenRouterEnvKey } from '../rooms/pi-runtime-contract'
import { hostedManagedModelId } from './hosted-model-policy'
import { hostedRuntimeTokenSha256Hex } from './hosted-runtime-token-hash'

interface RuntimeUpdate {
    sql: string
    args: unknown[]
}

interface RuntimeStatement extends RuntimeUpdate {
    first: () => Promise<unknown>
    all: () => Promise<{ results: unknown[] }>
    run: () => Promise<{ success: true; meta: { changes: number } }>
}

interface RecordedContainerFetch {
    name: string
    url: string
    method: string
    authorization: string | null
    body: unknown
    responseStatus: number
}

function decodeRuntimeBundle(
    fetches: RecordedContainerFetch[],
): Array<{ path: string; contentBase64: string }> {
    const bundlePush = fetches.find(
        (recorded) => recorded.method === 'POST' && recorded.url.endsWith('/boot/materialize'),
    )
    expect(bundlePush).toBeTruthy()
    expect(Array.isArray(bundlePush!.body)).toBe(true)
    return bundlePush!.body as Array<{ path: string; contentBase64: string }>
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
    fetches?: RecordedContainerFetch[]
    billingAccountRow?: unknown
    activeRuntimeCountRow?: unknown
    providerRows?: unknown[]
    roomConfigRow?: Record<string, unknown>
    workspaceSettingsRow?: Record<string, unknown>
    persistPuts?: boolean
    puts?: string[]
    tokenValue?: string
    desiredState?: () => string
    preStartDesiredState?: () => string
    pushStatuses?: number[]
    readyStatuses?: number[]
    readyAfterDeliver?: boolean
    containerStopLingerPolls?: number
    forceBootReady?: boolean
    containerStatus?: () => 'running' | 'healthy' | 'stopped'
    materializeCasConflictOnCall?: number
}): AgentRoomHostedEnv {
    const updates = input.updates ?? []
    let materializeCasCalls = 0
    const batches = input.batches ?? []
    const fetches = input.fetches ?? []
    const puts = input.puts ?? []
    const pushStatuses = [...(input.pushStatuses ?? [])]
    const readyStatuses = [...(input.readyStatuses ?? [])]
    let bundleDelivered = false
    let containerDestroyed = false
    let stopLingerPollsRemaining = 0
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
        workspaceSnapshotKey: null,
        previousTokenHash: null,
        staleTokenHealEnqueuedAt: null,
        configVersion: 1,
        tokenVersion: 1,
        healthStatus: 'unknown',
        startedAt: null,
        lastHealthAt: null,
        lastError: null,
        updatedAt: now,
        ...(input.runtimeRow as Record<string, unknown>),
    }
    const currentDesiredState = () => input.desiredState?.() ?? String(runtimeRow.desiredState)
    const runtimeRowSnapshot = () => ({
        ...runtimeRow,
        desiredState: currentDesiredState(),
    })
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
                            return runtimeRowSnapshot()
                        }
                        if (/FROM\s+hosted_room_runtime_state/.test(sql)) {
                            return runtimeRowSnapshot()
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
                            const desiredState = /FROM\s+hosted_room\s+WHERE/.test(sql)
                                ? (input.preStartDesiredState ?? currentDesiredState)()
                                : currentDesiredState()
                            return {
                                id: runtimeRow.roomId,
                                slug: 'room-1',
                                displayName: 'Room 1',
                                status: 'starting',
                                desiredState,
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
                        if (
                            input.materializeCasConflictOnCall !== undefined &&
                            /UPDATE hosted_room_runtime_state[\s\S]*config_version = \?10[\s\S]*token_version = \?11/.test(
                                sql,
                            )
                        ) {
                            materializeCasCalls += 1
                            return {
                                success: true,
                                meta: {
                                    changes:
                                        materializeCasCalls === input.materializeCasConflictOnCall
                                            ? 0
                                            : 1,
                                },
                            }
                        }
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
                        changes:
                            currentDesiredState() === 'running' ||
                            !batch.some((statement) =>
                                /desired_state\s+=\s+'running'/.test(statement.sql),
                            )
                                ? 1
                                : 0,
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
                          text: async () => {
                              const encrypted = await encryptHostedSecret({
                                  env: hosted,
                                  plainText:
                                      input.tokenValue ?? 'stored-runtime-token-value-aaaaaaaa',
                              })
                              return JSON.stringify({
                                  format: 'agent-room-hosted-runtime-artifact-v1',
                                  ...encrypted,
                                  contentType: 'text/plain',
                              })
                          },
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
                getState: async (): Promise<{
                    status: 'running' | 'healthy' | 'stopped'
                    lastChange: number
                }> => {
                    if (containerDestroyed && stopLingerPollsRemaining > 0) {
                        stopLingerPollsRemaining -= 1
                        return { status: 'healthy', lastChange: 0 }
                    }
                    if (input.containerStatus) {
                        return { status: input.containerStatus(), lastChange: 0 }
                    }
                    return {
                        status: containerDestroyed ? 'stopped' : 'healthy',
                        lastChange: 0,
                    }
                },
                startAndWaitForPorts: async (args: unknown) => {
                    containerDestroyed = false
                    await input.start?.(name, args)
                },
                destroy: async () => {
                    containerDestroyed = true
                    bundleDelivered = false
                    stopLingerPollsRemaining = input.containerStopLingerPolls ?? 0
                    await input.destroy?.(name)
                },
                fetch: async (request: Request) => {
                    const requestUrl = new URL(request.url)
                    const recordFetch = async (responseStatus: number) => {
                        fetches.push({
                            name,
                            url: request.url,
                            method: request.method,
                            authorization: request.headers.get('authorization'),
                            body: await request
                                .clone()
                                .json()
                                .catch(() => null),
                            responseStatus,
                        })
                    }
                    if (request.method === 'GET' && requestUrl.pathname === '/boot/ready') {
                        const naturalReady =
                            input.forceBootReady === true ||
                            (bundleDelivered && input.readyAfterDeliver !== false)
                        const naturalStatus = naturalReady ? 200 : 503
                        const status =
                            readyStatuses.length > 0 ? readyStatuses.shift()! : naturalStatus
                        const ready = status === 200
                        await recordFetch(status)
                        return new Response(JSON.stringify({ ready }), {
                            status,
                        })
                    }
                    if (request.method === 'POST' && requestUrl.pathname === '/boot/materialize') {
                        const status = pushStatuses.length > 0 ? pushStatuses.shift()! : 200
                        await recordFetch(status)
                        if (status === 200) {
                            bundleDelivered = true
                        }
                        return new Response(JSON.stringify({ ok: status === 200 }), {
                            status,
                        })
                    }
                    await recordFetch(200)
                    return new Response(JSON.stringify({ ok: true }), { status: 200 })
                },
            }),
        } as unknown as AgentRoomHostedEnv['AGENT_ROOM_RUNTIME'],
        AGENT_ROOM_AUTH_MODE: 'better-auth',
        AGENT_ROOM_BILLING_USAGE_MARKUP_BPS: '13000',
        AGENT_ROOM_BILLING_TAX_MODE: 'automatic',
        AGENT_ROOM_BILLING_MAX_CONCURRENT_ROOMS: '3',
        STRIPE_SECRET_KEY: 'stripe-secret-test-value',
        STRIPE_WEBHOOK_SECRET: 'stripe-webhook-test-value',
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
        AGENT_ROOM_HOSTED_BRAVE_API_KEY: 'brave-platform-key',
        AGENT_ROOM_HOSTED_BROWSERBASE_API_KEY: 'browserbase-platform-key',
    }
    return hosted
}

function runtimeMessage(overrides?: { rotateToken?: boolean }): AgentRoomRuntimeJobMessage {
    return {
        kind: 'room-runtime-reconcile',
        workspaceId: 'workspace_1',
        roomId: 'room_1',
        actorUserId: 'user_1',
        requestedAt: new Date(0).toISOString(),
        ...(overrides?.rotateToken === undefined ? {} : { rotateToken: overrides.rotateToken }),
    }
}

describe('hosted runtime reconciliation', () => {
    it('starts the canonical room container with direct egress disabled after D1 and R2 state are verified', async () => {
        const updates: RuntimeUpdate[] = []
        const batches: RuntimeUpdate[][] = []
        const fetches: RecordedContainerFetch[] = []
        const starts: Array<{ name: string; args: unknown }> = []
        const allowedHosts: Array<{ name: string; hosts: string[] }> = []
        const deniedHosts: Array<{ name: string; hosts: string[] }> = []
        const env = hostedEnv({
            updates,
            batches,
            fetches,
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
            setDeniedHosts: async (name, hosts) => {
                deniedHosts.push({ name, hosts })
            },
        })

        await reconcileHostedRuntimeJob(env, runtimeMessage())

        expect(starts).toHaveLength(1)
        expect(allowedHosts).toEqual([
            {
                name: 'workspace:workspace_1:room:room_1',
                hosts: ['openrouter.ai', 'rooms.example.test'],
            },
        ])
        expect(deniedHosts).toEqual([
            {
                name: 'workspace:workspace_1:room:room_1',
                hosts: hostedRuntimeDeniedHosts,
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
        expect(
            runtimeEnvVars(starts[0]?.args)?.AGENT_ROOM_PI_RUNTIME_FILE_BUNDLE_B64,
        ).toBeUndefined()
        const bundlePush = fetches.find((recorded) => recorded.url.endsWith('/boot/materialize'))
        expect(bundlePush?.name).toBe('workspace:workspace_1:room:room_1')
        expect(bundlePush?.authorization).toBe(
            `Bearer ${runtimeEnvVars(starts[0]?.args)?.AGENT_ROOM_PI_RUNTIME_TOKEN}`,
        )
        const bundle = decodeRuntimeBundle(fetches)
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

    it('does not start the container when a stop wins before container start', async () => {
        const updates: RuntimeUpdate[] = []
        const starts: Array<{ name: string; args: unknown }> = []
        const destroys: string[] = []
        const env = hostedEnv({
            updates,
            preStartDesiredState: () => 'stopped',
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
            destroy: async (name) => {
                destroys.push(name)
            },
        })

        await reconcileHostedRuntimeJob(env, runtimeMessage())

        expect(starts).toHaveLength(0)
        expect(destroys).toEqual(['workspace:workspace_1:room:room_1'])
        expect(updates.some((update) => update.args.includes('running'))).toBe(false)
        expect(updates.some((update) => /last_error = 'Runtime stopped'/.test(update.sql))).toBe(
            true,
        )
    })

    it('destroys a started container when stop wins before the running transition', async () => {
        let desiredState = 'running'
        const updates: RuntimeUpdate[] = []
        const batches: RuntimeUpdate[][] = []
        const starts: Array<{ name: string; args: unknown }> = []
        const destroys: string[] = []
        const env = hostedEnv({
            updates,
            batches,
            desiredState: () => desiredState,
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
                desiredState = 'stopped'
            },
            destroy: async (name) => {
                destroys.push(name)
            },
        })

        await reconcileHostedRuntimeJob(env, runtimeMessage())

        expect(starts).toHaveLength(1)
        expect(destroys).toEqual(['workspace:workspace_1:room:room_1'])
        expect(updates.some((update) => /status = 'failed'/.test(update.sql))).toBe(false)
        expect(
            batches.some((batch) =>
                batch.some(
                    (update) =>
                        update.args.includes('running') &&
                        /desired_state\s+=\s+'running'/.test(update.sql),
                ),
            ),
        ).toBe(true)
    })

    it('marks only managed hosted OpenRouter runtimes for managed cost truth', async () => {
        const starts: Array<{ name: string; args: unknown }> = []
        const fetches: RecordedContainerFetch[] = []
        const env = hostedEnv({
            fetches,
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
            roomConfigRow: {
                providerMode: 'managed_hosted',
                providerConnectionId: null,
            },
            workspaceSettingsRow: {
                defaultProviderConnectionId: null,
                defaultModel: null,
            },
            start: async (name, args) => {
                starts.push({ name, args })
            },
        })

        await reconcileHostedRuntimeJob(env, runtimeMessage())

        expect(runtimeEnvVars(starts[0]?.args)?.[hostedRuntimeManagedOpenRouterEnvKey]).toBe('1')
        const bundle = decodeRuntimeBundle(fetches)
        const runtimeConfig = JSON.parse(
            bundledFileText(bundle, hostedRuntimeConfigPath),
        ) as Record<string, unknown>
        expect(runtimeConfig).toMatchObject({
            provider: {
                sourceProvider: 'openrouter',
                sourceModel: hostedManagedModelId,
            },
        })
    })

    it('does not materialize app image secrets for a room-scoped image provider', async () => {
        const starts: Array<{ name: string; args: unknown }> = []
        const fetches: RecordedContainerFetch[] = []
        const env = hostedEnv({
            fetches,
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
        const bundle = decodeRuntimeBundle(fetches)
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

    it('fails closed without materializing when stripe billing has no active subscription even with BYOK', async () => {
        const updates: RuntimeUpdate[] = []
        const starts: Array<{ name: string; args: unknown }> = []
        const destroys: string[] = []
        const puts: string[] = []
        const env = hostedEnv({
            updates,
            puts,
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

    it('reuses the persisted runtime token across reconciles so a running container keeps matching', async () => {
        const updates: RuntimeUpdate[] = []
        const puts: string[] = []
        const starts: Array<{ name: string; args: unknown }> = []
        const fetches: RecordedContainerFetch[] = []
        const tokenValue = 'persistent-runtime-token-value-bbbbbbbb'
        const env = hostedEnv({
            updates,
            puts,
            fetches,
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
        expect(nextTokenKey).toBeUndefined()
        const startArgs = starts[0]?.args as { startOptions: { envVars: Record<string, string> } }
        expect(startArgs.startOptions.envVars.AGENT_ROOM_PI_RUNTIME_TOKEN).toBe(tokenValue)
        const bundlePush = fetches.find((recorded) => recorded.url.endsWith('/boot/materialize'))
        expect(bundlePush?.authorization).toBe(`Bearer ${tokenValue}`)
        expect(
            updates.some(
                (update) =>
                    /UPDATE\s+hosted_room_runtime_state/.test(update.sql) &&
                    update.args.includes(
                        'workspaces/workspace_1/rooms/room_1/runtime/token-v2.txt',
                    ),
            ),
        ).toBe(true)
    })

    it('rotates on a warm start when the persisted token object is unreadable so a wedged room self-heals', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
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
                'workspaces/workspace_1/rooms/room_1/runtime/bundle-v3.json',
            ],
            runtimeRow: {
                roomId: 'room_1',
                workspaceId: 'workspace_1',
                desiredState: 'running',
                containerName: 'workspace:workspace_1:room:room_1',
                configObjectKey: 'workspaces/workspace_1/rooms/room_1/runtime/config-v3.json',
                tokenObjectKey: 'workspaces/workspace_1/rooms/room_1/runtime/token-missing.txt',
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

        try {
            await reconcileHostedRuntimeJob(env, runtimeMessage())

            expect(starts).toHaveLength(1)
            const nextTokenKey = puts.find((key) =>
                /^workspaces\/workspace_1\/rooms\/room_1\/runtime\/token-v3-[^.]+\.txt$/.test(key),
            )
            expect(nextTokenKey).toBeTruthy()
            const startArgs = starts[0]?.args as {
                startOptions: { envVars: Record<string, string> }
            }
            expect(startArgs.startOptions.envVars.AGENT_ROOM_PI_RUNTIME_TOKEN).toBeTruthy()
            expect(startArgs.startOptions.envVars.AGENT_ROOM_PI_RUNTIME_TOKEN).not.toBe(tokenValue)
            expect(errorSpy).toHaveBeenCalledWith(
                'Hosted runtime token object unreadable, rotating',
                expect.objectContaining({
                    workspaceId: 'workspace_1',
                    roomId: 'room_1',
                    tokenObjectKey: 'workspaces/workspace_1/rooms/room_1/runtime/token-missing.txt',
                }),
            )
        } finally {
            errorSpy.mockRestore()
        }
    })

    it('rotates the runtime token when the reconcile explicitly requests rotation', async () => {
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

        await reconcileHostedRuntimeJob(env, runtimeMessage({ rotateToken: true }))

        expect(starts).toHaveLength(1)
        const nextTokenKey = puts.find((key) =>
            /^workspaces\/workspace_1\/rooms\/room_1\/runtime\/token-v3-[^.]+\.txt$/.test(key),
        )
        expect(nextTokenKey).toBeTruthy()
        const startArgs = starts[0]?.args as { startOptions: { envVars: Record<string, string> } }
        expect(startArgs.startOptions.envVars.AGENT_ROOM_PI_RUNTIME_TOKEN).toBeTruthy()
        expect(startArgs.startOptions.envVars.AGENT_ROOM_PI_RUNTIME_TOKEN).not.toBe(tokenValue)
        const materializeUpdate = updates.find((update) =>
            /UPDATE hosted_room_runtime_state[\s\S]*previous_token_hash = \?12/.test(update.sql),
        )
        expect(materializeUpdate?.args[11]).toBe(await hostedRuntimeTokenSha256Hex(tokenValue))
        expect(materializeUpdate?.args[12]).toBeNull()
    })

    it('recreates a stale-token-heal container once when the boot-ready probe rejects the rotated token, then succeeds', async () => {
        const updates: RuntimeUpdate[] = []
        const puts: string[] = []
        const starts: Array<{ name: string; args: unknown }> = []
        const destroys: string[] = []
        const fetches: RecordedContainerFetch[] = []
        const currentTokenValue = 'current-runtime-token-value-bbbbbbbb'
        const staleContainerTokenValue = 'stale-container-token-value-aaaaaaaa'
        const env = hostedEnv({
            updates,
            puts,
            fetches,
            tokenValue: currentTokenValue,
            readyStatuses: [401],
            pushStatuses: [200],
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
                previousTokenHash: await hostedRuntimeTokenSha256Hex(staleContainerTokenValue),
                staleTokenHealEnqueuedAt: new Date(0).toISOString(),
                configVersion: 3,
                tokenVersion: 2,
                workspaceSnapshotKey: null,
            },
            start: async (name, args) => {
                starts.push({ name, args })
            },
            destroy: async (name) => {
                destroys.push(name)
            },
        })

        await reconcileHostedRuntimeJob(env, runtimeMessage({ rotateToken: true }))

        expect(destroys).toEqual(['workspace:workspace_1:room:room_1'])
        expect(starts).toHaveLength(2)
        const firstStartToken = runtimeEnvVars(starts[0]?.args)?.AGENT_ROOM_PI_RUNTIME_TOKEN
        const recreatedStartToken = runtimeEnvVars(starts[1]?.args)?.AGENT_ROOM_PI_RUNTIME_TOKEN
        expect(firstStartToken).toBeTruthy()
        expect(recreatedStartToken).toBe(firstStartToken)
        expect(recreatedStartToken).not.toBe(currentTokenValue)
        expect(recreatedStartToken).not.toBe(staleContainerTokenValue)
        const nextTokenKey = puts.find((key) =>
            /^workspaces\/workspace_1\/rooms\/room_1\/runtime\/token-v3-[^.]+\.txt$/.test(key),
        )
        expect(nextTokenKey).toBeTruthy()
        const readyProbes = fetches.filter((recorded) => recorded.url.endsWith('/boot/ready'))
        expect(readyProbes[0]?.responseStatus).toBe(401)
        expect(readyProbes[0]?.authorization).toBe(`Bearer ${firstStartToken}`)
        const materializePushes = fetches.filter((recorded) =>
            recorded.url.endsWith('/boot/materialize'),
        )
        expect(materializePushes).toHaveLength(1)
        expect(materializePushes[0]?.authorization).toBe(`Bearer ${recreatedStartToken}`)
        const materializeUpdate = updates.find((update) =>
            /UPDATE hosted_room_runtime_state[\s\S]*previous_token_hash = \?12/.test(update.sql),
        )
        expect(materializeUpdate?.args[11]).toBe(
            await hostedRuntimeTokenSha256Hex(currentTokenValue),
        )
        expect(materializeUpdate?.args[12]).toBeNull()
        expect(updates.some((update) => update.args.includes('running'))).toBe(true)
        expect(updates.some((update) => /status = 'failed'/.test(update.sql))).toBe(false)
    })

    it('fails closed when the boot push is still rejected after a single recreate', async () => {
        const updates: RuntimeUpdate[] = []
        const starts: Array<{ name: string; args: unknown }> = []
        const destroys: string[] = []
        const env = hostedEnv({
            updates,
            pushStatuses: [401, 401],
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

        await expect(reconcileHostedRuntimeJob(env, runtimeMessage())).rejects.toThrow(/stale/)

        expect(starts).toHaveLength(2)
        expect(destroys.length).toBeGreaterThanOrEqual(1)
        expect(updates.some((update) => /status = 'failed'/.test(update.sql))).toBe(true)
    })

    it('recovers in a single reconcile when the destroyed container lingers before stopping', async () => {
        const updates: RuntimeUpdate[] = []
        const starts: Array<{ name: string; args: unknown }> = []
        const destroys: string[] = []
        const fetches: RecordedContainerFetch[] = []
        const env = hostedEnv({
            updates,
            fetches,
            pushStatuses: [401, 200],
            containerStopLingerPolls: 3,
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

        await reconcileHostedRuntimeJob(env, runtimeMessage(), { attempt: 1, maxAttempts: 4 })

        expect(destroys).toEqual(['workspace:workspace_1:room:room_1'])
        expect(starts).toHaveLength(2)
        expect(updates.some((update) => update.args.includes('running'))).toBe(true)
        expect(updates.some((update) => /status = 'failed'/.test(update.sql))).toBe(false)
    })

    it('defers a lingering recreate to a queue retry without failing closed, then the retry succeeds', async () => {
        const firstUpdates: RuntimeUpdate[] = []
        const firstStarts: Array<{ name: string; args: unknown }> = []
        const firstDestroys: string[] = []
        const deferredEnv = hostedEnv({
            updates: firstUpdates,
            pushStatuses: [401],
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
                firstStarts.push({ name, args })
                if (firstStarts.length === 2) {
                    throw new Error('container port bind raced the dying instance')
                }
            },
            destroy: async (name) => {
                firstDestroys.push(name)
            },
        })

        await expect(
            reconcileHostedRuntimeJob(deferredEnv, runtimeMessage(), {
                attempt: 1,
                maxAttempts: 4,
            }),
        ).rejects.toBeInstanceOf(HostedRuntimeRecreateDeferredError)

        expect(firstDestroys).toEqual(['workspace:workspace_1:room:room_1'])
        expect(firstStarts).toHaveLength(2)
        expect(firstUpdates.some((update) => /status = 'failed'/.test(update.sql))).toBe(false)
        expect(firstUpdates.some((update) => /desired_state = 'stopped'/.test(update.sql))).toBe(
            false,
        )

        const retryStarts: Array<{ name: string; args: unknown }> = []
        const retryUpdates: RuntimeUpdate[] = []
        const retryEnv = hostedEnv({
            updates: retryUpdates,
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
                retryStarts.push({ name, args })
            },
        })

        await reconcileHostedRuntimeJob(retryEnv, runtimeMessage(), { attempt: 2, maxAttempts: 4 })

        expect(retryStarts).toHaveLength(1)
        expect(retryUpdates.some((update) => update.args.includes('running'))).toBe(true)
        expect(retryUpdates.some((update) => /status = 'failed'/.test(update.sql))).toBe(false)
    })

    it('fails closed to paused when a lingering recreate is still deferred on the final delivery', async () => {
        const updates: RuntimeUpdate[] = []
        const starts: Array<{ name: string; args: unknown }> = []
        const destroys: string[] = []
        const env = hostedEnv({
            updates,
            pushStatuses: [401],
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
                if (starts.length === 2) {
                    throw new Error('container port bind raced the dying instance')
                }
            },
            destroy: async (name) => {
                destroys.push(name)
            },
        })

        await expect(
            reconcileHostedRuntimeJob(env, runtimeMessage(), { attempt: 4, maxAttempts: 4 }),
        ).rejects.toBeInstanceOf(HostedRuntimeRecreateDeferredError)

        expect(starts).toHaveLength(2)
        expect(destroys.length).toBeGreaterThanOrEqual(1)
        expect(updates.some((update) => /status = 'failed'/.test(update.sql))).toBe(true)
    })
})

describe('confirmHostedRuntimeContainerStopped', () => {
    function lingeringContainer(statuses: Array<'running' | 'healthy' | 'stopped'>) {
        const queue = [...statuses]
        return {
            getState: async () => ({
                status: queue.length > 1 ? queue.shift()! : (queue[0] ?? 'stopped'),
                lastChange: 0,
            }),
        } as unknown as HostedRuntimeContainerStub
    }

    it('resolves once the container reports a non-running status within the bound', async () => {
        const container = lingeringContainer(['healthy', 'healthy', 'stopped'])
        await expect(
            confirmHostedRuntimeContainerStopped({
                container,
                timeoutMs: 1000,
                intervalMs: 1,
            }),
        ).resolves.toBeUndefined()
    })

    it('defers fast, well under the port timeout, when the container never stops', async () => {
        const container = lingeringContainer(['healthy'])
        const startedAt = Date.now()
        await expect(
            confirmHostedRuntimeContainerStopped({
                container,
                timeoutMs: 30,
                intervalMs: 5,
            }),
        ).rejects.toBeInstanceOf(HostedRuntimeRecreateDeferredError)
        expect(Date.now() - startedAt).toBeLessThan(180000)
    })
})

describe('waitForHostedRuntimeReady', () => {
    function readinessContainer(statuses: number[]): HostedRuntimeContainerStub {
        const queue = [...statuses]
        return {
            fetch: async (request: Request) => {
                const requestUrl = new URL(request.url)
                if (requestUrl.pathname === '/boot/ready') {
                    const status = queue.length > 1 ? queue.shift()! : (queue[0] ?? 503)
                    return new Response(JSON.stringify({ ready: status === 200 }), { status })
                }
                return new Response('{}', { status: 200 })
            },
        } as unknown as HostedRuntimeContainerStub
    }

    it('resolves once the runtime reports ready', async () => {
        const container = readinessContainer([503, 503, 200])
        await expect(
            waitForHostedRuntimeReady({
                container,
                token: 't'.repeat(24),
                timeoutMs: 1000,
                intervalMs: 1,
            }),
        ).resolves.toBeUndefined()
    })

    it('fails closed when readiness never flips before the timeout', async () => {
        const container = readinessContainer([503])
        await expect(
            waitForHostedRuntimeReady({
                container,
                token: 't'.repeat(24),
                timeoutMs: 20,
                intervalMs: 5,
            }),
        ).rejects.toThrow(/ready/)
    })

    it('treats a stale-token readiness rejection as unauthorized', async () => {
        const container = readinessContainer([401])
        await expect(
            waitForHostedRuntimeReady({
                container,
                token: 't'.repeat(24),
                timeoutMs: 1000,
                intervalMs: 5,
            }),
        ).rejects.toThrow(/stale/)
    })
})

describe('hosted runtime auto-resume on user send', () => {
    function stubRuntimeJobQueue(env: AgentRoomHostedEnv): { sent: unknown[] } {
        const sent: unknown[] = []
        env.AGENT_ROOM_RUNTIME_JOBS = {
            send: async (message: unknown) => {
                sent.push(message)
            },
        } as unknown as AgentRoomHostedEnv['AGENT_ROOM_RUNTIME_JOBS']
        return { sent }
    }

    it('resumes a desired-stopped room on an authenticated user send, then boots and runs', async () => {
        const updates: RuntimeUpdate[] = []
        const starts: Array<{ name: string; args: unknown }> = []
        let desiredStateReads = 0
        const env = hostedEnv({
            updates,
            billingAccountRow: { planStatus: 'active' },
            activeRuntimeCountRow: { activeCount: 0 },
            objectKeys: ['workspaces/workspace_1/rooms/room_1/runtime/config.json'],
            desiredState: () => 'running',
            preStartDesiredState: () => {
                desiredStateReads += 1
                return desiredStateReads === 1 ? 'stopped' : 'running'
            },
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
        const queue = stubRuntimeJobQueue(env)

        let runCalls = 0
        const result = await withHostedRuntimeStarted({
            env,
            workspaceId: 'workspace_1',
            roomId: 'room_1',
            actorUserId: 'user_1',
            autoResume: true,
            run: async () => {
                runCalls += 1
                if (runCalls === 1) {
                    throw new Error('Hosted runtime is not running')
                }
                return 'ran'
            },
        })

        expect(result).toBe('ran')
        expect(runCalls).toBe(2)
        expect(
            updates.some(
                (update) =>
                    /UPDATE\s+hosted_room\b/.test(update.sql) &&
                    /desired_state = 'running'/.test(update.sql),
            ),
        ).toBe(true)
        expect(queue.sent).toHaveLength(1)
        expect(starts).toHaveLength(1)
    })

    it('delivers a paused-room send after waiting for readiness when the inline reconcile is superseded by the racing queue reconcile', async () => {
        const updates: RuntimeUpdate[] = []
        const batches: RuntimeUpdate[][] = []
        const tokenObjectKey = 'workspaces/workspace_1/rooms/room_1/runtime/token'
        let desiredStateReads = 0
        let containerStatusReads = 0
        const env = hostedEnv({
            updates,
            batches,
            billingAccountRow: { planStatus: 'active' },
            activeRuntimeCountRow: { activeCount: 0 },
            objectKeys: ['workspaces/workspace_1/rooms/room_1/runtime/config.json', tokenObjectKey],
            forceBootReady: true,
            materializeCasConflictOnCall: 1,
            desiredState: () => 'running',
            preStartDesiredState: () => {
                desiredStateReads += 1
                return desiredStateReads === 1 ? 'stopped' : 'running'
            },
            containerStatus: () => {
                containerStatusReads += 1
                return containerStatusReads >= 2 ? 'healthy' : 'stopped'
            },
            runtimeRow: {
                roomId: 'room_1',
                workspaceId: 'workspace_1',
                desiredState: 'running',
                containerName: 'workspace:workspace_1:room:room_1',
                configObjectKey: 'workspaces/workspace_1/rooms/room_1/runtime/config.json',
                tokenObjectKey,
                workspaceSnapshotKey: null,
            },
        })
        const queue = stubRuntimeJobQueue(env)

        let runCalls = 0
        const result = await withHostedRuntimeStarted({
            env,
            workspaceId: 'workspace_1',
            roomId: 'room_1',
            actorUserId: 'user_1',
            autoResume: true,
            run: async () => {
                runCalls += 1
                if (!hasHealthyRunningTransition(batches)) {
                    throw new Error('Hosted runtime is not healthy')
                }
                return 'ran'
            },
        })

        expect(result).toBe('ran')
        expect(runCalls).toBe(2)
        expect(queue.sent).toHaveLength(1)
        expect(hasHealthyRunningTransition(batches)).toBe(true)
    })

    it('does not auto-resume a send that is not flagged as an authenticated user send', async () => {
        const updates: RuntimeUpdate[] = []
        const starts: Array<{ name: string; args: unknown }> = []
        const env = hostedEnv({
            updates,
            billingAccountRow: { planStatus: 'active' },
            activeRuntimeCountRow: { activeCount: 0 },
            objectKeys: ['workspaces/workspace_1/rooms/room_1/runtime/config.json'],
            desiredState: () => 'stopped',
            runtimeRow: {
                roomId: 'room_1',
                workspaceId: 'workspace_1',
                desiredState: 'stopped',
                containerName: 'workspace:workspace_1:room:room_1',
                configObjectKey: 'workspaces/workspace_1/rooms/room_1/runtime/config.json',
                workspaceSnapshotKey: null,
            },
            start: async (name, args) => {
                starts.push({ name, args })
            },
        })
        stubRuntimeJobQueue(env)

        await expect(
            withHostedRuntimeStarted({
                env,
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                run: async () => {
                    throw new Error('Hosted runtime is not running')
                },
            }),
        ).rejects.toThrow(/not running/)

        expect(updates.some((update) => /desired_state = 'running'/.test(update.sql))).toBe(false)
        expect(starts).toHaveLength(0)
    })

    it('fails closed with the room-limit message and does not transition an over-limit paused room', async () => {
        const updates: RuntimeUpdate[] = []
        const starts: Array<{ name: string; args: unknown }> = []
        const env = hostedEnv({
            updates,
            billingAccountRow: { planStatus: 'active' },
            activeRuntimeCountRow: { activeCount: 3 },
            objectKeys: ['workspaces/workspace_1/rooms/room_1/runtime/config.json'],
            desiredState: () => 'stopped',
            preStartDesiredState: () => 'stopped',
            runtimeRow: {
                roomId: 'room_1',
                workspaceId: 'workspace_1',
                desiredState: 'stopped',
                containerName: 'workspace:workspace_1:room:room_1',
                configObjectKey: 'workspaces/workspace_1/rooms/room_1/runtime/config.json',
                workspaceSnapshotKey: null,
            },
            start: async (name, args) => {
                starts.push({ name, args })
            },
        })
        stubRuntimeJobQueue(env)

        await expect(
            withHostedRuntimeStarted({
                env,
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                actorUserId: 'user_1',
                autoResume: true,
                run: async () => {
                    throw new Error('Hosted runtime is not running')
                },
            }),
        ).rejects.toThrow(/Room limit reached/)

        expect(updates.some((update) => /desired_state = 'running'/.test(update.sql))).toBe(false)
        expect(starts).toHaveLength(0)
    })

    it('queue reconcile does not resurrect a desired-stopped room', async () => {
        const updates: RuntimeUpdate[] = []
        const starts: Array<{ name: string; args: unknown }> = []
        const destroys: string[] = []
        const env = hostedEnv({
            updates,
            desiredState: () => 'stopped',
            objectKeys: ['workspaces/workspace_1/rooms/room_1/runtime/config.json'],
            runtimeRow: {
                roomId: 'room_1',
                workspaceId: 'workspace_1',
                desiredState: 'stopped',
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
        expect(destroys).toHaveLength(0)
        expect(updates.some((update) => /desired_state = 'running'/.test(update.sql))).toBe(false)
        expect(updates.some((update) => /status = 'failed'/.test(update.sql))).toBe(false)
    })
})

function hasHealthyRunningTransition(batches: RuntimeUpdate[][]): boolean {
    return batches.some((batch) => {
        const runtimeStatement = batch.find((statement) =>
            /UPDATE hosted_room_runtime_state[\s\S]*started_at = COALESCE/.test(statement.sql),
        )
        const roomStatement = batch.find((statement) =>
            /UPDATE hosted_room\b[\s\S]*status = \?1/.test(statement.sql),
        )
        return (
            runtimeStatement !== undefined &&
            runtimeStatement.args[0] === 'healthy' &&
            roomStatement !== undefined &&
            roomStatement.args[0] === 'running'
        )
    })
}

describe('hosted runtime health convergence after superseded materialization', () => {
    const tokenObjectKey = 'workspaces/workspace_1/rooms/room_1/runtime/token'

    it('converges the D1 row to running/healthy when the container is already ready', async () => {
        const batches: RuntimeUpdate[][] = []
        const env = hostedEnv({
            batches,
            objectKeys: [tokenObjectKey],
            forceBootReady: true,
            runtimeRow: {
                healthStatus: 'unknown',
                tokenObjectKey,
                configObjectKey: 'workspaces/workspace_1/rooms/room_1/runtime/config.json',
                runtimeBundleObjectKey: 'workspaces/workspace_1/rooms/room_1/runtime/bundle.json',
            },
        })

        const converged = await convergeHostedRuntimeHealthIfReady({
            env,
            workspaceId: 'workspace_1',
            roomId: 'room_1',
        })

        expect(converged).toBe(true)
        expect(hasHealthyRunningTransition(batches)).toBe(true)
    })

    it('does not converge when the container is not up', async () => {
        const batches: RuntimeUpdate[][] = []
        const env = hostedEnv({
            batches,
            objectKeys: [tokenObjectKey],
            forceBootReady: true,
            containerStatus: () => 'stopped',
            runtimeRow: {
                healthStatus: 'unknown',
                tokenObjectKey,
            },
        })

        const converged = await convergeHostedRuntimeHealthIfReady({
            env,
            workspaceId: 'workspace_1',
            roomId: 'room_1',
        })

        expect(converged).toBe(false)
        expect(hasHealthyRunningTransition(batches)).toBe(false)
    })

    it('does not converge when the container boot endpoint is not ready', async () => {
        const batches: RuntimeUpdate[][] = []
        const env = hostedEnv({
            batches,
            objectKeys: [tokenObjectKey],
            forceBootReady: false,
            runtimeRow: {
                healthStatus: 'unknown',
                tokenObjectKey,
            },
        })

        const converged = await convergeHostedRuntimeHealthIfReady({
            env,
            workspaceId: 'workspace_1',
            roomId: 'room_1',
        })

        expect(converged).toBe(false)
        expect(hasHealthyRunningTransition(batches)).toBe(false)
    })

    it('does not converge when the room is no longer desired running', async () => {
        const batches: RuntimeUpdate[][] = []
        const env = hostedEnv({
            batches,
            objectKeys: [tokenObjectKey],
            forceBootReady: true,
            desiredState: () => 'stopped',
            runtimeRow: {
                healthStatus: 'unknown',
                tokenObjectKey,
            },
        })

        const converged = await convergeHostedRuntimeHealthIfReady({
            env,
            workspaceId: 'workspace_1',
            roomId: 'room_1',
        })

        expect(converged).toBe(false)
        expect(hasHealthyRunningTransition(batches)).toBe(false)
    })
})
