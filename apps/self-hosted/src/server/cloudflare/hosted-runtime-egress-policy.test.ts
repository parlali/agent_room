import { describe, expect, it } from 'vitest'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import { hostedRuntimeAllowedHosts } from './hosted-runtime-materialization'

function runtimeConfigWithMcp(url: string): PiRuntimeConfig {
    return {
        provider: {
            baseUrl: 'https://openrouter.ai/api/v1',
        },
        search: {
            enabled: false,
            backendUrl: '',
            brave: {
                enabled: false,
            },
            browserbase: {
                enabled: false,
            },
        },
        urlFetch: {
            mode: 'direct',
            proxyUrl: null,
            tokenEnvKey: null,
        },
        image: {
            enabled: false,
        },
        mcpServers: [
            {
                id: 'tenant-mcp',
                transport: 'http',
                url,
            },
        ],
    } as PiRuntimeConfig
}

describe('hosted runtime egress policy', () => {
    it('pins tenant MCP egress to resolved public addresses instead of hostname allowlists', async () => {
        await expect(
            hostedRuntimeAllowedHosts({
                runtimeConfig: runtimeConfigWithMcp('https://mcp.example.test/sse'),
                usageCallbackUrl: 'https://rooms.example.test/api/hosted/runtime/usage',
                resolveTenantHostnameAddresses: async (hostname) => {
                    expect(hostname).toBe('mcp.example.test')
                    return ['93.184.216.34']
                },
            }),
        ).resolves.toEqual(['93.184.216.34', 'openrouter.ai', 'rooms.example.test'])
    })

    it('rejects tenant MCP hosts that resolve to private network addresses', async () => {
        await expect(
            hostedRuntimeAllowedHosts({
                runtimeConfig: runtimeConfigWithMcp('https://mcp.example.test/sse'),
                usageCallbackUrl: 'https://rooms.example.test/api/hosted/runtime/usage',
                resolveTenantHostnameAddresses: async (hostname) => {
                    expect(hostname).toBe('mcp.example.test')
                    return ['10.0.0.8']
                },
            }),
        ).rejects.toThrow('resolves to a local or private network address')
    })

    it('allowlists the hosted Brave proxy origin when managed search is materialized', async () => {
        const runtimeConfig = runtimeConfigWithMcp('https://mcp.example.test/sse')
        runtimeConfig.search.enabled = true
        runtimeConfig.search.brave = {
            enabled: true,
            envKey: 'AGENT_ROOM_SEARCH_BRAVE_API_KEY',
            baseUrl:
                'https://rooms.example.test/api/hosted/runtime/provider/brave/v1/workspaces/workspace_1/rooms/room_1/res/v1/web/search',
            country: null,
            searchLang: null,
            safeSearch: 'moderate',
            timeoutMs: 10000,
            resultCount: 5,
        }

        const hosts = await hostedRuntimeAllowedHosts({
            runtimeConfig,
            usageCallbackUrl: 'https://rooms.example.test/api/hosted/runtime/usage',
            resolveTenantHostnameAddresses: async () => ['93.184.216.34'],
        })

        expect(hosts).toContain('rooms.example.test')
        expect(hosts).not.toContain('searxng')
        expect(hosts).not.toContain('api.search.brave.com')
    })

    it('allowlists managed fetch and managed Browserbase proxy origins without SearXNG', async () => {
        const runtimeConfig = runtimeConfigWithMcp('https://mcp.example.test/sse')
        runtimeConfig.search.enabled = true
        runtimeConfig.search.backendUrl = ''
        runtimeConfig.search.browserbase = {
            enabled: true,
            envKey: 'AGENT_ROOM_SEARCH_BROWSERBASE_API_KEY',
            baseUrl:
                'https://rooms.example.test/api/hosted/runtime/provider/browserbase/v1/workspaces/workspace_1/rooms/room_1',
            timeoutMs: 10000,
            resultCount: 5,
        }
        runtimeConfig.urlFetch = {
            mode: 'managed',
            proxyUrl:
                'https://rooms.example.test/api/hosted/runtime/fetch/workspaces/workspace_1/rooms/room_1',
            tokenEnvKey: 'AGENT_ROOM_HOSTED_USAGE_CALLBACK_TOKEN',
        }

        const hosts = await hostedRuntimeAllowedHosts({
            runtimeConfig,
            usageCallbackUrl: 'https://rooms.example.test/api/hosted/runtime/usage',
            resolveTenantHostnameAddresses: async () => ['93.184.216.34'],
        })

        expect(hosts).toContain('rooms.example.test')
        expect(hosts).toContain('connect.browserbase.com')
        expect(hosts).not.toContain('searxng')
        expect(hosts).not.toContain('api.browserbase.com')
    })
})
