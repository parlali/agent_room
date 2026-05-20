import type { ImageProviderId, JsonValue, SecretRecord } from '../../domain/types'
import {
    appProviderConnectionRepository,
    auditRepository,
    providerValidationRepository,
    roomConfigRepository,
    roomMcpBindingRepository,
    roomRepository,
    roomSecretRepository,
    secretRepository,
} from '../../db/repositories'
import { getAppEnv } from '../../config/env'
import { validateProviderConnection } from '../connection-validation'
import { normalizeImageProvider } from '../capabilities'
import { saveRoomGitHubBinding } from '../github-app'
import {
    assertSupportedProvider,
    assertSupportedProviderApi,
    inferProviderAuthMode,
    normalizeProviderId,
    normalizeProviderModel,
    providerEnvKey,
    providerRequiresStoredCredential,
} from '../provider-config'
import type { RoomConfigSaveInput, RoomConfigSnapshot } from './contracts'
import { roomConfigSaveSchema } from './contracts'
import { imageProviderEnvKey, nullableText, validateBaseUrl } from './helpers'
import { reconcileRoomAutostart } from '../../rooms/room-autostart'
import { getRoomConfigSnapshot } from './room-config-snapshot'
import { decryptSecretRecord, resolveSecret, upsertEncryptedSecret } from './secrets'

async function upsertRoomProviderSecret(input: {
    roomId: string
    actorUserId: string
    provider: string
    apiKey: string
}): Promise<SecretRecord> {
    const provider = input.provider.trim().toLowerCase()
    const envKey = providerEnvKey(provider)
    const secret = await upsertEncryptedSecret({
        keyName: `room:${input.roomId}:provider:${provider}:api_key`,
        plainText: input.apiKey,
    })

    await roomSecretRepository.upsert({
        roomId: input.roomId,
        secretId: secret.id,
        label: `${provider} provider key`,
        envKey,
        purpose: 'provider_api_key',
        provider,
        createdByUserId: input.actorUserId,
    })

    return secret
}

async function upsertRoomImageSecret(input: {
    roomId: string
    actorUserId: string
    provider: ImageProviderId
    apiKey: string
}): Promise<SecretRecord> {
    const envKey = imageProviderEnvKey(input.provider)
    const secret = await upsertEncryptedSecret({
        keyName: `room:${input.roomId}:image:${input.provider}:api_key`,
        plainText: input.apiKey,
    })

    await roomSecretRepository.upsert({
        roomId: input.roomId,
        secretId: secret.id,
        label: `${input.provider} image key`,
        envKey,
        purpose: 'provider_api_key',
        provider: input.provider,
        createdByUserId: input.actorUserId,
    })

    return secret
}

