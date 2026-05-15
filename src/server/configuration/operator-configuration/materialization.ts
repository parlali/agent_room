import { chmod, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
    AppSettingsRecord,
    ImageProviderId,
    MaterializedEntitlements,
    MaterializedMcpServer,
    MaterializedProviderConfig,
    MaterializedRoomConfiguration,
    ProviderAuthMode,
    ProviderApi,
    RoomConfigRecord,
    RoomMcpBindingRecord,
    RoomProviderMode,
    RoomSecretRecord,
    SecretRecord,
} from '../../domain/types'
import {
    appMcpConnectionRepository,
    appProviderConnectionRepository,
    appSettingsRepository,
    roomConfigRepository,
    roomGitHubBindingRepository,
    roomMcpBindingRepository,
    roomSecretRepository,
    secretRepository,
} from '../../db/repositories'
import { getAppEnv } from '../../config/env'
import {
    assertNoReservedRoomRuntimeEnvKeys,
    reservedRoomRuntimeEnvKeys,
} from '../../security/process-env'
import { inspectCodexAuthStatus } from '../codex-auth'
import {
    mergeCapabilities,
    normalizeBudgets,
    normalizeImageConfig,
    normalizeImageProvider,
    normalizeSearchConfig,
    searchProviderEnvKey,
    searchProviderSecretId,
    withSearchProviderEnvKeys,
} from '../capabilities'
import { materializeRoomGitHubBinding } from '../github-app'
import {
    assertSupportedProvider,
    assertSupportedProviderApi,
    providerEnvKey,
    providerRequiresStoredCredential,
    resolveProviderBaseUrl,
    upperSnake,
} from '../provider-config'
import {
    imageConfigRecord,
    imageConfigSecretId,
    imageProviderEnvKey,
    isImageProviderEnvKey,
    toStringArray,
    toStringRecord,
} from './helpers'
import { decryptSecretRecord, resolveSecret } from './secrets'

async function resolveProviderForMaterialization(input: {
    roomId: string
    config: RoomConfigRecord
    settings: AppSettingsRecord
}): Promise<{
    source: RoomProviderMode
    provider: string
    authMode: ProviderAuthMode
    api: ProviderApi
    baseUrl: string | null
    model: string
    fallbackModels: string[]
    secret: SecretRecord | null
}> {
    if (input.config.providerMode === 'room_secret') {
        const secret = await resolveSecret(input.config.providerSecretId)
        const requiresCredential = providerRequiresStoredCredential({
            provider: input.config.provider ?? '',
            authMode: 'api_key',
        })
        if (
            !input.config.provider ||
            !input.config.providerApi ||
            !input.config.providerModel ||
            (requiresCredential && !secret)
        ) {
            throw new Error('Room provider configuration is incomplete')
        }
        return {
            source: 'room_secret',
            provider: input.config.provider,
            authMode: 'api_key',
            api: input.config.providerApi,
            baseUrl: input.config.providerBaseUrl,
            model: input.config.providerModel,
            fallbackModels: [],
            secret: requiresCredential ? secret : null,
        }
    }

    const providerConnectionId =
        input.config.providerMode === 'app_connection'
            ? input.config.providerConnectionId
            : input.settings.defaultProviderConnectionId

    if (!providerConnectionId) {
        throw new Error('Room has no effective provider connection')
    }

    const providerConnection = await appProviderConnectionRepository.findById(providerConnectionId)
    if (!providerConnection) {
        throw new Error('Room effective provider connection was not found')
    }

    const secret = await resolveSecret(providerConnection.credentialSecretId)
    const requiresCredential = providerRequiresStoredCredential({
        provider: providerConnection.provider,
        authMode: providerConnection.authMode,
    })
    if (requiresCredential && !secret) {
        throw new Error('Room effective provider credential is missing')
    }
    if (providerConnection.status !== 'ready') {
        throw new Error(
            providerConnection.validationMessage ??
                `Room effective provider connection ${providerConnection.label} is not ready`,
        )
    }
    if (
        providerConnection.authMode === 'oauth' &&
        (providerConnection.provider === 'openai-codex' ||
            providerConnection.api === 'openai-codex-responses')
    ) {
        const authStatus = await inspectCodexAuthStatus(input.roomId)
        if (!authStatus.ready) {
            throw new Error(authStatus.message)
        }
    }

    return {
        source: input.config.providerMode,
        provider: providerConnection.provider,
        authMode: providerConnection.authMode,
        api: providerConnection.api,
        baseUrl: providerConnection.baseUrl,
        model: providerConnection.defaultModel,
        fallbackModels: toStringArray(providerConnection.fallbackModels),
        secret: requiresCredential ? secret : null,
    }
}

