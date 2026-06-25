import type { D1Database, R2Bucket } from '@cloudflare/workers-types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { capabilityIds, type CapabilityId } from '#/domain/domain-types'
import type { AppCapabilitySettingsSaveInput } from '../configuration/operator-configuration'
import type { AgentRoomHostedEnv } from './bindings'
import type { HostedActor } from './hosted-auth'
import { hostedSearchDefaults } from './hosted-operator-config-service'
import {
    updateHostedAppCapabilitySettings,
    updateHostedAppDefaults,
} from './hosted-operator-config-write-service'

function capabilityDefaults(): Record<CapabilityId, boolean> {
    return Object.fromEntries(capabilityIds.map((id) => [id, true])) as Record<
        CapabilityId,
        boolean
    >
}

function capabilityInput(
    input: Partial<AppCapabilitySettingsSaveInput> = {},
): AppCapabilitySettingsSaveInput {
    return {
        capabilityDefaults: capabilityDefaults(),
        search: {
            ...hostedSearchDefaults,
            brave: {
                enabled: false,
                country: null,
                searchLang: null,
                safeSearch: 'moderate',
                timeoutMs: 10000,
                resultCount: 5,
            },
            browserbase: {
                enabled: false,
                timeoutMs: 10000,
                resultCount: 5,
            },
        },
        image: {
            provider: null,
            model: null,
        },
        ...input,
    }
}

function settingsRow() {
    const now = new Date('2026-06-24T00:00:00.000Z').toISOString()
    return {
        workspaceId: 'workspace_1',
        defaultProviderConnectionId: null,
        defaultModel: null,
        capabilityDefaults: JSON.stringify(capabilityDefaults()),
        searchConfig: JSON.stringify({
            ...hostedSearchDefaults,
            brave: {
                enabled: false,
                country: null,
                searchLang: null,
                safeSearch: 'moderate',
                timeoutMs: 10000,
                resultCount: 5,
                secretId: null,
            },
            browserbase: {
                enabled: false,
                timeoutMs: 10000,
                resultCount: 5,
                secretId: null,
            },
        }),
        imageConfig: JSON.stringify({
            provider: null,
            model: null,
            secretId: null,
        }),
        onboardingCompletedAt: null,
        createdAt: now,
        updatedAt: now,
    }
}

function hostedEnv(): {
    env: AgentRoomHostedEnv
    auditActions: string[]
    secretWrites: string[]
} {
    const workspaceSettings = settingsRow()
    const auditActions: string[] = []
    const secretWrites: string[] = []
    const db = {
        prepare: (sql: string) => ({
            bind: (...args: unknown[]) => ({
                first: async () => {
                    if (/FROM hosted_workspace_settings/.test(sql)) {
                        return workspaceSettings
                    }
                    if (/FROM hosted_secret/.test(sql)) {
                        return null
                    }
                    return null
                },
                all: async () => ({
                    results: [],
                }),
                run: async () => {
                    if (/INSERT INTO hosted_audit_event/.test(sql)) {
                        auditActions.push(String(args[3]))
                    }
                    if (/INSERT INTO hosted_secret/.test(sql)) {
                        secretWrites.push(String(args[2]))
                    }
                    return {
                        meta: {
                            changes: 1,
                        },
                    }
                },
            }),
        }),
    } as unknown as D1Database
    return {
        env: {
            AGENT_ROOM_DB: db,
            AGENT_ROOM_WORKSPACE_BUCKET: {} as R2Bucket,
            AGENT_ROOM_RUNTIME_JOBS: {} as AgentRoomHostedEnv['AGENT_ROOM_RUNTIME_JOBS'],
            AGENT_ROOM_RUNTIME: {} as AgentRoomHostedEnv['AGENT_ROOM_RUNTIME'],
            AGENT_ROOM_AUTH_MODE: 'better-auth',
            AGENT_ROOM_BILLING_USAGE_MARKUP_BPS: '13000',
            AGENT_ROOM_BILLING_TAX_MODE: 'automatic',
            AGENT_ROOM_BILLING_MAX_CONCURRENT_ROOMS: '3',
            AGENT_ROOM_RUNTIME_BACKEND: 'cloudflare-containers',
            AGENT_ROOM_RUNTIME_STORAGE: 'r2',
            BETTER_AUTH_SECRET: 'a'.repeat(32),
            BETTER_AUTH_URL: 'https://rooms.example.test',
            AGENT_ROOM_HOSTED_ENCRYPTION_KEY_B64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
            STRIPE_SECRET_KEY: 'stripe-secret-test-value',
            STRIPE_WEBHOOK_SECRET: 'stripe-webhook-test-value',
            AGENT_ROOM_EMAIL_WEBHOOK_URL: 'https://mail.example.test/send',
            AGENT_ROOM_EMAIL_WEBHOOK_BEARER_TOKEN: 'b'.repeat(16),
            AGENT_ROOM_EMAIL_FROM: 'Agent Room <noreply@example.test>',
            AGENT_ROOM_HOSTED_OPENROUTER_API_KEY: 'openrouter-platform-key',
            AGENT_ROOM_HOSTED_BRAVE_API_KEY: 'brave-platform-key',
            AGENT_ROOM_HOSTED_BROWSERBASE_API_KEY: 'browserbase-platform-key',
        },
        auditActions,
        secretWrites,
    }
}

