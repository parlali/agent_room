import { describe, expect, it } from 'vitest'
import { validateMcpConnection, validateProviderConnection } from './connection-validation'

describe('connection validation', () => {
    it('marks OAuth provider config ready without requiring an API key probe', async () => {
        await expect(
            validateProviderConnection({
                provider: 'openai-codex',
                authMode: 'oauth',
                api: 'openai-codex-responses',
                baseUrl: null,
                model: 'openai-codex/gpt-5.4',
                apiKey: null,
            }),
        ).resolves.toEqual({
            status: 'ready',
            message:
                'OAuth provider config saved; each room must complete provider auth in its own runtime',
        })
    })

    it('accepts long-lived MCP stdio servers after initialize response', async () => {
        await expect(
            validateMcpConnection({
                transport: 'stdio',
                command: 'sh',
                args: [
                    '-c',
                    'read line; printf "%s\\n" "{\\"jsonrpc\\":\\"2.0\\",\\"id\\":1,\\"result\\":{}}"; sleep 30',
                ],
                url: null,
                headers: {},
                authMode: 'none',
                bearerToken: null,
            }),
        ).resolves.toEqual({
            status: 'ready',
            message: 'MCP stdio initialize completed',
        })
    })
})