async function materializeProvider(input: {
    runtimeSecretsDir: string
    provider: string
    authMode: ProviderAuthMode
    api: ProviderApi
    baseUrl: string | null
    model: string
    fallbackModels: string[]
    secret: SecretRecord | null
    encryptionKey: Buffer
}): Promise<{
    provider: MaterializedProviderConfig
    entitlements: Pick<MaterializedEntitlements, 'env' | 'secretRefs'>
}> {
    assertSupportedProvider(input.provider)
    assertSupportedProviderApi(input.provider, input.api)
    const envKey = providerRequiresStoredCredential({
        provider: input.provider,
        authMode: input.authMode,
    })
        ? providerEnvKey(input.provider)
        : null
    const env: Record<string, string> = {}
    const secretRefs: MaterializedEntitlements['secretRefs'] = []
    if (envKey && input.secret) {
        const plainText = decryptSecretRecord(input.secret, input.encryptionKey)
        const secretFilePath = join(input.runtimeSecretsDir, `${envKey.toLowerCase()}.secret`)
        await writeFile(secretFilePath, plainText, {
            encoding: 'utf8',
            mode: 0o600,
        })
        await chmod(secretFilePath, 0o600)
        env[envKey] = plainText
        secretRefs.push({
            entitlementId: 'provider',
            secretId: input.secret.id,
            filePath: secretFilePath,
            envKey,
        })
    }

    return {
        provider: {
            provider: input.provider,
            authMode: input.authMode,
            api: input.api,
            model: input.model,
            fallbackModels: input.fallbackModels,
            baseUrl: resolveProviderBaseUrl({
                provider: input.provider,
                api: input.api,
                baseUrl: input.baseUrl,
            }),
            envKey,
        },
        entitlements: {
            env,
            secretRefs,
        },
    }
}

async function materializeRoomSecrets(input: {
    roomSecrets: RoomSecretRecord[]
    runtimeSecretsDir: string
    secretById: Map<string, SecretRecord>
    encryptionKey: Buffer
    reservedEnvKeys: Set<string>
}): Promise<Pick<MaterializedEntitlements, 'env' | 'secretRefs'>> {
    const env: Record<string, string> = {}
    const secretRefs: MaterializedEntitlements['secretRefs'] = []
    const usedEnvKeys = new Set(input.reservedEnvKeys)

    for (const roomSecret of input.roomSecrets) {
        if (roomSecret.purpose === 'provider_api_key') {
            continue
        }
        const envKey = upperSnake(roomSecret.envKey)
        assertNoReservedRoomRuntimeEnvKeys(
            {
                [envKey]: 'reserved-check',
            },
            'Room secret env key',
        )
        if (usedEnvKeys.has(envKey)) {
            throw new Error(`Room secret env key ${envKey} conflicts with materialized config`)
        }

        const secret = input.secretById.get(roomSecret.secretId)
        if (!secret) {
            throw new Error(`Room secret ${roomSecret.label} is missing encrypted payload`)
        }

        const plainText = decryptSecretRecord(secret, input.encryptionKey)
        const secretFilePath = join(input.runtimeSecretsDir, `${envKey.toLowerCase()}.secret`)
        await writeFile(secretFilePath, plainText, {
            encoding: 'utf8',
            mode: 0o600,
        })
        await chmod(secretFilePath, 0o600)

        env[envKey] = plainText
        secretRefs.push({
            entitlementId: `room_secret:${roomSecret.id}`,
            secretId: secret.id,
            filePath: secretFilePath,
            envKey,
        })
        usedEnvKeys.add(envKey)
    }

    return {
        env,
        secretRefs,
    }
}

async function materializeImageSecret(input: {
    provider: ImageProviderId
    secret: SecretRecord | null
    runtimeSecretsDir: string
    encryptionKey: Buffer
    entitlementId: string
}): Promise<Pick<MaterializedEntitlements, 'env' | 'secretRefs'>> {
    if (!input.secret) {
        return {
            env: {},
            secretRefs: [],
        }
    }

    const envKey = imageProviderEnvKey(input.provider)
    const plainText = decryptSecretRecord(input.secret, input.encryptionKey)
    const secretFilePath = join(input.runtimeSecretsDir, `${envKey.toLowerCase()}.secret`)
    await writeFile(secretFilePath, plainText, {
        encoding: 'utf8',
        mode: 0o600,
    })
    await chmod(secretFilePath, 0o600)

    return {
        env: {
            [envKey]: plainText,
        },
        secretRefs: [
            {
                entitlementId: input.entitlementId,
                secretId: input.secret.id,
                filePath: secretFilePath,
                envKey,
            },
        ],
    }
}

