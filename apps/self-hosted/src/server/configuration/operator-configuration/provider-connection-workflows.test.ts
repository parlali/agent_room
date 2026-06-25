import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
    AppProviderConnectionRecord,
    AppSettingsRecord,
    SecretRecord,
} from '#/domain/domain-types'
import type { CodexAppAuthStatus } from '../codex-auth'
import type { ProviderSaveInput } from './contracts'

const now = new Date('2026-06-11T00:00:00.000Z')

const mocks = vi.hoisted(() => ({
    state: {
        providers: [] as AppProviderConnectionRecord[],
        settings: null as AppSettingsRecord | null,
        validationAttempts: [] as Record<string, unknown>[],
        audits: [] as Record<string, unknown>[],
        createdSecrets: [] as string[],
        codexAuth: {
            ready: false,
            status: 'missing',
            accountId: null,
            expiresAt: null,
            message: 'Codex app server login is missing',
        } as CodexAppAuthStatus,
    },
    validateProviderConnection: vi.fn(),
}))

function buildSettings(input: Partial<AppSettingsRecord> = {}): AppSettingsRecord {
    return {
        id: true,
        defaultProviderConnectionId: null,
        defaultModel: null,
        capabilityDefaults: {},
        searchConfig: {},
        imageConfig: {},
        onboardingCompletedAt: null,
        createdAt: now,
        updatedAt: now,
        ...input,
    }
}

function buildSecret(input: { id: string; keyName: string }): SecretRecord {
    return {
        id: input.id,
        keyName: input.keyName,
        cipherText: Buffer.alloc(0),
        nonce: Buffer.alloc(0),
        authTag: Buffer.alloc(0),
        keyVersion: 1,
        createdAt: now,
        updatedAt: now,
    }
}

vi.mock('../../db/repositories', () => ({
    appProviderConnectionRepository: {
        findById: vi.fn(
            async (id: string) =>
                mocks.state.providers.find((provider) => provider.id === id) ?? null,
        ),
        findByProvider: vi.fn(
            async (provider: string) =>
                mocks.state.providers.find((connection) => connection.provider === provider) ??
                null,
        ),
        list: vi.fn(async () => mocks.state.providers),
        countRoomReferences: vi.fn(async () => 0),
        deleteByIdIfUnused: vi.fn(async () => true),
        upsert: vi.fn(
            async (
                input: Omit<
                    AppProviderConnectionRecord,
                    'createdAt' | 'updatedAt' | 'createdByUserId'
                > & {
                    createdByUserId: string | null
                },
            ) => {
                const saved: AppProviderConnectionRecord = {
                    ...input,
                    createdAt: now,
                    updatedAt: now,
                }
                const existingIndex = mocks.state.providers.findIndex(
                    (provider) => provider.id === input.id,
                )
                if (existingIndex >= 0) {
                    mocks.state.providers[existingIndex] = saved
                } else {
                    mocks.state.providers.push(saved)
                }
                return saved
            },
        ),
    },
    appSettingsRepository: {
        getOrCreate: vi.fn(async () => {
            if (!mocks.state.settings) {
                mocks.state.settings = buildSettings()
            }
            return mocks.state.settings
        }),
        update: vi.fn(async (input: Partial<AppSettingsRecord>) => {
            mocks.state.settings = {
                ...(mocks.state.settings ?? buildSettings()),
                ...input,
                updatedAt: now,
            }
            return mocks.state.settings
        }),
    },
    auditRepository: {
        appendEvent: vi.fn(async (input: Record<string, unknown>) => {
            mocks.state.audits.push(input)
            return input
        }),
    },
    providerValidationRepository: {
        appendAttempt: vi.fn(async (input: Record<string, unknown>) => {
            mocks.state.validationAttempts.push(input)
        }),
    },
    secretRepository: {
        deleteById: vi.fn(async () => true),
    },
}))

vi.mock('../connection-validation', () => ({
    validateProviderConnection: mocks.validateProviderConnection,
}))

vi.mock('../codex-auth', () => ({
    inspectCodexAppAuthStatusSync: () => mocks.state.codexAuth,
}))

