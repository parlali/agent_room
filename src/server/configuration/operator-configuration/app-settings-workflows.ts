import type { ImageProviderId, JsonValue } from '../../domain/types'
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
} from '../capabilities'
import type { AppSettingsSummary } from './contracts'
import { imageConfigRecord, imageConfigSecretId, nullableText, summarizeSettings } from './helpers'
import { resolveSecret, upsertEncryptedSecret } from './secrets'

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
    const search = normalizeSearchConfig((input.search ?? current.searchConfig) as JsonValue)
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
        searchConfig: search as unknown as JsonValue,
        imageConfig: imageConfig as JsonValue,
    })

    if (currentImageSecretId && currentImageSecretId !== imageSecretId) {
        await secretRepository.deleteById(currentImageSecretId)
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
            imageProvider: imageConfig.provider,
            hasImageModel: imageConfig.model !== null,
            hasImageCredential: imageConfig.secretId !== null,
        },
    })

    return summarizeSettings(saved)
}