export async function materializeSearchConfig(input: {
    searchConfig: AppSettingsRecord['searchConfig']
    runtimeSecretsDir: string
    encryptionKey: Buffer
}): Promise<{
    search: MaterializedRoomConfiguration['search']
    entitlements: Pick<MaterializedEntitlements, 'env' | 'secretRefs'>
}> {
    const normalized = normalizeSearchConfig(input.searchConfig)
    const env: Record<string, string> = {}
    const secretRefs: MaterializedEntitlements['secretRefs'] = []
    const materializedProviders: {
        brave?: boolean
        browserbase?: boolean
    } = {}

    for (const provider of ['brave', 'browserbase'] as const) {
        const providerConfig = normalized[provider]
        if (!providerConfig.enabled) {
            continue
        }
        const secretId = searchProviderSecretId({
            config: input.searchConfig,
            provider,
        })
        if (!secretId) {
            continue
        }
        const secret = await resolveSecret(secretId)
        if (!secret) {
            throw new Error(`${provider} search credential is missing encrypted payload`)
        }
        const envKey = searchProviderEnvKey(provider)
        const plainText = decryptSecretRecord(secret, input.encryptionKey)
        const secretFilePath = join(input.runtimeSecretsDir, `${envKey.toLowerCase()}.secret`)
        await writeFile(secretFilePath, plainText, {
            encoding: 'utf8',
            mode: 0o600,
        })
        await chmod(secretFilePath, 0o600)
        env[envKey] = plainText
        secretRefs.push({
            entitlementId: `app_search:${provider}`,
            secretId: secret.id,
            filePath: secretFilePath,
            envKey,
        })
        materializedProviders[provider] = true
    }

    return {
        search: withSearchProviderEnvKeys(normalized, materializedProviders),
        entitlements: {
            env,
            secretRefs,
        },
    }
}

async function materializeMcpBindings(input: {
    bindings: RoomMcpBindingRecord[]
    runtimeSecretsDir: string
    encryptionKey: Buffer
}): Promise<MaterializedMcpServer[]> {
    const servers: MaterializedMcpServer[] = []

    for (const binding of input.bindings.filter((entry) => entry.enabled)) {
        const connection = await appMcpConnectionRepository.findById(binding.mcpConnectionId)
        if (!connection) {
            throw new Error(
                `Room MCP binding ${binding.mcpConnectionId} points to a missing connection`,
            )
        }

        const env: Record<string, string> = {}
        const headers = {
            ...toStringRecord(connection.headers),
        }

        if (connection.authMode === 'bearer') {
            const secret = await resolveSecret(connection.credentialSecretId)
            if (!secret) {
                throw new Error(
                    `MCP connection ${connection.serverKey} requires a saved bearer token`,
                )
            }
            const plainText = decryptSecretRecord(secret, input.encryptionKey)
            if (connection.transport === 'stdio') {
                env.MCP_AUTH_TOKEN = plainText
            } else {
                headers.Authorization = `Bearer ${plainText}`
            }
        }

        servers.push({
            id: connection.serverKey,
            provider: connection.name,
            allowedTools:
                toStringArray(binding.allowedTools).length > 0
                    ? toStringArray(binding.allowedTools)
                    : toStringArray(connection.allowedTools),
            transport: connection.transport,
            command: connection.command,
            args: toStringArray(connection.args),
            url: connection.url,
            env,
            headers,
        })
    }

    return servers
}