function actor(): HostedActor {
    return {
        authProvider: 'better-auth',
        userId: 'user_1',
        sessionId: 'session_1',
        email: 'user@example.test',
        workspaceId: 'workspace_1',
    }
}

describe('hosted operator config writes', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('does not write capability secrets when hosted search backend validation fails', async () => {
        const store = hostedEnv()

        await expect(
            updateHostedAppCapabilitySettings({
                env: store.env,
                actor: actor(),
                data: capabilityInput({
                    search: {
                        ...hostedSearchDefaults,
                        backendUrl: 'https://search.example.test',
                        brave: {
                            enabled: true,
                            country: null,
                            searchLang: null,
                            safeSearch: 'moderate',
                            timeoutMs: 10000,
                            resultCount: 5,
                            apiKey: 'brave-key',
                        },
                        browserbase: {
                            enabled: true,
                            timeoutMs: 10000,
                            resultCount: 5,
                            apiKey: 'browserbase-key',
                        },
                    },
                }),
            }),
        ).rejects.toThrow('Hosted search backend URL is fixed by the hosted deployment')

        expect(store.secretWrites).toEqual([])
    })

    it('does not write hosted search secrets when provider validation rejects the credential', async () => {
        const store = hostedEnv()
        const fetchMock = vi.fn(async () => new Response('invalid key', { status: 401 }))
        vi.stubGlobal('fetch', fetchMock)

        await expect(
            updateHostedAppCapabilitySettings({
                env: store.env,
                actor: actor(),
                data: capabilityInput({
                    search: {
                        ...hostedSearchDefaults,
                        brave: {
                            enabled: true,
                            country: null,
                            searchLang: null,
                            safeSearch: 'moderate',
                            timeoutMs: 10000,
                            resultCount: 5,
                            apiKey: 'brave-key',
                        },
                        browserbase: {
                            enabled: false,
                            timeoutMs: 10000,
                            resultCount: 5,
                        },
                    },
                }),
            }),
        ).rejects.toThrow('Brave Search validation failed')

        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(store.secretWrites).toEqual([])
        expect(store.auditActions).not.toContain('operator.capabilities.saved')
    })

    it('validates hosted search credentials through the provider before writing them', async () => {
        const store = hostedEnv()
        const fetchMock = vi.fn(async () =>
            Response.json({
                web: {
                    results: [
                        {
                            title: 'Agent Room',
                            url: 'https://example.test/agent-room',
                            description: 'A result',
                        },
                    ],
                },
            }),
        )
        vi.stubGlobal('fetch', fetchMock)

        await updateHostedAppCapabilitySettings({
            env: store.env,
            actor: actor(),
            data: capabilityInput({
                search: {
                    ...hostedSearchDefaults,
                    brave: {
                        enabled: true,
                        country: null,
                        searchLang: null,
                        safeSearch: 'moderate',
                        timeoutMs: 10000,
                        resultCount: 5,
                        apiKey: 'brave-key',
                    },
                    browserbase: {
                        enabled: false,
                        timeoutMs: 10000,
                        resultCount: 5,
                    },
                },
            }),
        })

        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(store.secretWrites).toEqual(['app_search:brave'])
        expect(store.auditActions).toContain('operator.capabilities.saved')
    })

    it('validates all hosted search credentials before writing any provided key', async () => {
        const store = hostedEnv()

        await expect(
            updateHostedAppCapabilitySettings({
                env: store.env,
                actor: actor(),
                data: capabilityInput({
                    search: {
                        ...hostedSearchDefaults,
                        brave: {
                            enabled: true,
                            country: null,
                            searchLang: null,
                            safeSearch: 'moderate',
                            timeoutMs: 10000,
                            resultCount: 5,
                            apiKey: 'brave-key',
                        },
                        browserbase: {
                            enabled: true,
                            timeoutMs: 10000,
                            resultCount: 5,
                        },
                    },
                }),
            }),
        ).rejects.toThrow('browserbase search API key is required when enabling search')

        expect(store.secretWrites).toEqual([])
    })

    it('does not write image secrets when the hosted image provider is incomplete', async () => {
        const store = hostedEnv()

        await expect(
            updateHostedAppCapabilitySettings({
                env: store.env,
                actor: actor(),
                data: capabilityInput({
                    image: {
                        provider: 'openai',
                        model: null,
                        apiKey: 'image-key',
                    },
                }),
            }),
        ).rejects.toThrow('Default image model is required when image generation is enabled')

        expect(store.secretWrites).toEqual([])
    })

    it('audits hosted app default updates', async () => {
        const store = hostedEnv()

        await updateHostedAppDefaults({
            env: store.env,
            actor: actor(),
            data: {
                defaultProviderConnectionId: null,
                defaultModel: null,
                onboardingCompleted: true,
            },
        })

        expect(store.auditActions).toContain('operator.defaults.saved')
    })

    it('audits hosted capability, search, and image setting updates without secret values', async () => {
        const store = hostedEnv()

        await updateHostedAppCapabilitySettings({
            env: store.env,
            actor: actor(),
            data: capabilityInput(),
        })

        expect(store.auditActions).toContain('operator.capabilities.saved')
    })
})
