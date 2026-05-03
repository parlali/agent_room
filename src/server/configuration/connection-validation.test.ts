import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { validateMcpConnection, validateProviderConnection } from './connection-validation'

type FakeProviderMode = 'ok' | 'bad-key' | 'bad-model' | 'quota' | 'malformed' | 'timeout'

function readBody(request: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let body = ''
        request.on('data', (chunk) => {
            body += String(chunk)
        })
        request.on('end', () => resolve(body))
        request.on('error', reject)
    })
}

async function withFakeOpenAiProvider<T>(
    mode: FakeProviderMode,
    fn: (baseUrl: string) => Promise<T>,
): Promise<T> {
    const requests: unknown[] = []
    const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
        const body = await readBody(request)
        try {
            requests.push(body ? JSON.parse(body) : null)
        } catch {
            requests.push(body)
        }

        if (mode === 'timeout') {
            return
        }

        if (mode === 'bad-key') {
            response.writeHead(401, { 'content-type': 'application/json' })
            response.end(JSON.stringify({ error: { message: 'invalid api key' } }))
            return
        }

        if (mode === 'quota') {
            response.writeHead(429, { 'content-type': 'application/json' })
            response.end(JSON.stringify({ error: { message: 'quota exceeded' } }))
            return
        }

        const latest = requests.at(-1) as { model?: string } | null
        if (mode === 'bad-model' || latest?.model === 'missing-model') {
            response.writeHead(404, { 'content-type': 'application/json' })
            response.end(JSON.stringify({ error: { message: 'model not found' } }))
            return
        }

        if (mode === 'malformed') {
            response.writeHead(200, { 'content-type': 'text/event-stream' })
            response.end('data: {"not":"a chat completion"}\n\ndata: [DONE]\n\n')
            return
        }

        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.write(
            `data: ${JSON.stringify({
                id: 'chatcmpl-test',
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: latest?.model ?? 'test-model',
                choices: [
                    {
                        index: 0,
                        delta: {
                            role: 'assistant',
                            content: 'ok',
                        },
                        finish_reason: null,
                    },
                ],
            })}\n\n`,
        )
        response.write(
            `data: ${JSON.stringify({
                id: 'chatcmpl-test',
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: latest?.model ?? 'test-model',
                choices: [
                    {
                        index: 0,
                        delta: {},
                        finish_reason: 'stop',
                    },
                ],
            })}\n\n`,
        )
        response.end('data: [DONE]\n\n')
    })

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    try {
        return await fn(`http://127.0.0.1:${port}/v1`)
    } finally {
        await new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()))
        })
    }
}

