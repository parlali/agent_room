import { randomUUID } from 'node:crypto'
import {
    appProviderConnectionRepository,
    appSettingsRepository,
    auditRepository,
    providerValidationRepository,
    secretRepository,
} from '../../db/repositories'
import { getAppEnv } from '../../config/env'
import { validateProviderConnection } from '../connection-validation'
import {
    assertSupportedProvider,
    assertSupportedProviderApi,
    inferProviderAuthMode,
    isOpenAICodexProvider,
    normalizeProviderId,
    normalizeProviderModel,
    providerRequiresStoredCredential,
    resolveProviderBaseUrl,
    supportedProviderCatalogEntry,
} from '../provider-config'
import type { ProviderConnectionSummary, ProviderSaveInput } from './contracts'
import { providerSaveSchema } from './contracts'
import { summarizeProvider } from './helpers'
import { decryptSecretRecord, resolveSecret, upsertEncryptedSecret } from './secrets'
import { inspectCodexAppAuthStatusSync } from '../codex-auth'
import { listReadyProviders } from './provider-resolution'

export async function saveProviderConnection(
    rawInput: ProviderSaveInput,
    actorUserId: string,
): Promise<ProviderConnectionSummary> {
    const input = providerSaveSchema.parse(rawInput)
    const provider = normalizeProviderId(input.provider)
    assertSupportedProvider(provider)
    const catalogEntry = supportedProviderCatalogEntry(provider)
    if (!catalogEntry) {
        throw new Error(`Provider ${provider} is not supported by this Agent Room build`)
    }
    const api = catalogEntry.api
    assertSupportedProviderApi(provider, api)
    const existingById = input.id ? await appProviderConnectionRepository.findById(input.id) : null
    if (existingById && existingById.provider !== provider) {
        throw new Error('Provider type cannot be changed for an existing connection')
    }
    const existing =
        existingById ?? (await appProviderConnectionRepository.findByProvider(provider))
    const id = existing?.id ?? randomUUID()
    const authMode = inferProviderAuthMode({ provider, api })
    const apiKey = input.apiKey?.trim() ?? ''
    let credentialSecretId = existing?.credentialSecretId ?? null
    let secretAction: string | null = null
    const requiresCredential = providerRequiresStoredCredential({
        provider,
        authMode,
    })

    if (requiresCredential) {
        if (apiKey) {
            const secret = await upsertEncryptedSecret({
                keyName: `app_provider:${id}:api_key`,
                plainText: apiKey,
            })
            credentialSecretId = secret.id
            secretAction = existing?.credentialSecretId ? 'secret.rotated' : 'secret.created'
        } else if (!credentialSecretId) {
            throw new Error('Provider API key is required for a new provider connection')
        }
    } else {
        credentialSecretId = null
    }

    const baseUrl = resolveProviderBaseUrl({
        provider,
        api,
        baseUrl: null,
    })
    const defaultModel = normalizeProviderModel(provider, input.defaultModel)
    let validationApiKey = requiresCredential ? apiKey || null : null
    if (requiresCredential && !validationApiKey && credentialSecretId) {
        const existingSecret = await resolveSecret(credentialSecretId)
        if (existingSecret) {
            validationApiKey = decryptSecretRecord(existingSecret, getAppEnv().encryptionKey)
        }
    }
    const validationStartedAt = new Date()
    const codexAuth = inspectCodexAppAuthStatusSync()
    const validation = isOpenAICodexProvider({
        provider,
        api,
    })
        ? {
              status: codexAuth.ready ? ('ready' as const) : ('invalid' as const),
              message: codexAuth.message,
          }
        : await validateProviderConnection({
              provider,
              authMode,
              api,
              baseUrl,
              model: defaultModel,
              apiKey: validationApiKey,
          })
    const validationCompletedAt = new Date()
    const saved = await appProviderConnectionRepository.upsert({
        id,
        label: input.label,
        provider,
        authMode,
        api,
        baseUrl,
        defaultModel,
        fallbackModels: input.fallbackModels.map((model) =>
            normalizeProviderModel(provider, model),
        ),
        credentialSecretId,
        status: validation.status,
        validationMessage: validation.message,
        lastValidatedAt: validationCompletedAt,
        createdByUserId: actorUserId,
    })
    await providerValidationRepository.appendAttempt({
        providerConnectionId: saved.id,
        roomId: null,
        provider,
        authMode,
        api,
        baseUrl,
        model: defaultModel,
        status: validation.status,
        message: validation.message,
        startedAt: validationStartedAt,
        completedAt: validationCompletedAt,
    })

    const settings = await appSettingsRepository.getOrCreate()
    if (input.makeDefault && saved.status === 'ready') {
        await appSettingsRepository.update({
            defaultProviderConnectionId: saved.id,
            defaultModel: null,
            onboardingCompletedAt: settings.onboardingCompletedAt ?? new Date(),
        })
    } else if (
        input.id &&
        input.makeDefault === false &&
        settings.defaultProviderConnectionId === saved.id
    ) {
        await appSettingsRepository.update({
            defaultProviderConnectionId: null,
            defaultModel: null,
            onboardingCompletedAt: settings.onboardingCompletedAt,
        })
    } else if (!settings.defaultProviderConnectionId && saved.status === 'ready') {
        const providers = await appProviderConnectionRepository.list()
        const readyProviders = listReadyProviders(providers, codexAuth)
        if (readyProviders.length >= 1) {
            await appSettingsRepository.update({
                defaultProviderConnectionId: readyProviders[0]?.id ?? saved.id,
                defaultModel: null,
                onboardingCompletedAt: settings.onboardingCompletedAt ?? new Date(),
            })
        }
    }

    if (secretAction) {
        await auditRepository.appendEvent({
            actorUserId,
            roomId: null,
            action: `provider_connection.${secretAction}`,
            payload: {
                providerConnectionId: saved.id,
                provider: saved.provider,
                authMode: saved.authMode,
            },
        })
    }

    await auditRepository.appendEvent({
        actorUserId,
        roomId: null,
        action: 'provider_connection.saved',
        payload: {
            providerConnectionId: saved.id,
            provider: saved.provider,
            authMode: saved.authMode,
            status: saved.status,
            hasCredential: saved.credentialSecretId !== null,
        },
    })

    return summarizeProvider(saved)
}

