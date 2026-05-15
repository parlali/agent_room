import type { ImageProviderId, JsonValue, SearchSafeSearch } from '../../domain/types'
import {
    appProviderConnectionRepository,
    appSettingsRepository,
    auditRepository,
    secretRepository,
} from '../../db/repositories'
import {
    capabilityConfigToJson,
    normalizeCapabilityConfig,
    normalizeImageProvider,
    normalizeSearchConfig,
    searchProviderSecretId,
} from '../capabilities'
import { validateMaterializedSearchProviders } from '../search-connection-validation'
import { getAppEnv } from '../../config/env'
import type { AppSettingsSummary } from './contracts'
import { imageConfigRecord, imageConfigSecretId, nullableText, summarizeSettings } from './helpers'
import { decryptSecretRecord, resolveSecret, upsertEncryptedSecret } from './secrets'

export async function updateAppDefaults(input: {
    defaultProviderConnectionId: string | null
    defaultModel: string | null
    onboardingCompleted: boolean
    actorUserId: string
}): Promise<AppSettingsSummary> {
    if (input.defaultProviderConnectionId) {
        const provider = await appProviderConnectionRepository.findById(
            input.defaultProviderConnectionId,
        )
        if (!provider) {
            throw new Error('Default provider connection does not exist')
        }
        if (provider.status !== 'ready') {
            throw new Error(
                provider.validationMessage ??
                    `Default provider connection ${provider.label} is not ready`,
            )
        }
    }

    const current = await appSettingsRepository.getOrCreate()
    const saved = await appSettingsRepository.update({
        defaultProviderConnectionId: input.defaultProviderConnectionId,
        defaultModel: null,
        onboardingCompletedAt: input.onboardingCompleted
            ? (current.onboardingCompletedAt ?? new Date())
            : null,
        capabilityDefaults: undefined,
        searchConfig: undefined,
        imageConfig: undefined,
    })

    await auditRepository.appendEvent({
        actorUserId: input.actorUserId,
        roomId: null,
        action: 'app_settings.updated',
        payload: {
            defaultProviderConnectionId: saved.defaultProviderConnectionId,
            hasDefaultModel: false,
            onboardingCompleted: saved.onboardingCompletedAt !== null,
        },
    })

    return summarizeSettings(saved)
}

