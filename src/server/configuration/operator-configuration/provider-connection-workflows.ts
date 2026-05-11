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
    normalizeProviderId,
    normalizeProviderModel,
    providerRequiresStoredCredential,
    resolveProviderBaseUrl,
} from '../provider-config'
import type { ProviderConnectionSummary, ProviderSaveInput } from './contracts'
import { providerSaveSchema } from './contracts'
import { nullableText, summarizeProvider, validateBaseUrl } from './helpers'
import { decryptSecretRecord, resolveSecret, upsertEncryptedSecret } from './secrets'

export async function saveProviderConnection(
    rawInput: ProviderSaveInput,
    actorUserId: string,
): Promise<ProviderConnectionSummary> {
    const input = providerSaveSchema.parse(rawInput)
    const id = input.id ?? randomUUID()
    const existing = input.id ? await appProviderConnectionRepository.findById(input.id) : null
    const provider = normalizeProviderId(input.provider)
    assertSupportedProvider(provider)
    assertSupportedProviderApi(provider, input.api)
    const authMode = input.authMode ?? inferProviderAuthMode({ provider, api: input.api })
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
        api: input.api,
        baseUrl: validateBaseUrl(nullableText(input.baseUrl)),
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
    const validation = await validateProviderConnection({
        provider,
        authMode,
        api: input.api,
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
        api: input.api,
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
        api: input.api,
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
