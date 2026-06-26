import type {
    AppProviderConnectionRecord,
    AppSettingsRecord,
    RoomConfigRecord,
} from '#/domain/domain-types'
import { inspectCodexAppAuthStatusSync, type CodexAppAuthStatus } from '../codex-auth'
import {
    isOpenAICodexProvider,
    providerRequiresStoredCredential,
    supportedProviderCatalogEntry,
} from '../provider-config'

export type EffectiveProviderSource = 'app_default' | 'app_connection' | 'managed_hosted'

export interface ProviderReadiness {
    ready: boolean
    message: string | null
    codexAuth: CodexAppAuthStatus | null
}

export interface EffectiveProviderResolution {
    source: EffectiveProviderSource
    provider: AppProviderConnectionRecord | null
    blockedReasons: string[]
    codexAuth: CodexAppAuthStatus | null
}

export function inspectProviderReadiness(
    provider: AppProviderConnectionRecord,
    codexAuth = inspectCodexAppAuthStatusSync(),
): ProviderReadiness {
    const catalogEntry = supportedProviderCatalogEntry(provider.provider)
    if (!catalogEntry) {
        return {
            ready: false,
            message: `Provider ${provider.provider} is not supported by this Agent Room build`,
            codexAuth: null,
        }
    }
    if (catalogEntry.api !== provider.api) {
        return {
            ready: false,
            message: `Provider ${provider.provider} must use ${catalogEntry.api}`,
            codexAuth: null,
        }
    }

    const isCodex = isOpenAICodexProvider({
        provider: provider.provider,
        api: provider.api,
    })

    if (provider.authMode === 'oauth' && isCodex) {
        if (!codexAuth.ready) {
            return {
                ready: false,
                message: codexAuth.message,
                codexAuth,
            }
        }
    } else if (
        providerRequiresStoredCredential({
            provider: provider.provider,
            authMode: provider.authMode,
        }) &&
        !provider.credentialSecretId
    ) {
        return {
            ready: false,
            message: 'Provider connection has no saved credential',
            codexAuth: null,
        }
    }

    if (provider.status !== 'ready') {
        return {
            ready: false,
            message:
                provider.validationMessage ??
                `Provider connection ${provider.label} is ${provider.status}`,
            codexAuth: isCodex ? codexAuth : null,
        }
    }

    return {
        ready: true,
        message: null,
        codexAuth: isCodex ? codexAuth : null,
    }
}

export function listReadyProviders(
    providers: AppProviderConnectionRecord[],
    codexAuth = inspectCodexAppAuthStatusSync(),
): AppProviderConnectionRecord[] {
    return providers.filter((provider) => inspectProviderReadiness(provider, codexAuth).ready)
}

export function resolveEffectiveProvider(input: {
    config: Pick<RoomConfigRecord, 'providerMode' | 'providerConnectionId'>
    settings: Pick<AppSettingsRecord, 'defaultProviderConnectionId'>
    providers: AppProviderConnectionRecord[]
    codexAuth?: CodexAppAuthStatus
}): EffectiveProviderResolution {
    const codexAuth = input.codexAuth ?? inspectCodexAppAuthStatusSync()
    if (input.config.providerMode === 'managed_hosted') {
        return {
            source: 'managed_hosted',
            provider: null,
            blockedReasons: ['Managed hosted models are not available in this runtime'],
            codexAuth: null,
        }
    }

    if (input.config.providerMode === 'app_connection') {
        if (!input.config.providerConnectionId) {
            return {
                source: 'app_connection',
                provider: null,
                blockedReasons: ['Selected provider connection is not configured'],
                codexAuth: null,
            }
        }

        const provider =
            input.providers.find((entry) => entry.id === input.config.providerConnectionId) ?? null
        if (!provider) {
            return {
                source: 'app_connection',
                provider: null,
                blockedReasons: ['Selected provider connection does not exist'],
                codexAuth: null,
            }
        }

        const readiness = inspectProviderReadiness(provider, codexAuth)
        return {
            source: 'app_connection',
            provider,
            blockedReasons: readiness.ready ? [] : [readiness.message ?? 'Provider is not ready'],
            codexAuth: readiness.codexAuth,
        }
    }

    if (input.settings.defaultProviderConnectionId) {
        const defaultProvider =
            input.providers.find(
                (entry) => entry.id === input.settings.defaultProviderConnectionId,
            ) ?? null

        if (!defaultProvider) {
            return {
                source: 'app_default',
                provider: null,
                blockedReasons: ['App default provider connection does not exist'],
                codexAuth: null,
            }
        }

        const readiness = inspectProviderReadiness(defaultProvider, codexAuth)
        return {
            source: 'app_default',
            provider: defaultProvider,
            blockedReasons: readiness.ready ? [] : [readiness.message ?? 'Provider is not ready'],
            codexAuth: readiness.codexAuth,
        }
    }

    return {
        source: 'app_default',
        provider: null,
        blockedReasons: ['Select an app default provider'],
        codexAuth: null,
    }
}