export async function updateAppCapabilitySettings(input: {
    capabilityDefaults: Record<string, boolean>
    search?: {
        enabled: boolean
        backendUrl: string
        defaultResultCount: number
        timeoutMs: number
        maxSearchesPerRun: number
        brave: {
            enabled: boolean
            country: string | null
            searchLang: string | null
            safeSearch: SearchSafeSearch
            timeoutMs: number
            resultCount: number
            apiKey?: string
        }
        browserbase: {
            enabled: boolean
            timeoutMs: number
            resultCount: number
            apiKey?: string
        }
    }
    image: {
        provider: ImageProviderId | null
        model: string | null
        apiKey?: string
    }
    actorUserId: string
}): Promise<AppSettingsSummary> {
    const current = await appSettingsRepository.getOrCreate()
    const capabilities = normalizeCapabilityConfig(input.capabilityDefaults)
    const searchConfig = await resolveSearchConfigForSave({
        current: current.searchConfig,
        next: input.search,
    })
    const search = normalizeSearchConfig(searchConfig)
    const currentImageProvider = normalizeImageProvider(
        imageConfigRecord(current.imageConfig).provider,
    )
    const currentImageSecretId = imageConfigSecretId(current.imageConfig)
    const imageProvider = input.image.provider
    const imageModel = imageProvider ? nullableText(input.image.model) : null
    const imageApiKey = input.image.apiKey?.trim() ?? ''
    let imageSecretId: string | null = null

    if (imageProvider && !imageModel) {
        throw new Error('Default image model is required when image generation is enabled')
    }

    if (imageProvider && imageModel) {
        if (imageApiKey) {
            const secret = await upsertEncryptedSecret({
                keyName: `app_image:${imageProvider}:api_key`,
                plainText: imageApiKey,
            })
            imageSecretId = secret.id
        } else if (currentImageProvider === imageProvider && currentImageSecretId) {
            const existingSecret = await resolveSecret(currentImageSecretId)
            if (!existingSecret) {
                throw new Error('Saved image API key is missing; enter a new image API key')
            }
            imageSecretId = existingSecret.id
        } else {
            throw new Error('Image API key is required when enabling an app image provider')
        }
    }

    const imageConfig =
        imageProvider && imageModel && imageSecretId
            ? {
                  provider: imageProvider,
                  model: imageModel,
                  secretId: imageSecretId,
              }
            : {
                  provider: null,
                  model: null,
                  secretId: null,
              }

    const saved = await appSettingsRepository.update({
        defaultProviderConnectionId: current.defaultProviderConnectionId,
        defaultModel: current.defaultModel,
        onboardingCompletedAt: current.onboardingCompletedAt,
        capabilityDefaults: capabilityConfigToJson(capabilities),
        searchConfig,
        imageConfig: imageConfig as JsonValue,
    })

    const retainedSecretIds = new Set(
        [
            imageSecretId,
            searchProviderSecretId({ config: searchConfig, provider: 'brave' }),
            searchProviderSecretId({ config: searchConfig, provider: 'browserbase' }),
        ].filter((secretId): secretId is string => typeof secretId === 'string'),
    )
    const staleSecretIds = [
        currentImageSecretId,
        searchProviderSecretId({ config: current.searchConfig, provider: 'brave' }),
        searchProviderSecretId({ config: current.searchConfig, provider: 'browserbase' }),
    ].filter(
        (secretId): secretId is string =>
            typeof secretId === 'string' && !retainedSecretIds.has(secretId),
    )
    for (const secretId of [...new Set(staleSecretIds)]) {
        await secretRepository.deleteById(secretId)
    }

    await auditRepository.appendEvent({
        actorUserId: input.actorUserId,
        roomId: null,
        action: 'app_capabilities.updated',
        payload: {
            enabledCapabilities: Object.entries(capabilityConfigToJson(capabilities))
                .filter(([, enabled]) => enabled)
                .map(([key]) => key),
            searchEnabled: search.enabled,
            braveSearchEnabled: search.brave.enabled,
            braveSearchHasCredential:
                searchProviderSecretId({ config: searchConfig, provider: 'brave' }) !== null,
            browserbaseSearchEnabled: search.browserbase.enabled,
            browserbaseSearchHasCredential:
                searchProviderSecretId({ config: searchConfig, provider: 'browserbase' }) !== null,
            imageProvider: imageConfig.provider,
            hasImageModel: imageConfig.model !== null,
            hasImageCredential: imageConfig.secretId !== null,
        },
    })

    return summarizeSettings(saved)
}