export async function saveRoomConfig(
    rawInput: RoomConfigSaveInput,
    actorUserId: string,
    options: {
        reconcileAutostart?: boolean
    } = {},
): Promise<RoomConfigSnapshot> {
    const input = roomConfigSaveSchema.parse(rawInput)
    const room = await roomRepository.findRoomById(input.roomId)
    if (!room) {
        throw new Error(`Room ${input.roomId} does not exist`)
    }

    const existing = await roomConfigRepository.getOrCreate(input.roomId)
    const previousProviderSecretId = existing.providerSecretId
    const previousImageSecretId = existing.imageSecretId
    let providerSecretId = existing.providerSecretId
    let imageSecretId = existing.imageSecretId
    const provider = nullableText(input.provider)
        ? normalizeProviderId(nullableText(input.provider) ?? '')
        : null
    const providerApi = input.providerApi ?? null
    const providerModel = nullableText(input.providerModel)
    const roomProviderBaseUrl =
        input.providerMode === 'room_secret'
            ? validateBaseUrl(nullableText(input.providerBaseUrl))
            : null
    const normalizedProviderModel =
        input.providerMode === 'room_secret' && provider && providerModel
            ? normalizeProviderModel(provider, providerModel)
            : null

    if (input.providerMode === 'app_connection') {
        if (!input.providerConnectionId) {
            throw new Error('Room provider connection is required')
        }
        const providerConnection = await appProviderConnectionRepository.findById(
            input.providerConnectionId,
        )
        if (!providerConnection) {
            throw new Error('Room provider connection does not exist')
        }
        providerSecretId = null
    }

    if (input.providerMode === 'room_secret') {
        if (!provider || !providerApi || !normalizedProviderModel) {
            throw new Error('Room-scoped provider configuration requires provider, API, and model')
        }
        assertSupportedProvider(provider)
        assertSupportedProviderApi(provider, providerApi)
        if (inferProviderAuthMode({ provider, api: providerApi }) === 'oauth') {
            throw new Error('OpenAI Codex OAuth must be configured as an app provider connection')
        }

        const apiKey = input.providerApiKey?.trim() ?? ''
        const requiresCredential = providerRequiresStoredCredential({
            provider,
            authMode: 'api_key',
        })
        let validationApiKey = requiresCredential ? apiKey || null : null
        if (requiresCredential && !validationApiKey && providerSecretId) {
            const existingSecret = await resolveSecret(providerSecretId)
            if (existingSecret) {
                validationApiKey = decryptSecretRecord(existingSecret, getAppEnv().encryptionKey)
            }
        }
        const validationStartedAt = new Date()
        const validation = await validateProviderConnection({
            provider,
            authMode: 'api_key',
            api: providerApi,
            baseUrl: roomProviderBaseUrl,
            model: normalizedProviderModel,
            apiKey: validationApiKey,
        })
        await providerValidationRepository.appendAttempt({
            providerConnectionId: null,
            roomId: input.roomId,
            provider,
            authMode: 'api_key',
            api: providerApi,
            baseUrl: roomProviderBaseUrl,
            model: normalizedProviderModel,
            status: validation.status,
            message: validation.message,
            startedAt: validationStartedAt,
            completedAt: new Date(),
        })
        if (validation.status !== 'ready') {
            throw new Error(`Room-scoped provider validation failed: ${validation.message}`)
        }

        if (requiresCredential && apiKey) {
            const secret = await upsertRoomProviderSecret({
                roomId: input.roomId,
                actorUserId,
                provider,
                apiKey,
            })
            providerSecretId = secret.id
            await auditRepository.appendEvent({
                actorUserId,
                roomId: input.roomId,
                action: 'room_secret.rotated',
                payload: {
                    purpose: 'provider_api_key',
                    provider,
                },
            })
        } else if (requiresCredential && !providerSecretId) {
            throw new Error('Room-scoped provider API key is required')
        } else if (!requiresCredential) {
            providerSecretId = null
        }
    }

    const imageProvider = normalizeImageProvider(input.imageProvider)
    const imageModel = nullableText(input.imageModel)
    const imageApiKey = input.imageApiKey?.trim() ?? ''
    if (imageProvider && imageModel) {
        if (imageApiKey) {
            const secret = await upsertRoomImageSecret({
                roomId: input.roomId,
                actorUserId,
                provider: imageProvider,
                apiKey: imageApiKey,
            })
            imageSecretId = secret.id
            await auditRepository.appendEvent({
                actorUserId,
                roomId: input.roomId,
                action: 'room_image_secret.rotated',
                payload: {
                    provider: imageProvider,
                },
            })
        } else if (!imageSecretId) {
            imageSecretId = null
        } else if (existing.imageProvider !== imageProvider) {
            imageSecretId = null
        }
    } else {
        imageSecretId = null
    }

    const config = await roomConfigRepository.upsert({
        roomId: input.roomId,
        instructions: input.instructions.trim(),
        providerMode: input.providerMode,
        providerConnectionId:
            input.providerMode === 'app_connection' ? (input.providerConnectionId ?? null) : null,
        provider: input.providerMode === 'room_secret' ? provider : null,
        providerApi: input.providerMode === 'room_secret' ? providerApi : null,
        providerBaseUrl: input.providerMode === 'room_secret' ? roomProviderBaseUrl : null,
        providerModel: input.providerMode === 'room_secret' ? normalizedProviderModel : null,
        providerSecretId: input.providerMode === 'room_secret' ? providerSecretId : null,
        roomMode: input.roomMode,
        capabilityOverrides: input.capabilityOverrides as JsonValue,
        imageProvider,
        imageModel: imageProvider ? imageModel : null,
        imageSecretId,
        cronTimezone: input.cronTimezone,
        browserActionBudget: input.browserActionBudget,
    })

    await roomMcpBindingRepository.replaceForRoom(
        input.roomId,
        input.mcpConnectionIds.map((mcpConnectionId) => ({
            mcpConnectionId,
            allowedTools: [],
            enabled: true,
        })),
    )
    await saveRoomGitHubBinding({
        roomId: input.roomId,
        enabled: input.githubEnabled,
        installationId: input.githubInstallationId,
        repositories: input.githubRepositories,
        actorUserId,
    })

    await auditRepository.appendEvent({
        actorUserId,
        roomId: input.roomId,
        action: 'room_config.updated',
        payload: {
            providerMode: config.providerMode,
            providerConnectionId: config.providerConnectionId,
            roomMode: config.roomMode,
            mcpConnectionCount: input.mcpConnectionIds.length,
            githubEnabled: input.githubEnabled,
            hasInstructions: config.instructions.length > 0,
            enabledCapabilities: Object.entries(
                config.capabilityOverrides &&
                    typeof config.capabilityOverrides === 'object' &&
                    !Array.isArray(config.capabilityOverrides)
                    ? config.capabilityOverrides
                    : {},
            )
                .filter(([, value]) => value === true)
                .map(([key]) => key),
            imageProvider: config.imageProvider,
            hasImageProviderSecret: config.imageSecretId !== null,
            browserActionBudget: config.browserActionBudget,
        },
    })

    const retainedSecretIds = new Set(
        [config.providerSecretId, config.imageSecretId].filter(
            (secretId): secretId is string => typeof secretId === 'string',
        ),
    )
    const staleSecretIds = [previousProviderSecretId, previousImageSecretId].filter(
        (secretId): secretId is string =>
            typeof secretId === 'string' && !retainedSecretIds.has(secretId),
    )
    for (const secretId of [...new Set(staleSecretIds)]) {
        await secretRepository.deleteById(secretId)
    }
    if (staleSecretIds.length > 0) {
        await auditRepository.appendEvent({
            actorUserId,
            roomId: input.roomId,
            action: 'room_credential_secret.cleaned',
            payload: {
                count: new Set(staleSecretIds).size,
            },
        })
    }

    const snapshot = await getRoomConfigSnapshot(input.roomId)
    if (options.reconcileAutostart !== false) {
        await reconcileRoomAutostart({
            roomId: input.roomId,
            actorUserId,
            trigger: 'room_config_saved',
        }).catch((error) => {
            if (error instanceof Error) {
                throw error
            }
            throw new Error('Room autostart reconciliation failed')
        })
    }
    return snapshot
}
