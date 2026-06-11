import { describe, expect, it } from 'vitest'
import type {
    AppProviderConnectionRecord,
    AppSettingsRecord,
    RoomConfigRecord,
} from '#/domain/domain-types'
import type { CodexAppAuthStatus } from '../codex-auth'
import {
    inspectProviderReadiness,
    listReadyProviders,
    resolveEffectiveProvider,
} from './provider-resolution'

const now = new Date('2026-06-11T00:00:00.000Z')

const codexReadyAuth: CodexAppAuthStatus = {
    ready: true,
    status: 'ready',
    accountId: 'account-1',
    expiresAt: '2026-06-11T01:00:00.000Z',
    message: 'Codex app server login is active',
}

const codexMissingAuth: CodexAppAuthStatus = {
    ready: false,
    status: 'missing',
    accountId: null,
    expiresAt: null,
    message: 'Codex app server login is missing',
}

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

function buildRoomConfig(input: Partial<RoomConfigRecord> = {}): RoomConfigRecord {
    return {
        roomId: 'room-1',
        instructions: '',
        providerMode: 'app_default',
        providerConnectionId: null,
        roomMode: 'coworker',
        capabilityOverrides: {},
        imageProvider: null,
        imageModel: null,
        imageSecretId: null,
        cronTimezone: 'UTC',
        browserActionBudget: 50,
        createdAt: now,
        updatedAt: now,
        ...input,
    }
}

function buildProvider(
    input: Partial<AppProviderConnectionRecord> = {},
): AppProviderConnectionRecord {
    return {
        id: 'provider-1',
        label: 'OpenRouter',
        provider: 'openrouter',
        authMode: 'api_key',
        api: 'openai-completions',
        baseUrl: 'https://openrouter.ai/api/v1',
        defaultModel: 'openrouter/auto',
        fallbackModels: [],
        credentialSecretId: 'secret-1',
        status: 'ready',
        validationMessage: null,
        lastValidatedAt: now,
        createdByUserId: 'user-1',
        createdAt: now,
        updatedAt: now,
        ...input,
    }
}

describe('provider resolution', () => {
    it('uses the explicit app default provider even when multiple providers are ready', () => {
        const openRouter = buildProvider({ id: 'openrouter' })
        const codex = buildProvider({
            id: 'codex',
            label: 'Codex app server',
            provider: 'openai-codex',
            authMode: 'oauth',
            api: 'openai-codex-responses',
            baseUrl: 'https://chatgpt.com/backend-api',
            defaultModel: 'openai-codex/gpt-5.5',
            credentialSecretId: null,
        })

        const resolution = resolveEffectiveProvider({
            config: buildRoomConfig(),
            settings: buildSettings({ defaultProviderConnectionId: 'codex' }),
            providers: [openRouter, codex],
            codexAuth: codexReadyAuth,
        })

        expect(resolution.provider?.id).toBe('codex')
        expect(resolution.blockedReasons).toEqual([])
        expect(resolution.codexAuth?.ready).toBe(true)
    })

    it('uses the only ready app provider when no app default is configured', () => {
        const openRouter = buildProvider({ id: 'openrouter' })
        const codex = buildProvider({
            id: 'codex',
            label: 'Codex app server',
            provider: 'openai-codex',
            authMode: 'oauth',
            api: 'openai-codex-responses',
            baseUrl: 'https://chatgpt.com/backend-api',
            defaultModel: 'openai-codex/gpt-5.5',
            credentialSecretId: null,
        })

        const resolution = resolveEffectiveProvider({
            config: buildRoomConfig(),
            settings: buildSettings(),
            providers: [openRouter, codex],
            codexAuth: codexMissingAuth,
        })

        expect(resolution.provider?.id).toBe('openrouter')
        expect(resolution.blockedReasons).toEqual([])
    })

    it('requires an app default when multiple app providers are ready', () => {
        const resolution = resolveEffectiveProvider({
            config: buildRoomConfig(),
            settings: buildSettings(),
            providers: [
                buildProvider({ id: 'openrouter-1' }),
                buildProvider({ id: 'openrouter-2', credentialSecretId: 'secret-2' }),
            ],
            codexAuth: codexReadyAuth,
        })

        expect(resolution.provider).toBeNull()
        expect(resolution.blockedReasons).toEqual(['Select an app default provider'])
    })

    it('fails closed when the configured app default provider no longer exists', () => {
        const resolution = resolveEffectiveProvider({
            config: buildRoomConfig(),
            settings: buildSettings({ defaultProviderConnectionId: 'missing-provider' }),
            providers: [buildProvider({ id: 'openrouter' })],
            codexAuth: codexReadyAuth,
        })

        expect(resolution.provider).toBeNull()
        expect(resolution.blockedReasons).toEqual([
            'App default provider connection does not exist',
        ])
    })

    it('reports readiness failures for a room-selected app provider', () => {
        const codex = buildProvider({
            id: 'codex',
            label: 'Codex app server',
            provider: 'openai-codex',
            authMode: 'oauth',
            api: 'openai-codex-responses',
            baseUrl: 'https://chatgpt.com/backend-api',
            defaultModel: 'openai-codex/gpt-5.5',
            credentialSecretId: null,
        })

        const resolution = resolveEffectiveProvider({
            config: buildRoomConfig({
                providerMode: 'app_connection',
                providerConnectionId: 'codex',
            }),
            settings: buildSettings(),
            providers: [codex],
            codexAuth: codexMissingAuth,
        })

        expect(resolution.provider?.id).toBe('codex')
        expect(resolution.blockedReasons).toEqual(['Codex app server login is missing'])
        expect(resolution.codexAuth?.status).toBe('missing')
    })

    it('does not list unsupported or API-mismatched provider rows as ready', () => {
        const unsupported = buildProvider({
            id: 'custom',
            label: 'Custom',
            provider: 'custom-openai-compatible',
        })
        const mismatch = buildProvider({
            id: 'mismatch',
            api: 'openai-codex-responses',
        })

        expect(inspectProviderReadiness(unsupported, codexReadyAuth)).toMatchObject({
            ready: false,
            message: 'Provider custom-openai-compatible is not supported by this Agent Room build',
        })
        expect(inspectProviderReadiness(mismatch, codexReadyAuth)).toMatchObject({
            ready: false,
            message: 'Provider openrouter must use openai-completions',
        })
        expect(listReadyProviders([unsupported, mismatch], codexReadyAuth)).toEqual([])
    })
})
