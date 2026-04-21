import type {
    MaterializedRoomConfiguration,
    OpenClawRuntimeConfig,
    RoomPaths,
} from '../domain/types'
import {
    isOpenAICodexProvider,
    normalizeProviderModel,
    resolveProviderBaseUrl,
} from '../configuration/provider-config'

function providerModelId(provider: string, model: string): string {
    const normalizedModel = normalizeProviderModel(provider, model)
    return normalizedModel.replace(`${provider}/`, '')
}

function isCodexProvider(input: MaterializedRoomConfiguration['provider']): boolean {
    return isOpenAICodexProvider(input)
}

function buildModelParams(input: MaterializedRoomConfiguration['provider']) {
    const models = Array.from(
        new Set(
            [input.model, ...input.fallbackModels].map((model) =>
                normalizeProviderModel(input.provider, model),
            ),
        ),
    )
    const params: Record<string, { params: Record<string, string | number | boolean> }> = {}
    for (const model of models) {
        if (isCodexProvider(input)) {
            params[model] = {
                params: {
                    transport: 'websocket',
                },
            }
        }
    }
    return params
}

export function buildOpenClawRuntimeConfig(input: {
    roomId: string
    displayName: string
    port: number
    paths: RoomPaths
    roomConfiguration: MaterializedRoomConfiguration
}): OpenClawRuntimeConfig {
    const mcpServers: OpenClawRuntimeConfig['mcp']['servers'] = {}
    for (const server of input.roomConfiguration.entitlements.mcpServers) {
        if (server.transport === 'stdio') {
            mcpServers[server.id] = {
                command: server.command ?? undefined,
                args: server.args,
                env: server.env,
            }
            continue
        }

        const transport: 'streamable-http' | undefined =
            server.transport === 'streamable_http' ? 'streamable-http' : undefined
        mcpServers[server.id] = {
            url: server.url ?? undefined,
            transport,
            headers: Object.keys(server.headers).length > 0 ? server.headers : undefined,
        }
    }
    const provider = input.roomConfiguration.provider
    const resolvedBaseUrl = resolveProviderBaseUrl({
        provider: provider.provider,
        api: provider.api,
        baseUrl: provider.baseUrl,
    })
    const providerModels =
        resolvedBaseUrl === null && provider.envKey === null
            ? {}
            : {
                  [provider.provider]: {
                      ...(resolvedBaseUrl ? { baseUrl: resolvedBaseUrl } : {}),
                      ...(provider.envKey ? { apiKey: provider.envKey } : {}),
                      api: provider.api,
                      models: Array.from(
                          new Set(
                              [provider.model, ...provider.fallbackModels].map((model) =>
                                  normalizeProviderModel(provider.provider, model),
                              ),
                          ),
                      ).map((model) => ({
                          id: providerModelId(provider.provider, model),
                          name: model,
                          ...(isCodexProvider(provider)
                              ? {
                                    contextTokens: 272000,
                                }
                              : {}),
                      })),
                  },
              }
    const modelParams = buildModelParams(provider)
    const primaryModel = normalizeProviderModel(provider.provider, provider.model)
    const fallbackModels = Array.from(
        new Set(
            provider.fallbackModels.map((model) =>
                normalizeProviderModel(provider.provider, model),
            ),
        ),
    )

    return {
        env: {
            shellEnv: {
                enabled: false,
            },
        },
        gateway: {
            mode: 'local',
            bind: 'loopback',
            port: input.port,
            controlUi: {
                enabled: false,
            },
            auth: {
                mode: 'token',
            },
        },
        agents: {
            defaults: {
                workspace: input.paths.workspaceDir,
                model: {
                    primary: primaryModel,
                    fallbacks: fallbackModels,
                },
                ...(Object.keys(modelParams).length > 0
                    ? {
                          models: modelParams,
                      }
                    : {}),
            },
            list: [
                {
                    id: 'main',
                    default: true,
                    name: input.displayName,
                    workspace: input.paths.workspaceDir,
                    agentDir: `${input.paths.engineStateDir}/agents/main/agent`,
                    model: {
                        primary: primaryModel,
                        fallbacks: fallbackModels,
                    },
                    identity: {
                        name: input.displayName,
                        theme: 'focused operator',
                    },
                    tools: {
                        profile: input.roomConfiguration.toolsProfile,
                    },
                },
            ],
        },
        tools: {
            profile: input.roomConfiguration.toolsProfile,
        },
        models:
            Object.keys(providerModels).length > 0
                ? {
                      mode: 'merge',
                      providers: providerModels,
                  }
                : undefined,
        auth: isCodexProvider(provider)
            ? {
                  order: {
                      'openai-codex': ['openai-codex:default'],
                  },
              }
            : undefined,
        mcp: {
            servers: mcpServers,
        },
    }
}
