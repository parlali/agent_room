import type {
    AppMcpConnectionRecord,
    AppProviderConnectionRecord,
    AppSettingsRecord,
    ImageProviderId,
    JsonValue,
    RoomConfigRecord,
    RoomMcpBindingRecord,
    SecretRecord,
} from '../../domain/types'
import {
    appMcpConnectionRepository,
    appProviderConnectionRepository,
    appSettingsRepository,
    auditRepository,
    providerValidationRepository,
    roomConfigRepository,
    roomMcpBindingRepository,
    roomRepository,
    roomSecretRepository,
    secretRepository,
} from '../../db/repositories'
import { getAppEnv } from '../../config/env'
import { assertNoReservedRoomRuntimeEnvKeys } from '../../security/process-env'
import { validateProviderConnection } from '../connection-validation'
import { inspectCodexAuthStatus, type CodexAuthStatus } from '../codex-auth'
import {
    mergeCapabilities,
    normalizeImageConfig,
    normalizeImageProvider,
    normalizeSearchConfig,
} from '../capabilities'
import {
    assertSupportedProvider,
    assertSupportedProviderApi,
    inferProviderAuthMode,
    normalizeProviderId,
    normalizeProviderModel,
    providerEnvKey,
    providerRequiresStoredCredential,
    upperSnake,
} from '../provider-config'
import type {
    RoomConfigSaveInput,
    RoomConfigSnapshot,
    RoomSecretSaveInput,
    RoomSecretSummary,
} from './contracts'
import { roomConfigSaveSchema, roomSecretSaveSchema } from './contracts'
import {
    imageConfigRecord,
    imageConfigSecretId,
    imageProviderEnvKey,
    nullableText,
    summarizeMcp,
    summarizeProvider,
    validateBaseUrl,
} from './helpers'
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
        toolsProfile: input.toolsProfile,
        capabilityOverrides: input.capabilityOverrides as JsonValue,
        imageProvider,
        imageModel: imageProvider ? imageModel : null,
        imageSecretId,
        cronTimezone: input.cronTimezone,
    })

    await roomMcpBindingRepository.replaceForRoom(
        input.roomId,
        input.mcpConnectionIds.map((mcpConnectionId) => ({
            mcpConnectionId,
            allowedTools: [],
            enabled: true,
        })),
    )

    await auditRepository.appendEvent({
        actorUserId,
        roomId: input.roomId,
        action: 'room_config.updated',
        payload: {
            providerMode: config.providerMode,
            providerConnectionId: config.providerConnectionId,
            mcpConnectionCount: input.mcpConnectionIds.length,
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

    return getRoomConfigSnapshot(input.roomId)
}

export async function saveRoomSecret(
    rawInput: RoomSecretSaveInput,
    actorUserId: string,
): Promise<RoomSecretSummary> {
    const input = roomSecretSaveSchema.parse(rawInput)
    const room = await roomRepository.findRoomById(input.roomId)
    if (!room) {
        throw new Error(`Room ${input.roomId} does not exist`)
    }

    const envKey = upperSnake(input.envKey)
    if (!envKey) {
        throw new Error('Room secret env key must contain at least one letter or number')
    }
    assertNoReservedRoomRuntimeEnvKeys(
        {
            [envKey]: 'reserved-check',
        },
        'Room secret env key',
    )

    const secret = await upsertEncryptedSecret({
        keyName: `room:${input.roomId}:secret:${envKey}`,
        plainText: input.value,
    })
    const saved = await roomSecretRepository.upsert({
        roomId: input.roomId,
        secretId: secret.id,
        label: input.label,
        envKey,
        purpose: input.purpose,
        provider: nullableText(input.provider),
        createdByUserId: actorUserId,
    })

    await auditRepository.appendEvent({
        actorUserId,
        roomId: input.roomId,
        action: 'room_secret.saved',
        payload: {
            roomSecretId: saved.id,
            envKey: saved.envKey,
            purpose: saved.purpose,
            provider: saved.provider,
        },
    })

    return {
        id: saved.id,
        label: saved.label,
        envKey: saved.envKey,
        purpose: saved.purpose,
        provider: saved.provider,
        updatedAt: saved.updatedAt.toISOString(),
    }
}

function summarizeRoomConfig(input: {
    config: RoomConfigRecord
    bindings: RoomMcpBindingRecord[]
    settings: AppSettingsRecord
}): RoomConfigSnapshot['config'] {
    const capabilities = mergeCapabilities({
        defaults: input.settings.capabilityDefaults,
        overrides: input.config.capabilityOverrides,
        toolsProfile: input.config.toolsProfile,
        mcpConnectionCount: input.bindings.filter((binding) => binding.enabled).length,
    })
    const capabilityOverrides =
        input.config.capabilityOverrides &&
        typeof input.config.capabilityOverrides === 'object' &&
        !Array.isArray(input.config.capabilityOverrides)
            ? (input.config.capabilityOverrides as Record<string, boolean>)
            : {}
    return {
        instructions: input.config.instructions,
        providerMode: input.config.providerMode,
        providerConnectionId: input.config.providerConnectionId,
        provider: input.config.provider,
        providerApi: input.config.providerApi,
        providerBaseUrl: input.config.providerBaseUrl,
        providerModel: input.config.providerModel,
        hasRoomProviderSecret: input.config.providerSecretId !== null,
        toolsProfile: input.config.toolsProfile,
        capabilities,
        capabilityOverrides,
        imageProvider: input.config.imageProvider,
        imageModel: input.config.imageModel,
        hasImageProviderSecret: input.config.imageSecretId !== null,
        cronTimezone: input.config.cronTimezone,
        mcpConnectionIds: input.bindings
            .filter((binding) => binding.enabled)
            .map((binding) => binding.mcpConnectionId),
    }
}

async function resolveEffectiveRoomSummary(input: {
    roomId: string
    config: RoomConfigRecord
    settings: AppSettingsRecord
    providers: AppProviderConnectionRecord[]
    bindings: RoomMcpBindingRecord[]
    mcpConnections: AppMcpConnectionRecord[]
}): Promise<RoomConfigSnapshot['effective']> {
    const blockedReasons: string[] = []
    let providerSource: RoomConfigSnapshot['effective']['providerSource'] = 'missing'
    let providerLabel: string | null = null
    let provider: string | null = null
    let model: string | null = null
    let codexAuth: CodexAuthStatus | null = null
    const capabilities = mergeCapabilities({
        defaults: input.settings.capabilityDefaults,
        overrides: input.config.capabilityOverrides,
        toolsProfile: input.config.toolsProfile,
        mcpConnectionCount: input.bindings.filter((binding) => binding.enabled).length,
    })
    const search = normalizeSearchConfig(input.settings.searchConfig)
    const appImageProvider = normalizeImageProvider(
        imageConfigRecord(input.settings.imageConfig).provider,
    )
    const appImageSecretId = imageConfigSecretId(input.settings.imageConfig)
    const imageEnvKey =
        input.config.imageProvider && input.config.imageSecretId
            ? imageProviderEnvKey(input.config.imageProvider)
            : !input.config.imageProvider && appImageProvider && appImageSecretId
              ? imageProviderEnvKey(appImageProvider)
              : null
    const image = normalizeImageConfig({
        appConfig: input.settings.imageConfig,
        roomProvider: input.config.imageProvider,
        roomModel: input.config.imageModel,
        envKey: imageEnvKey,
    })

    if (input.config.providerMode === 'room_secret') {
        providerSource = 'room_secret'
        provider = input.config.provider
        model = input.config.providerModel
        providerLabel = input.config.provider ? `${input.config.provider} room key` : null
        if (!input.config.provider || !input.config.providerApi || !input.config.providerModel) {
            blockedReasons.push('Room-scoped provider details are incomplete')
        }
        if (
            input.config.provider &&
            !input.config.providerSecretId &&
            providerRequiresStoredCredential({
                provider: input.config.provider,
                authMode: 'api_key',
            })
        ) {
            blockedReasons.push('Room-scoped provider key is missing')
        }
    } else {
        const providerId =
            input.config.providerMode === 'app_connection'
                ? input.config.providerConnectionId
                : input.settings.defaultProviderConnectionId
        const providerConnection = providerId
            ? input.providers.find((entry) => entry.id === providerId)
            : null
        providerSource = input.config.providerMode
        if (!providerConnection) {
            blockedReasons.push(
                input.config.providerMode === 'app_connection'
                    ? 'Selected provider connection does not exist'
                    : 'App default provider connection is not configured',
            )
        } else {
            providerLabel = providerConnection.label
            provider = providerConnection.provider
            model = providerConnection.defaultModel
            if (providerConnection.authMode === 'oauth') {
                codexAuth =
                    providerConnection.provider === 'openai-codex' ||
                    providerConnection.api === 'openai-codex-responses'
                        ? await inspectCodexAuthStatus(input.roomId)
                        : null
                if (codexAuth && !codexAuth.ready) {
                    blockedReasons.push(codexAuth.message)
                }
            } else if (
                providerRequiresStoredCredential({
                    provider: providerConnection.provider,
                    authMode: providerConnection.authMode,
                }) &&
                !providerConnection.credentialSecretId
            ) {
                blockedReasons.push('Provider connection has no saved credential')
            } else if (providerConnection.status !== 'ready') {
                blockedReasons.push(
                    providerConnection.validationMessage ??
                        `Provider connection ${providerConnection.label} is ${providerConnection.status}`,
                )
            }
        }
    }

    for (const binding of input.bindings.filter((entry) => entry.enabled)) {
        const connection = input.mcpConnections.find(
            (entry) => entry.id === binding.mcpConnectionId,
        )
        if (!connection) {
            blockedReasons.push(
                `MCP binding ${binding.mcpConnectionId} points to a missing connection`,
            )
            continue
        }
        if (connection.authMode === 'bearer' && !connection.credentialSecretId) {
            blockedReasons.push(`MCP connection ${connection.serverKey} requires a bearer token`)
        }
        if (connection.status !== 'ready') {
            blockedReasons.push(
                connection.validationMessage ??
                    `MCP connection ${connection.serverKey} is ${connection.status}`,
            )
        }
    }

    return {
        ready: blockedReasons.length === 0,
        blockedReasons,
        providerSource,
        providerLabel,
        provider,
        model,
        mcpServers: input.bindings
            .filter((binding) => binding.enabled)
            .map((binding) => {
                const connection = input.mcpConnections.find(
                    (entry) => entry.id === binding.mcpConnectionId,
                )
                return connection?.serverKey ?? binding.mcpConnectionId
            }),
        capabilities,
        searchReady: capabilities.webSearch && search.enabled,
        imageReady: capabilities.images && image.enabled,
        codexAuth,
    }
}

export async function getRoomConfigSnapshot(roomId: string): Promise<RoomConfigSnapshot> {
    const [config, settings, providers, mcpConnections, bindings, roomSecrets] = await Promise.all([
        roomConfigRepository.getOrCreate(roomId),
        appSettingsRepository.getOrCreate(),
        appProviderConnectionRepository.list(),
        appMcpConnectionRepository.list(),
        roomMcpBindingRepository.listByRoomId(roomId),
        roomSecretRepository.listByRoomId(roomId),
    ])

    return {
        roomId,
        config: summarizeRoomConfig({
            config,
            bindings,
            settings,
        }),
        effective: await resolveEffectiveRoomSummary({
            roomId,
            config,
            settings,
            providers,
            bindings,
            mcpConnections,
        }),
        providers: providers.map(summarizeProvider),
        mcpConnections: mcpConnections.map(summarizeMcp),
        roomSecrets: roomSecrets.map((secret) => ({
            id: secret.id,
            label: secret.label,
            envKey: secret.envKey,
            purpose: secret.purpose,
            provider: secret.provider,
            updatedAt: secret.updatedAt.toISOString(),
        })),
    }
}

export async function assertRoomConfigurationStartable(roomId: string): Promise<void> {
    const snapshot = await getRoomConfigSnapshot(roomId)
    if (snapshot.effective.ready) {
        return
    }

    throw new Error(
        `Room configuration is blocked: ${snapshot.effective.blockedReasons.join('; ')}`,
    )
}
