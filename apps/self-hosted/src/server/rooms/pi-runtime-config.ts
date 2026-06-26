import { join } from 'node:path'
import { getModel } from '@mariozechner/pi-ai'
import type {
    MaterializedMcpServer,
    MaterializedProviderConfig,
    MaterializedRoomConfiguration,
    ProviderApi,
    CapabilityConfig,
    ImageRuntimeConfig,
    MaterializedGitHubBinding,
    RunBudgetConfig,
    RoomMode,
    RoomPaths,
    RuntimeSandboxHardening,
    RuntimeSandboxIdentity,
    SearchRuntimeConfig,
    UrlFetchRuntimeConfig,
} from '#/domain/domain-types'
import {
    assertSupportedProvider,
    assertSupportedProviderApi,
    normalizeProviderId,
} from '../configuration/provider-config'

export type PiProviderKind = 'builtin'

export interface PiModelProviderConfig {
    baseUrl?: string
    api?: ProviderApi
    authHeader?: boolean
    compat?: {
        supportsDeveloperRole?: boolean
        supportsReasoningEffort?: boolean
    }
    models?: Array<{
        id: string
        name?: string
        reasoning?: boolean
        input?: Array<'text' | 'image'>
        contextWindow?: number
        maxTokens?: number
        cost?: {
            input: number
            output: number
            cacheRead: number
            cacheWrite: number
        }
    }>
    modelOverrides?: Record<
        string,
        {
            name?: string
            reasoning?: boolean
            input?: Array<'text' | 'image'>
            contextWindow?: number
            maxTokens?: number
        }
    >
}

export interface PiModelsJson {
    providers: Record<string, PiModelProviderConfig>
}

export interface PiRuntimeConfig {
    runtime: {
        kind: 'pi'
        roomId: string
        displayName: string
        bindHost: '127.0.0.1' | '0.0.0.0'
        port: number
        token: string
    }
    paths: {
        roomRootDir: string
        stateDir: string
        workspaceDir: string
        storeDir: string
        sessionsDir: string
        internalStateDir: string
        authPath: string
        modelsPath: string
        threadIndexPath: string
        runtimeEventsPath: string
        homeDir: string
        tmpDir: string
    }
    provider: {
        sourceProvider: string
        sourceModel: string
        piProvider: string
        piModel: string
        api: ProviderApi
        authMode: MaterializedProviderConfig['authMode']
        baseUrl: string | null
        kind: PiProviderKind
        fallbackModels: string[]
    }
    roomMode: RoomMode
    sandbox: RuntimeSandboxIdentity
    sandboxHardening: RuntimeSandboxHardening
    capabilities: CapabilityConfig
    search: SearchRuntimeConfig
    urlFetch: UrlFetchRuntimeConfig
    image: ImageRuntimeConfig
    github: MaterializedGitHubBinding
    budgets: RunBudgetConfig
    instructions: string
    mcpServers: MaterializedMcpServer[]
    models: PiModelsJson
    compaction: {
        enabled: boolean
        reserveTokens: number
        keepRecentTokens: number
    }
}

function toPiProvider(provider: string): string {
    return normalizeProviderId(provider)
}

function stripProviderPrefix(provider: string, model: string): string {
    const normalized = toPiProvider(provider)
    const trimmed = model.trim()
    const prefix = `${normalized}/`
    if (trimmed.toLowerCase().startsWith(prefix)) {
        return trimmed.slice(prefix.length)
    }
    return trimmed
}

function builtInPiModel(provider: string, model: string) {
    return getModel(provider as never, model as never)
}

function zeroModelCost() {
    return {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
    }
}

