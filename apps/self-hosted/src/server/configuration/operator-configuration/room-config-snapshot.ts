import type {
    AppMcpConnectionRecord,
    AppProviderConnectionRecord,
    AppSettingsRecord,
    RoomConfigRecord,
    RoomGitHubBindingRecord,
    RoomMcpBindingRecord,
} from '#/domain/domain-types'
import {
    appMcpConnectionRepository,
    appProviderConnectionRepository,
    appSettingsRepository,
    roomConfigRepository,
    roomGitHubBindingRepository,
    roomMcpBindingRepository,
    roomSecretRepository,
} from '../../db/repositories'
import { inspectCodexAuthStatus, type CodexAuthStatus } from '../codex-auth'
import {
    mergeCapabilities,
    normalizeImageConfig,
    normalizeImageProvider,
    normalizeSearchConfig,
} from '../capabilities'
import {
    getGitHubIntegrationSummary,
    resolveRoomGitHubStatus,
    summarizeRoomGitHubBinding,
} from '../github-app'
import { providerRequiresStoredCredential } from '../provider-config'
import type { RoomConfigSnapshot } from './contracts'
import {
    imageConfigRecord,
    imageConfigSecretId,
    imageProviderEnvKey,
    summarizeMcp,
    summarizeProvider,
} from './helpers'

function summarizeRoomConfig(input: {
    config: RoomConfigRecord
    bindings: RoomMcpBindingRecord[]
    githubBinding: RoomGitHubBindingRecord | null
    settings: AppSettingsRecord
}): RoomConfigSnapshot['config'] {
    const capabilities = mergeCapabilities({
        defaults: input.settings.capabilityDefaults,
        overrides: input.config.capabilityOverrides,
        roomMode: input.config.roomMode,
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
        roomMode: input.config.roomMode,
        capabilities,
        capabilityOverrides,
        imageProvider: input.config.imageProvider,
        imageModel: input.config.imageModel,
        hasImageProviderSecret: input.config.imageSecretId !== null,
        cronTimezone: input.config.cronTimezone,
        browserActionBudget: input.config.browserActionBudget,
        mcpConnectionIds: input.bindings
            .filter((binding) => binding.enabled)
            .map((binding) => binding.mcpConnectionId),
        github: summarizeRoomGitHubBinding(input.githubBinding),
    }
}

async function resolveEffectiveRoomSummary(input: {
    roomId: string
    config: RoomConfigRecord
    settings: AppSettingsRecord
    providers: AppProviderConnectionRecord[]
    bindings: RoomMcpBindingRecord[]
    githubBinding: RoomGitHubBindingRecord | null
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
        roomMode: input.config.roomMode,
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
    const github = await resolveRoomGitHubStatus({
        binding: input.githubBinding,
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
    if (!github.ready && github.message) {
        blockedReasons.push(github.message)
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
        github,
    }
}

export async function getRoomConfigSnapshot(roomId: string): Promise<RoomConfigSnapshot> {
    const [
        config,
        settings,
        providers,
        mcpConnections,
        bindings,
        githubBinding,
        github,
        roomSecrets,
    ] = await Promise.all([
        roomConfigRepository.getOrCreate(roomId),
        appSettingsRepository.getOrCreate(),
        appProviderConnectionRepository.list(),
        appMcpConnectionRepository.list(),
        roomMcpBindingRepository.listByRoomId(roomId),
        roomGitHubBindingRepository.findByRoomId(roomId),
        getGitHubIntegrationSummary(),
        roomSecretRepository.listByRoomId(roomId),
    ])

    return {
        roomId,
        config: summarizeRoomConfig({
            config,
            bindings,
            githubBinding,
            settings,
        }),
        effective: await resolveEffectiveRoomSummary({
            roomId,
            config,
            settings,
            providers,
            bindings,
            githubBinding,
            mcpConnections,
        }),
        providers: providers.map(summarizeProvider),
        mcpConnections: mcpConnections.map(summarizeMcp),
        github,
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
