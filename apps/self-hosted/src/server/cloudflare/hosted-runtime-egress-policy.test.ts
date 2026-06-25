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
            brave: {
                enabled: false,
            },
            browserbase: {
                enabled: false,
            },
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
})