async function withHttpServer<T>(
    handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>,
    fn: (url: string) => Promise<T>,
): Promise<T> {
    const server = createServer(handler)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    try {
        return await fn(`http://127.0.0.1:${port}/mcp`)
    } finally {
        await new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()))
        })
    }
}

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

    it('does not pass app process secrets to MCP stdio validation commands', async () => {
        const previousDatabaseUrl = process.env.DATABASE_URL
        process.env.DATABASE_URL = 'postgres://secret-validation-value'
        try {
            await expect(
                validateMcpConnection({
                    transport: 'stdio',
                    command: 'sh',
                    args: [
                        '-c',
                        'if [ -n "$DATABASE_URL" ]; then exit 42; fi; read line; printf "%s\\n" "{\\"jsonrpc\\":\\"2.0\\",\\"id\\":1,\\"result\\":{}}"; sleep 1',
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
        } finally {
            if (previousDatabaseUrl === undefined) {
                delete process.env.DATABASE_URL
            } else {
                process.env.DATABASE_URL = previousDatabaseUrl
            }
        }
    })

    it('disables Bun dotenv loading for MCP stdio validation commands', async () => {
        await expect(
            validateMcpConnection({
                transport: 'stdio',
                command: 'bun',
                args: [
                    '-e',
                    'if (process.env.DATABASE_URL) process.exit(42); await new Response(Bun.stdin.stream()).text(); process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:1,result:{}}) + "\\n")',
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

    it('requires HTTP MCP initialize responses to contain a JSON-RPC result', async () => {
        await withHttpServer(
            (_request, response) => {
                response.writeHead(200, {
                    'content-type': 'application/json',
                })
                response.end(JSON.stringify({ ok: true }))
            },
            async (url) => {
                await expect(
                    validateMcpConnection({
                        transport: 'http',
                        command: null,
                        args: [],
                        url,
                        headers: {},
                        authMode: 'none',
                        bearerToken: null,
                    }),
                ).resolves.toEqual({
                    status: 'invalid',
                    message: 'MCP HTTP initialize returned no JSON-RPC result',
                })
            },
        )
    })

    it('accepts HTTP MCP initialize responses with a JSON-RPC result', async () => {
        await withHttpServer(
            (_request, response) => {
                response.writeHead(200, {
                    'content-type': 'application/json',
                })
                response.end(
                    JSON.stringify({
                        jsonrpc: '2.0',
                        id: 1,
                        result: {},
                    }),
                )
            },
            async (url) => {
                await expect(
                    validateMcpConnection({
                        transport: 'http',
                        command: null,
                        args: [],
                        url,
                        headers: {},
                        authMode: 'none',
                        bearerToken: null,
                    }),
                ).resolves.toEqual({
                    status: 'ready',
                    message: 'MCP HTTP initialize completed',
                })
            },
        )
    })

    it('validates successful OpenAI-compatible probes through Pi', async () => {
        await withFakeOpenAiProvider('ok', async (baseUrl) => {
            await expect(
                validateProviderConnection({
                    provider: 'ollama',
                    authMode: 'api_key',
                    api: 'openai-completions',
                    baseUrl,
                    model: 'ollama/test-model',
                    apiKey: null,
                    timeoutMs: 5000,
                }),
            ).resolves.toEqual({
                status: 'ready',
                message: 'Provider probe completed through Pi',
            })
        })
    })

    it.each([
        {
            provider: 'openrouter',
            model: 'openrouter/auto',
            apiKey: 'openrouter-test-key',
        },
        {
            provider: 'ollama',
            model: 'ollama/test-model',
            apiKey: null,
        },
        {
            provider: 'lmstudio',
            model: 'lmstudio/test-model',
            apiKey: null,
        },
    ] as const)(
        'smokes the supported provider matrix entry $provider through Pi',
        async (entry) => {
            await withFakeOpenAiProvider('ok', async (baseUrl) => {
                await expect(
                    validateProviderConnection({
                        provider: entry.provider,
                        authMode: 'api_key',
                        api: 'openai-completions',
                        baseUrl,
                        model: entry.model,
                        apiKey: entry.apiKey,
                        timeoutMs: 5000,
                    }),
                ).resolves.toEqual({
                    status: 'ready',
                    message: 'Provider probe completed through Pi',
                })
            })
        },
    )

    it.each([
        ['bad-key', 'invalid api key'],
        ['bad-model', 'model not found'],
        ['quota', 'quota exceeded'],
        ['malformed', 'no assistant text'],
    ] as const)('surfaces %s provider failures from the Pi probe', async (mode, expected) => {
        await withFakeOpenAiProvider(mode, async (baseUrl) => {
            const result = await validateProviderConnection({
                provider: 'ollama',
                authMode: 'api_key',
                api: 'openai-completions',
                baseUrl,
                model: mode === 'bad-model' ? 'ollama/missing-model' : 'ollama/test-model',
                apiKey: null,
                timeoutMs: 5000,
            })

            expect(result.status).toBe('invalid')
            expect(result.message.toLowerCase()).toContain(expected)
        })
    })

    it('bounds provider probe timeouts', async () => {
        await withFakeOpenAiProvider('timeout', async (baseUrl) => {
            const result = await validateProviderConnection({
                provider: 'ollama',
                authMode: 'api_key',
                api: 'openai-completions',
                baseUrl,
                model: 'ollama/test-model',
                apiKey: null,
                timeoutMs: 30,
            })

            expect(result.status).toBe('invalid')
            expect(result.message.toLowerCase()).toContain('timed out')
        })
    })

    it('fails closed for unreachable local endpoints and provider/model mismatch', async () => {
        const unreachable = await validateProviderConnection({
            provider: 'ollama',
            authMode: 'api_key',
            api: 'openai-completions',
            baseUrl: 'http://127.0.0.1:9/v1',
            model: 'ollama/test-model',
            apiKey: null,
            timeoutMs: 500,
        })

        expect(unreachable.status).toBe('invalid')
        expect(unreachable.message.toLowerCase()).toMatch(/fetch|connect|refused|failed/)

        const mismatch = await validateProviderConnection({
            provider: 'ollama',
            authMode: 'api_key',
            api: 'openai-completions',
            baseUrl: 'http://127.0.0.1:1/v1',
            model: 'openrouter/auto',
            apiKey: null,
        })

        expect(mismatch.status).toBe('invalid')
        expect(mismatch.message).toContain('does not belong to provider ollama')
    })
})