export async function materializeRoomConfiguration(input: {
    roomId: string
    runtimeSecretsDir: string
}): Promise<MaterializedRoomConfiguration> {
    const env = getAppEnv()
    const [config, settings, bindings, roomSecrets, githubBinding] = await Promise.all([
        roomConfigRepository.getOrCreate(input.roomId),
        appSettingsRepository.getOrCreate(),
        roomMcpBindingRepository.listByRoomId(input.roomId),
        roomSecretRepository.listByRoomId(input.roomId),
        roomGitHubBindingRepository.findByRoomId(input.roomId),
    ])
    const providerSelection = await resolveProviderForMaterialization({
        roomId: input.roomId,
        config,
        settings,
    })
    const providerMaterialization = await materializeProvider({
        runtimeSecretsDir: input.runtimeSecretsDir,
        provider: providerSelection.provider,
        authMode: providerSelection.authMode,
        api: providerSelection.api,
        baseUrl: providerSelection.baseUrl,
        model: providerSelection.model,
        fallbackModels: providerSelection.fallbackModels,
        secret: providerSelection.secret,
        encryptionKey: env.encryptionKey,
    })
    const appImageProvider = normalizeImageProvider(
        imageConfigRecord(settings.imageConfig).provider,
    )
    const appImageSecretId = imageConfigSecretId(settings.imageConfig)
    const imageRoomSecret = config.imageSecretId
        ? (roomSecrets.find((roomSecret) => roomSecret.secretId === config.imageSecretId) ?? null)
        : null
    const imageSecretId = config.imageProvider ? config.imageSecretId : appImageSecretId
    const imageProvider = config.imageProvider ?? appImageProvider
    const imageSecret = imageSecretId ? await resolveSecret(imageSecretId) : null
    const imageMaterialization =
        imageProvider && imageSecret
            ? await materializeImageSecret({
                  provider: imageProvider,
                  secret: imageSecret,
                  runtimeSecretsDir: input.runtimeSecretsDir,
                  encryptionKey: env.encryptionKey,
                  entitlementId: config.imageProvider ? 'room_image' : 'app_image',
              })
            : {
                  env: {},
                  secretRefs: [],
              }
    const searchMaterialization = await materializeSearchConfig({
        searchConfig: settings.searchConfig,
        runtimeSecretsDir: input.runtimeSecretsDir,
        encryptionKey: env.encryptionKey,
    })
    const materializedRoomSecrets = roomSecrets.filter(
        (roomSecret) =>
            roomSecret.purpose !== 'provider_api_key' &&
            roomSecret.secretId !== providerSelection.secret?.id &&
            roomSecret.secretId !== imageRoomSecret?.secretId &&
            !isImageProviderEnvKey(roomSecret.envKey),
    )
    const roomSecretRecords = await Promise.all(
        materializedRoomSecrets.map((roomSecret) => secretRepository.findById(roomSecret.secretId)),
    )
    const roomSecretById = new Map<string, SecretRecord>()
    for (const secret of roomSecretRecords) {
        if (secret) {
            roomSecretById.set(secret.id, secret)
        }
    }
    const roomSecretMaterialization = await materializeRoomSecrets({
        roomSecrets: materializedRoomSecrets,
        runtimeSecretsDir: input.runtimeSecretsDir,
        secretById: roomSecretById,
        encryptionKey: env.encryptionKey,
        reservedEnvKeys: new Set([
            ...Object.keys(providerMaterialization.entitlements.env),
            ...Object.keys(imageMaterialization.env),
            ...Object.keys(searchMaterialization.entitlements.env),
        ]),
    })
    const mcpServers = await materializeMcpBindings({
        bindings,
        runtimeSecretsDir: input.runtimeSecretsDir,
        encryptionKey: env.encryptionKey,
    })
    const githubMaterialization = await materializeRoomGitHubBinding({
        roomMode: config.roomMode,
        binding: githubBinding,
    })
    const enabledBindings = bindings.filter((binding) => binding.enabled)
    const capabilities = mergeCapabilities({
        defaults: settings.capabilityDefaults,
        overrides: config.capabilityOverrides,
        roomMode: config.roomMode,
        mcpConnectionCount: enabledBindings.length,
    })
    const image = normalizeImageConfig({
        appConfig: settings.imageConfig,
        roomProvider: config.imageProvider,
        roomModel: config.imageModel,
        envKey: imageProvider && imageSecret ? imageProviderEnvKey(imageProvider) : null,
    })

    return {
        instructions: config.instructions,
        roomMode: config.roomMode,
        capabilities,
        search: searchMaterialization.search,
        image,
        budgets: {
            ...normalizeBudgets(),
            browserActionsPerTurn: config.browserActionBudget,
        },
        provider: providerMaterialization.provider,
        entitlements: {
            env: {
                ...providerMaterialization.entitlements.env,
                ...imageMaterialization.env,
                ...searchMaterialization.entitlements.env,
                ...roomSecretMaterialization.env,
            },
            internalEnv: {
                ...githubMaterialization.internalEnv,
            },
            secretRefs: [
                ...providerMaterialization.entitlements.secretRefs,
                ...imageMaterialization.secretRefs,
                ...searchMaterialization.entitlements.secretRefs,
                ...roomSecretMaterialization.secretRefs,
            ],
            mcpServers: capabilities.mcp ? mcpServers : [],
            github: githubMaterialization.github,
        },
    }
}

export const __testing = {
    materializeRoomSecrets,
    reservedRoomRuntimeEnvKeys,
}