vi.mock('./secrets', () => ({
    upsertEncryptedSecret: vi.fn(async (input: { keyName: string }) => {
        mocks.state.createdSecrets.push(input.keyName)
        return buildSecret({
            id: `secret:${input.keyName}`,
            keyName: input.keyName,
        })
    }),
    resolveSecret: vi.fn(async () => null),
    decryptSecretRecord: vi.fn(() => 'existing-secret'),
}))

describe('provider connection workflows', () => {
    beforeEach(() => {
        mocks.state.providers = []
        mocks.state.settings = buildSettings()
        mocks.state.validationAttempts = []
        mocks.state.audits = []
        mocks.state.createdSecrets = []
        mocks.state.codexAuth = {
            ready: false,
            status: 'missing',
            accountId: null,
            expiresAt: null,
            message: 'Codex app server login is missing',
            requiresStoredCredential: false,
        }
        mocks.validateProviderConnection.mockReset()
        mocks.validateProviderConnection.mockResolvedValue({
            status: 'ready',
            message: 'ready',
        })
    })

    it('canonicalizes OpenRouter API, auth mode, and endpoint from the provider catalog', async () => {
        const { saveProviderConnection } = await import('./provider-connection-workflows')

        await saveProviderConnection(
            {
                label: 'OpenRouter',
                provider: 'openrouter',
                api: 'openai-codex-responses',
                authMode: 'oauth',
                baseUrl: 'https://example.invalid/v1',
                defaultModel: 'openrouter/auto',
                fallbackModels: [],
                apiKey: 'sk-test',
                makeDefault: true,
            } as unknown as ProviderSaveInput,
            'user-1',
        )

        expect(mocks.state.providers).toHaveLength(1)
        expect(mocks.state.providers[0]).toMatchObject({
            provider: 'openrouter',
            api: 'openai-completions',
            authMode: 'api_key',
            baseUrl: 'https://openrouter.ai/api/v1',
            defaultModel: 'openrouter/auto',
            status: 'ready',
        })
        expect(mocks.validateProviderConnection).toHaveBeenCalledWith(
            expect.objectContaining({
                provider: 'openrouter',
                api: 'openai-completions',
                authMode: 'api_key',
                baseUrl: 'https://openrouter.ai/api/v1',
                model: 'openrouter/auto',
                apiKey: 'sk-test',
            }),
        )
        expect(mocks.state.validationAttempts[0]).toMatchObject({
            provider: 'openrouter',
            api: 'openai-completions',
            authMode: 'api_key',
            baseUrl: 'https://openrouter.ai/api/v1',
        })
    })

    it('canonicalizes Codex app server auth and ignores submitted API keys', async () => {
        mocks.state.codexAuth = {
            ready: true,
            status: 'ready',
            accountId: 'account-1',
            expiresAt: '2026-06-11T01:00:00.000Z',
            message: 'Codex app server login is active',
            requiresStoredCredential: false,
        }
        const { saveProviderConnection } = await import('./provider-connection-workflows')

        await saveProviderConnection(
            {
                label: 'Codex app server',
                provider: 'openai-codex',
                api: 'openai-completions',
                authMode: 'api_key',
                baseUrl: 'https://example.invalid/v1',
                defaultModel: 'gpt-5.5',
                fallbackModels: [],
                apiKey: 'should-not-be-stored',
                makeDefault: true,
            } as unknown as ProviderSaveInput,
            'user-1',
        )

        expect(mocks.state.providers).toHaveLength(1)
        expect(mocks.state.providers[0]).toMatchObject({
            provider: 'openai-codex',
            api: 'openai-codex-responses',
            authMode: 'oauth',
            baseUrl: 'https://chatgpt.com/backend-api',
            defaultModel: 'openai-codex/gpt-5.5',
            credentialSecretId: null,
            status: 'ready',
        })
        expect(mocks.validateProviderConnection).not.toHaveBeenCalled()
        expect(mocks.state.createdSecrets).toEqual([])
        expect(mocks.state.validationAttempts[0]).toMatchObject({
            provider: 'openai-codex',
            api: 'openai-codex-responses',
            authMode: 'oauth',
            baseUrl: 'https://chatgpt.com/backend-api',
        })
    })
})
