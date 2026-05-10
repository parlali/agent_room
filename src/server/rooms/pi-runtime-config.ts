import { join } from 'node:path'
import { getModel } from '@mariozechner/pi-ai'
import type {
    MaterializedMcpServer,
    MaterializedProviderConfig,
    MaterializedRoomConfiguration,
    ProviderApi,
    CapabilityConfig,
    ImageRuntimeConfig,
    RunBudgetConfig,
    RoomPaths,
    SearchRuntimeConfig,
} from '../domain/types'
import {
    isLocalProvider,
    normalizeProviderId,
    resolveProviderBaseUrl,
} from '../configuration/provider-config'

export type PiProviderKind = 'builtin' | 'local' | 'custom'

export interface PiModelProviderConfig {
    baseUrl?: string
    api?: ProviderApi
    apiKey?: string
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
        bindHost: '127.0.0.1'
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
        envKey: string | null
        kind: PiProviderKind
        fallbackModels: string[]
    }
    tools: {
        profile: string
    }
    capabilities: CapabilityConfig
    search: SearchRuntimeConfig
    image: ImageRuntimeConfig
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

export function isLocalPiProvider(provider: string): boolean {
    return isLocalProvider(provider)
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
    return trimmed.includes('/') && normalized === 'lmstudio'
        ? trimmed.replace(/^lm-studio\//i, '')
        : trimmed
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
    const baseUrl =
        provider.baseUrl ??
        (input.kind === 'local'
            ? resolveProviderBaseUrl({
                  provider: provider.provider,
                  api: provider.api,
                  baseUrl: provider.baseUrl,
              })
            : null)
    const apiKey =
        provider.authMode === 'oauth'
            ? undefined
            : input.kind === 'local'
              ? 'agent-room-local'
              : (provider.envKey ?? undefined)
    const config: PiModelProviderConfig = {
        ...(baseUrl ? { baseUrl } : {}),
        api: provider.api,
        ...(apiKey ? { apiKey } : {}),
        ...(input.kind === 'local'
            ? {
                  compat: {
                      supportsDeveloperRole: false,
                      supportsReasoningEffort: false,
                  },
              }
            : {}),
    }

    if (input.kind === 'builtin' && builtInPiModel(input.piProvider, input.piModel)) {
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
            name: provider.model,
            reasoning: provider.api !== 'openai-completions',
            input: ['text'],
            contextWindow: 128000,
            maxTokens: 16384,
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
    roomConfiguration: MaterializedRoomConfiguration
}): PiRuntimeConfig {
    const provider = input.roomConfiguration.provider
    const piProvider = toPiProvider(provider.provider)
    const piModel = stripProviderPrefix(provider.provider, provider.model)
    const kind: PiProviderKind = isLocalPiProvider(provider.provider)
        ? 'local'
        : provider.provider === 'openai-codex' ||
            provider.provider === 'openrouter' ||
            provider.provider === 'google' ||
            provider.provider === 'openai' ||
            provider.provider === 'anthropic'
          ? 'builtin'
          : 'custom'

    return {
        runtime: {
            kind: 'pi',
            roomId: input.roomId,
            displayName: input.displayName,
            bindHost: '127.0.0.1',
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
            authPath: join(input.paths.engineStateDir, 'auth.json'),
            modelsPath: join(input.paths.engineStateDir, 'models.json'),
            threadIndexPath: join(input.paths.engineStateDir, 'threads.json'),
            runtimeEventsPath: join(input.paths.engineStateDir, 'runtime-events.jsonl'),
            homeDir: join(input.paths.engineStateDir, 'home'),
            tmpDir: join(input.paths.engineStateDir, 'tmp'),
        },
        provider: {
            sourceProvider: provider.provider,
            sourceModel: provider.model,
            piProvider,
            piModel,
            api: provider.api,
            authMode: provider.authMode,
            baseUrl:
                provider.baseUrl ??
                (isLocalPiProvider(provider.provider)
                    ? resolveProviderBaseUrl({
                          provider: provider.provider,
                          api: provider.api,
                          baseUrl: provider.baseUrl,
                      })
                    : null),
            envKey: provider.envKey,
            kind,
            fallbackModels: provider.fallbackModels,
        },
        tools: {
            profile: input.roomConfiguration.toolsProfile,
        },
        capabilities: input.roomConfiguration.capabilities,
        search: input.roomConfiguration.search,
        image: input.roomConfiguration.image,
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
            reserveTokens: 16384,
            keepRecentTokens: 20000,
        },
    }
}