export async function deleteProviderConnection(input: {
    id: string
    actorUserId: string
}): Promise<{ id: string }> {
    const existing = await appProviderConnectionRepository.findById(input.id)
    if (!existing) {
        throw new Error('Provider connection does not exist')
    }

    const roomReferences = await appProviderConnectionRepository.countRoomReferences(existing.id)
    if (roomReferences > 0) {
        throw new Error(
            `Provider connection is used by ${roomReferences} room${roomReferences === 1 ? '' : 's'}. Remove it from those rooms before deleting.`,
        )
    }

    const settings = await appSettingsRepository.getOrCreate()
    const wasDefault = settings.defaultProviderConnectionId === existing.id
    const deleted = await appProviderConnectionRepository.deleteByIdIfUnused(existing.id)
    if (!deleted) {
        const currentReferences = await appProviderConnectionRepository.countRoomReferences(
            existing.id,
        )
        if (currentReferences > 0) {
            throw new Error(
                `Provider connection is used by ${currentReferences} room${currentReferences === 1 ? '' : 's'}. Remove it from those rooms before deleting.`,
            )
        }
        throw new Error('Provider connection could not be deleted')
    }

    if (existing.credentialSecretId) {
        await secretRepository.deleteById(existing.credentialSecretId)
    }

    await auditRepository.appendEvent({
        actorUserId: input.actorUserId,
        roomId: null,
        action: 'provider_connection.deleted',
        payload: {
            providerConnectionId: existing.id,
            provider: existing.provider,
            authMode: existing.authMode,
            wasDefault,
            hadCredential: existing.credentialSecretId !== null,
        },
    })

    return { id: existing.id }
}