async function resolveSearchConfigForSave(input: {
    current: JsonValue
    next:
        | {
              enabled: boolean
              backendUrl: string
              defaultResultCount: number
              timeoutMs: number
              maxSearchesPerRun: number
              brave: {
                  enabled: boolean
                  country: string | null
                  searchLang: string | null
                  safeSearch: SearchSafeSearch
                  timeoutMs: number
                  resultCount: number
                  apiKey?: string
              }
              browserbase: {
                  enabled: boolean
                  timeoutMs: number
                  resultCount: number
                  apiKey?: string
              }
          }
        | undefined
}): Promise<JsonValue> {
    if (!input.next) {
        return input.current
    }

    const currentBraveSecretId = searchProviderSecretId({
        config: input.current,
        provider: 'brave',
    })
    const currentBrowserbaseSecretId = searchProviderSecretId({
        config: input.current,
        provider: 'browserbase',
    })
    const secretRollbacks: SearchSecretRollback[] = []
    const braveApiKey = input.next.brave.apiKey?.trim() ?? ''
    const browserbaseApiKey = input.next.browserbase.apiKey?.trim() ?? ''

    try {
        const braveSecretId = await resolveProviderSearchSecret({
            provider: 'brave',
            enabled: input.next.brave.enabled,
            apiKey: braveApiKey,
            currentSecretId: currentBraveSecretId,
            rollbacks: secretRollbacks,
        })
        const browserbaseSecretId = await resolveProviderSearchSecret({
            provider: 'browserbase',
            enabled: input.next.browserbase.enabled,
            apiKey: browserbaseApiKey,
            currentSecretId: currentBrowserbaseSecretId,
            rollbacks: secretRollbacks,
        })
        const config = normalizeSearchConfig({
            enabled: input.next.enabled,
            backendUrl: input.next.backendUrl,
            defaultResultCount: input.next.defaultResultCount,
            timeoutMs: input.next.timeoutMs,
            maxSearchesPerRun: input.next.maxSearchesPerRun,
            brave: {
                enabled: input.next.brave.enabled,
                country: input.next.brave.country,
                searchLang: input.next.brave.searchLang,
                safeSearch: input.next.brave.safeSearch,
                timeoutMs: input.next.brave.timeoutMs,
                resultCount: input.next.brave.resultCount,
                secretId: braveSecretId,
            },
            browserbase: {
                enabled: input.next.browserbase.enabled,
                timeoutMs: input.next.browserbase.timeoutMs,
                resultCount: input.next.browserbase.resultCount,
                secretId: browserbaseSecretId,
            },
        })
        const persisted = {
            enabled: config.enabled,
            backendUrl: config.backendUrl,
            defaultResultCount: config.defaultResultCount,
            timeoutMs: config.timeoutMs,
            maxSearchesPerRun: config.maxSearchesPerRun,
            brave: {
                enabled: config.brave.enabled,
                country: config.brave.country,
                searchLang: config.brave.searchLang,
                safeSearch: config.brave.safeSearch,
                timeoutMs: config.brave.timeoutMs,
                resultCount: config.brave.resultCount,
                secretId: braveSecretId,
            },
            browserbase: {
                enabled: config.browserbase.enabled,
                timeoutMs: config.browserbase.timeoutMs,
                resultCount: config.browserbase.resultCount,
                secretId: browserbaseSecretId,
            },
        } as const
        await validateMaterializedSearchProviders({
            searchConfig: persisted as unknown as JsonValue,
            providers: [
                input.next.brave.enabled ? 'brave' : null,
                input.next.browserbase.enabled ? 'browserbase' : null,
            ].filter((provider): provider is 'brave' | 'browserbase' => provider !== null),
        })

        return persisted as unknown as JsonValue
    } catch (error) {
        await rollbackSearchSecretWrites(secretRollbacks)
        throw error
    }
}

interface SearchSecretRollback {
    keyName: string
    secretId: string
    previousPlainText: string | null
}

async function resolveProviderSearchSecret(input: {
    provider: 'brave' | 'browserbase'
    enabled: boolean
    apiKey: string
    currentSecretId: string | null
    rollbacks: SearchSecretRollback[]
}): Promise<string | null> {
    if (!input.enabled) {
        return null
    }
    if (input.apiKey) {
        const keyName = `app_search:${input.provider}:api_key`
        const previousSecret = input.currentSecretId
            ? await resolveSecret(input.currentSecretId)
            : null
        const previousPlainText = previousSecret
            ? decryptSecretRecord(previousSecret, getAppEnv().encryptionKey)
            : null
        const secret = await upsertEncryptedSecret({
            keyName,
            plainText: input.apiKey,
        })
        input.rollbacks.push({
            keyName,
            secretId: secret.id,
            previousPlainText,
        })
        return secret.id
    }
    if (input.currentSecretId) {
        const existingSecret = await resolveSecret(input.currentSecretId)
        if (!existingSecret) {
            throw new Error(`${input.provider} search API key is missing; enter a new key`)
        }
        return existingSecret.id
    }
    throw new Error(`${input.provider} search API key is required when enabling search`)
}

async function rollbackSearchSecretWrites(rollbacks: SearchSecretRollback[]): Promise<void> {
    for (const rollback of rollbacks.reverse()) {
        if (rollback.previousPlainText !== null) {
            await upsertEncryptedSecret({
                keyName: rollback.keyName,
                plainText: rollback.previousPlainText,
            })
        } else {
            await secretRepository.deleteById(rollback.secretId)
        }
    }
}
