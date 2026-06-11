import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
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
} from '#/domain/domain-types'
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
import { inspectCodexAppAuthStatusSync, resolveCodexPiAuthPath } from '../codex-auth'
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
    isOpenAICodexProvider,
    providerRequiresStoredCredential,
    resolveProviderBaseUrl,
    upperSnake,
} from '../provider-config'
import { resolveEffectiveProvider } from './provider-resolution'
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
    config: RoomConfigRecord
    settings: AppSettingsRecord
}): Promise<{
    source: RoomProviderMode | 'missing'
    provider: string
    authMode: ProviderAuthMode
    api: ProviderApi
    baseUrl: string | null
    model: string
    fallbackModels: string[]
    secret: SecretRecord | null
    authPath: string | null
}> {
    const providers = await appProviderConnectionRepository.list()
    const codexAuth = inspectCodexAppAuthStatusSync()
    const resolution = resolveEffectiveProvider({
        config: input.config,
        settings: input.settings,
        providers,
        codexAuth,
    })
    if (!resolution.provider) {
        throw new Error(resolution.blockedReasons.join('; ') || 'Room has no effective provider')
    }
    if (resolution.blockedReasons.length > 0) {
        throw new Error(resolution.blockedReasons.join('; '))
    }

    const providerConnection = resolution.provider
    const requiresCredential = providerRequiresStoredCredential({
        provider: providerConnection.provider,
        authMode: providerConnection.authMode,
    })
    const secret = await resolveSecret(providerConnection.credentialSecretId)
    if (requiresCredential && !secret) {
        throw new Error('Room effective provider credential is missing')
    }

    return {
        source: resolution.source,
        provider: providerConnection.provider,
        authMode: providerConnection.authMode,
        api: providerConnection.api,
        baseUrl: providerConnection.baseUrl,
        model: providerConnection.defaultModel,
        fallbackModels: toStringArray(providerConnection.fallbackModels),
        secret: requiresCredential ? secret : null,
        authPath: isOpenAICodexProvider({
            provider: providerConnection.provider,
            api: providerConnection.api,
        })
            ? resolveCodexPiAuthPath()
            : null,
    }
}

async function materializeProvider(input: {
    providerAuthPath: string
    provider: string
    authMode: ProviderAuthMode
    api: ProviderApi
    baseUrl: string | null
    model: string
    fallbackModels: string[]
    secret: SecretRecord | null
    authPath: string | null
    encryptionKey: Buffer
}): Promise<{
    provider: MaterializedProviderConfig
    entitlements: Pick<MaterializedEntitlements, 'env' | 'secretRefs'>
}> {
    assertSupportedProvider(input.provider)
    assertSupportedProviderApi(input.provider, input.api)
    const requiresCredential = providerRequiresStoredCredential({
        provider: input.provider,
        authMode: input.authMode,
    })
    const env: Record<string, string> = {}
    const secretRefs: MaterializedEntitlements['secretRefs'] = []
    let authPath = input.authPath
    if (!authPath && requiresCredential && input.secret) {
        const plainText = decryptSecretRecord(input.secret, input.encryptionKey)
        authPath = input.providerAuthPath
        await mkdir(dirname(authPath), {
            recursive: true,
            mode: 0o700,
        })
        await writeFile(
            authPath,
            `${JSON.stringify(
                {
                    [input.provider]: {
                        type: 'api_key',
                        key: plainText,
                    },
                },
                null,
                4,
            )}\n`,
            {
                encoding: 'utf8',
                mode: 0o600,
            },
        )
        await chmod(authPath, 0o600)
        secretRefs.push({
            entitlementId: 'provider',
            secretId: input.secret.id,
            filePath: authPath,
            envKey: null,
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
            authPath,
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
        if (roomSecret.purpose === 'image_api_key') {
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
    providerAuthPath?: string
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
        config,
        settings,
    })
    const providerMaterialization = await materializeProvider({
        providerAuthPath:
            input.providerAuthPath ?? join(input.runtimeSecretsDir, 'provider-auth.json'),
        provider: providerSelection.provider,
        authMode: providerSelection.authMode,
        api: providerSelection.api,
        baseUrl: providerSelection.baseUrl,
        model: providerSelection.model,
        fallbackModels: providerSelection.fallbackModels,
        secret: providerSelection.secret,
        authPath: providerSelection.authPath,
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
            roomSecret.purpose !== 'image_api_key' &&
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
    materializeProvider,
    materializeRoomSecrets,
    reservedRoomRuntimeEnvKeys,
}
