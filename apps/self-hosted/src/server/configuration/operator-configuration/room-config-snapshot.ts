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
import { inspectCodexAppAuthStatusSync, type CodexAppAuthStatus } from '../codex-auth'
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
import type { RoomConfigSnapshot } from './contracts'
import { resolveEffectiveProvider } from './provider-resolution'
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
    let codexAuth: CodexAppAuthStatus | null = null
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

    const providerResolution = resolveEffectiveProvider({
        config: input.config,
        settings: input.settings,
        providers: input.providers,
        codexAuth: inspectCodexAppAuthStatusSync(),
    })
    providerSource = providerResolution.source
    codexAuth = providerResolution.codexAuth
    if (!providerResolution.provider) {
        blockedReasons.push(...providerResolution.blockedReasons)
    } else {
        providerLabel = providerResolution.provider.label
        provider = providerResolution.provider.provider
        model = providerResolution.provider.defaultModel
        blockedReasons.push(...providerResolution.blockedReasons)
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
            config,
            settings,
            providers,
            bindings,
            githubBinding,
            mcpConnections,
        }),
        providers: providers.map((provider) => summarizeProvider(provider)),
        mcpConnections: mcpConnections.map((connection) => summarizeMcp(connection)),
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