function buildProviderModels(input: {
    provider: MaterializedProviderConfig
    piProvider: string
    piModel: string
    kind: PiProviderKind
}): Record<string, PiModelProviderConfig> {
    const provider = input.provider
    const baseUrl = provider.baseUrl
    const config: PiModelProviderConfig = {
        ...(baseUrl ? { baseUrl } : {}),
        api: provider.api,
    }

    if (builtInPiModel(input.piProvider, input.piModel)) {
        return {
            [input.piProvider]: {
                ...config,
                modelOverrides: {
                    [input.piModel]: {},
                },
            },
        }
    }

    config.models = [
        {
            id: input.piModel,
            name: provider.modelLabel ?? provider.model,
            reasoning: provider.api !== 'openai-completions',
            input: ['text'],
            contextWindow: provider.contextWindowTokens ?? 128000,
            maxTokens: provider.maxOutputTokens ?? 16384,
            cost: zeroModelCost(),
        },
    ]

    return {
        [input.piProvider]: config,
    }
}

export function buildPiRuntimeConfig(input: {
    roomId: string
    displayName: string
    port: number
    token: string
    paths: RoomPaths
    sandbox: RuntimeSandboxIdentity
    sandboxHardening: RuntimeSandboxHardening
    roomConfiguration: MaterializedRoomConfiguration
    bindHost?: PiRuntimeConfig['runtime']['bindHost']
}): PiRuntimeConfig {
    const provider = input.roomConfiguration.provider
    assertSupportedProvider(provider.provider)
    assertSupportedProviderApi(provider.provider, provider.api)
    const piProvider = toPiProvider(provider.provider)
    const piModel = stripProviderPrefix(provider.provider, provider.model)
    const kind: PiProviderKind = 'builtin'
    const homeDir = join(input.paths.engineStateDir, 'home')
    const github = input.roomConfiguration.entitlements.github.enabled
        ? {
              ...input.roomConfiguration.entitlements.github,
              ghHostsPath: join(homeDir, '.config', 'gh', 'hosts.yml'),
              gitCredentialsPath: join(homeDir, '.git-credentials'),
              gitConfigPath: join(homeDir, '.gitconfig'),
          }
        : input.roomConfiguration.entitlements.github

    return {
        runtime: {
            kind: 'pi',
            roomId: input.roomId,
            displayName: input.displayName,
            bindHost: input.bindHost ?? '127.0.0.1',
            port: input.port,
            token: input.token,
        },
        paths: {
            roomRootDir: input.paths.roomRootDir,
            stateDir: input.paths.engineStateDir,
            workspaceDir: input.paths.workspaceDir,
            storeDir: input.paths.storeDir,
            sessionsDir: join(input.paths.engineStateDir, 'sessions'),
            internalStateDir: join(input.paths.engineStateDir, 'internal-state'),
            authPath: provider.authPath ?? join(input.paths.engineStateDir, 'auth.json'),
            modelsPath: join(input.paths.engineStateDir, 'models.json'),
            threadIndexPath: join(input.paths.engineStateDir, 'threads.json'),
            runtimeEventsPath: join(input.paths.engineStateDir, 'runtime-events.jsonl'),
            homeDir,
            tmpDir: join(input.paths.engineStateDir, 'tmp'),
        },
        provider: {
            sourceProvider: provider.provider,
            sourceModel: provider.model,
            piProvider,
            piModel,
            api: provider.api,
            authMode: provider.authMode,
            baseUrl: provider.baseUrl,
            kind,
            fallbackModels: provider.fallbackModels,
        },
        roomMode: input.roomConfiguration.roomMode,
        sandbox: input.sandbox,
        sandboxHardening: input.sandboxHardening,
        capabilities: input.roomConfiguration.capabilities,
        search: input.roomConfiguration.search,
        urlFetch: input.roomConfiguration.urlFetch,
        image: input.roomConfiguration.image,
        github,
        budgets: input.roomConfiguration.budgets,
        instructions: input.roomConfiguration.instructions,
        mcpServers: input.roomConfiguration.entitlements.mcpServers,
        models: {
            providers: buildProviderModels({
                provider,
                piProvider,
                piModel,
                kind,
            }),
        },
        compaction: {
            enabled: true,
            reserveTokens: provider.compactionReserveTokens ?? 16384,
            keepRecentTokens: provider.compactionKeepRecentTokens ?? 20000,
        },
    }
}
