import { describe, expect, it } from 'vitest'
import type { OpenClawRuntimeConfig } from '../domain/types'
import { openClawRuntimeEngineProfile } from './openclaw-runtime-engine-profile'

const roomPaths = {
    roomRootDir: '/data/rooms/room-1',
    runtimeDir: '/data/rooms/room-1/runtime',
    runtimeLogsDir: '/data/rooms/room-1/runtime/logs',
    runtimeSecretsDir: '/data/rooms/room-1/runtime/secrets',
    engineStateDir: '/data/rooms/room-1/openclaw-state',
    workspaceDir: '/data/rooms/room-1/workspace',
    storeDir: '/data/rooms/room-1/store',
    storeBlobsDir: '/data/rooms/room-1/store/blobs',
    storeManifestsDir: '/data/rooms/room-1/store/manifests',
    storeExportsDir: '/data/rooms/room-1/store/exports',
    runtimeConfigPath: '/data/rooms/room-1/runtime/openclaw.config.json',
    runtimeEnvPath: '/data/rooms/room-1/runtime/openclaw.env',
    runtimeLogPath: '/data/rooms/room-1/runtime/logs/openclaw.log',
    runtimeMetadataPath: '/data/rooms/room-1/runtime/runtime.json',
    runtimeHealthPath: '/data/rooms/room-1/runtime/health.json',
    runtimeTokenPath: '/data/rooms/room-1/runtime/token',
}

describe('openclaw runtime engine profile', () => {
    it('uses the foreground gateway runtime command', () => {
        expect(openClawRuntimeEngineProfile.resolveCommand()).toEqual({
            command: 'openclaw',
            args: ['gateway', 'run'],
        })
    })

    it('builds a config that matches the local per-room gateway contract', () => {
        const profile = openClawRuntimeEngineProfile.buildRuntimeProfile({
            roomId: 'room-1',
            displayName: 'Market Watch',
            port: 19123,
            token: 'room-token',
            paths: roomPaths,
            roomConfiguration: {
                instructions: 'Track market structure.',
                toolsProfile: 'coding',
                provider: {
                    provider: 'anthropic',
                    authMode: 'api_key',
                    api: 'anthropic-messages',
                    model: 'anthropic/claude-opus-4-6',
                    fallbackModels: [],
                    baseUrl: null,
                    envKey: 'ANTHROPIC_API_KEY',
                },
                entitlements: {
                    env: {
                        ANTHROPIC_API_KEY: 'sk-secret',
                    },
                    secretRefs: [],
                    mcpServers: [
                        {
                            id: 'prices',
                            provider: 'demo',
                            allowedTools: ['search'],
                            transport: 'stdio',
                            command: 'uvx',
                            args: ['prices-server'],
                            url: null,
                            env: {
                                MCP_AUTH_TOKEN: 'secret',
                            },
                            headers: {},
                        },
                    ],
                },
            },
        })

        expect(profile.config).toEqual({
            env: {
                shellEnv: {
                    enabled: false,
                },
            },
            gateway: {
                mode: 'local',
                bind: 'loopback',
                port: 19123,
                controlUi: {
                    enabled: false,
                },
                auth: {
                    mode: 'token',
                },
            },
            agents: {
                defaults: {
                    workspace: '/data/rooms/room-1/workspace',
                    model: {
                        primary: 'anthropic/claude-opus-4-6',
                        fallbacks: [],
                    },
                },
                list: [
                    {
                        id: 'main',
                        default: true,
                        name: 'Market Watch',
                        workspace: '/data/rooms/room-1/workspace',
                        agentDir: '/data/rooms/room-1/openclaw-state/agents/main/agent',
                        model: {
                            primary: 'anthropic/claude-opus-4-6',
                            fallbacks: [],
                        },
                        identity: {
                            name: 'Market Watch',
                            theme: 'focused operator',
                        },
                        tools: {
                            profile: 'coding',
                        },
                    },
                ],
            },
            tools: {
                profile: 'coding',
            },
            models: {
                mode: 'merge',
                providers: {
                    anthropic: {
                        api: 'anthropic-messages',
                        apiKey: 'ANTHROPIC_API_KEY',
                        models: [
                            {
                                id: 'claude-opus-4-6',
                                name: 'anthropic/claude-opus-4-6',
                            },
                        ],
                    },
                },
            },
            auth: undefined,
            mcp: {
                servers: {
                    prices: {
                        command: 'uvx',
                        args: ['prices-server'],
                        env: {
                            MCP_AUTH_TOKEN: 'secret',
                        },
                    },
                },
            },
        })

        expect(profile.env).toMatchObject({
            OPENCLAW_CONFIG_PATH: '/data/rooms/room-1/runtime/openclaw.config.json',
            OPENCLAW_GATEWAY_TOKEN: 'room-token',
            OPENCLAW_STATE_DIR: '/data/rooms/room-1/openclaw-state',
            OPENCLAW_STORE_DIR: '/data/rooms/room-1/store',
            OPENCLAW_WORKSPACE_DIR: '/data/rooms/room-1/workspace',
            ANTHROPIC_API_KEY: 'sk-secret',
        })
    })

    it('materializes OpenAI Codex OAuth with ChatGPT backend and WebSocket transport', () => {
        const profile = openClawRuntimeEngineProfile.buildRuntimeProfile({
            roomId: 'room-1',
            displayName: 'Codex Room',
            port: 19123,
            token: 'room-token',
            paths: roomPaths,
            roomConfiguration: {
                instructions: 'Operate through Codex.',
                toolsProfile: 'coding',
                provider: {
                    provider: 'openai-codex',
                    authMode: 'oauth',
                    api: 'openai-codex-responses',
                    model: 'openai-codex/gpt-5.4',
                    fallbackModels: ['openai-codex/gpt-5.3-codex-spark'],
                    baseUrl: 'https://chatgpt.com/backend-api',
                    envKey: null,
                },
                entitlements: {
                    env: {},
                    secretRefs: [],
                    mcpServers: [],
                },
            },
        })

        const config = profile.config as OpenClawRuntimeConfig

        expect(config.agents.defaults.models).toEqual({
            'openai-codex/gpt-5.4': {
                params: {
                    transport: 'websocket',
                },
            },
            'openai-codex/gpt-5.3-codex-spark': {
                params: {
                    transport: 'websocket',
                },
            },
        })
        expect(config.models).toEqual({
            mode: 'merge',
            providers: {
                'openai-codex': {
                    baseUrl: 'https://chatgpt.com/backend-api',
                    api: 'openai-codex-responses',
                    models: [
                        {
                            id: 'gpt-5.4',
                            name: 'openai-codex/gpt-5.4',
                            contextTokens: 272000,
                        },
                        {
                            id: 'gpt-5.3-codex-spark',
                            name: 'openai-codex/gpt-5.3-codex-spark',
                            contextTokens: 272000,
                        },
                    ],
                },
            },
        })
        expect(config.auth).toEqual({
            order: {
                'openai-codex': ['openai-codex:default'],
            },
        })
        expect(profile.env).not.toHaveProperty('OPENAI_CODEX_API_KEY')
    })
})
