import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import type { MaterializedMcpServer } from '../domain/types'
import { closeMcpConnections, createMcpTools } from './mcp-bridge'

const STDIO_SERVER = `
import { createInterface } from 'node:readline'

const mode = process.argv[2] ?? 'success'
const secret = process.env.MCP_AUTH_TOKEN ?? ''
const rl = createInterface({ input: process.stdin })

function send(message) {
    process.stdout.write(JSON.stringify(message) + '\\n')
}

function tools() {
    if (mode === 'bad-schema') {
        return [
            {
                name: 'bad',
                description: 'Bad schema',
                inputSchema: { type: 'string' },
            },
        ]
    }
    return [
        {
            name: 'echo',
            description: 'Echo text',
            inputSchema: {
                type: 'object',
                properties: {
                    text: { type: 'string' },
                },
            },
        },
        {
            name: 'secret_echo',
            description: 'Echo secret',
            inputSchema: {
                type: 'object',
                properties: {},
            },
        },
        {
            name: 'env_echo',
            description: 'Echo ambient env',
            inputSchema: {
                type: 'object',
                properties: {},
            },
        },
    ]
}

rl.on('line', (line) => {
    const message = JSON.parse(line)
    if (message.method === 'notifications/initialized') {
        return
    }
    if (message.method === 'initialize') {
        send({
            jsonrpc: '2.0',
            id: message.id,
            result: {
                protocolVersion: '2024-11-05',
                capabilities: { tools: {} },
                serverInfo: { name: 'fake', version: '1.0.0' },
            },
        })
        return
    }
    if (message.method === 'tools/list') {
        send({
            jsonrpc: '2.0',
            id: message.id,
            result: { tools: tools() },
        })
        return
    }
    if (message.method === 'tools/call') {
        const name = message.params.name
        const text =
            mode === 'large'
                ? 'x'.repeat(140000)
                : name === 'secret_echo'
                  ? secret
                  : name === 'env_echo'
                    ? String(process.env.DATABASE_URL ?? '')
                  : String(message.params.arguments?.text ?? '')
        send({
            jsonrpc: '2.0',
            id: message.id,
            result: {
                content: [{ type: 'text', text }],
            },
        })
        return
    }
})
`

function baseServer(input: Partial<MaterializedMcpServer>): MaterializedMcpServer {
    return {
        id: input.id ?? 'fake',
        provider: input.provider ?? 'Fake',
        allowedTools: input.allowedTools ?? [],
        transport: input.transport ?? 'stdio',
        command: input.command ?? null,
        args: input.args ?? [],
        url: input.url ?? null,
        env: input.env ?? {},
        headers: input.headers ?? {},
    }
}

async function withStdioScript<T>(fn: (path: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), 'agent-room-mcp-'))
    const path = join(dir, 'server.ts')
    await writeFile(path, STDIO_SERVER, 'utf8')
    try {
        return await fn(path)
    } finally {
        await rm(dir, {
            recursive: true,
            force: true,
        })
    }
}

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

function sendRpc(response: ServerResponse, payload: unknown): void {
    response.writeHead(200, {
        'content-type': 'application/json',
    })
    response.end(JSON.stringify(payload))
}

async function withHttpMcp<T>(fn: (url: string) => Promise<T>): Promise<T> {
    const server = createServer(async (request, response) => {
        if (request.method === 'DELETE') {
            response.writeHead(200)
            response.end()
            return
        }
        if (request.headers.authorization !== 'Bearer test-token') {
            response.writeHead(401)
            response.end('missing auth')
            return
        }
        const rawBody = await readBody(request)
        if (!rawBody.trim()) {
            response.writeHead(202)
            response.end()
            return
        }
        const body = JSON.parse(rawBody) as { id?: string | number; method?: string }
        if (body.method === 'initialize') {
            sendRpc(response, {
                jsonrpc: '2.0',
                id: body.id,
                result: {
                    protocolVersion: '2024-11-05',
                    capabilities: { tools: {} },
                    serverInfo: { name: 'http-fake', version: '1.0.0' },
                },
            })
            return
        }
        if (body.method === 'notifications/initialized') {
            response.writeHead(202)
            response.end()
            return
        }
        if (body.method === 'tools/list') {
            sendRpc(response, {
                jsonrpc: '2.0',
                id: body.id,
                result: {
                    tools: [
                        {
                            name: 'ping',
                            description: 'Ping',
                            inputSchema: { type: 'object', properties: {} },
                        },
                    ],
                },
            })
            return
        }
        if (body.method === 'tools/call') {
            sendRpc(response, {
                jsonrpc: '2.0',
                id: body.id,
                result: {
                    content: [{ type: 'text', text: 'pong' }],
                },
            })
            return
        }
        response.writeHead(404)
        response.end()
    })

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

async function executeTool(
    tool: Awaited<ReturnType<typeof createMcpTools>>[number],
    input: object,
) {
    return tool.execute('call-1', input as never, undefined, undefined, {} as never)
}

function resultText(result: Awaited<ReturnType<typeof executeTool>>): string {
    const part = result.content[0]
    return part && 'text' in part && typeof part.text === 'string' ? part.text : ''
}

afterEach(async () => {
    await closeMcpConnections()
})

describe('Agent Room MCP bridge', () => {
    it('connects stdio servers, exposes allowed tools, and denies unlisted tools', async () => {
        await withStdioScript(async (path) => {
            const tools = await createMcpTools({
                cwd: process.cwd(),
                servers: [
                    baseServer({
                        id: 'stdio',
                        allowedTools: ['echo'],
                        command: 'bun',
                        args: [path, 'success'],
                    }),
                ],
            })

            expect(tools.map((tool) => tool.name)).toEqual(['mcp_stdio_echo'])
            await expect(executeTool(tools[0]!, { text: 'hello' })).resolves.toMatchObject({
                details: {
                    serverId: 'stdio',
                    toolName: 'echo',
                },
            })
        })
    })

    it('fails closed when stdio startup or schema conversion fails', async () => {
        await expect(
            createMcpTools({
                cwd: process.cwd(),
                servers: [
                    baseServer({
                        id: 'bad',
                        command: 'bun',
                        args: ['missing-file.ts'],
                    }),
                ],
            }),
        ).rejects.toThrow()

        await withStdioScript(async (path) => {
            await expect(
                createMcpTools({
                    cwd: process.cwd(),
                    servers: [
                        baseServer({
                            id: 'schema',
                            command: 'bun',
                            args: [path, 'bad-schema'],
                        }),
                    ],
                }),
            ).rejects.toThrow(/Invalid input|object schema/)
        })
    })

    it('connects streamable HTTP with explicit auth headers', async () => {
        await withHttpMcp(async (url) => {
            const tools = await createMcpTools({
                cwd: process.cwd(),
                servers: [
                    baseServer({
                        id: 'http',
                        transport: 'streamable_http',
                        url,
                        headers: {
                            Authorization: 'Bearer test-token',
                        },
                    }),
                ],
            })

            expect(tools.map((tool) => tool.name)).toEqual(['mcp_http_ping'])
            const result = await executeTool(tools[0]!, {})
            expect(resultText(result)).toBe('pong')
            await closeMcpConnections()
        })
    })

    it('redacts MCP secrets from tool outputs', async () => {
        await withStdioScript(async (path) => {
            const tools = await createMcpTools({
                cwd: process.cwd(),
                servers: [
                    baseServer({
                        id: 'redact',
                        allowedTools: ['secret_echo'],
                        command: 'bun',
                        args: [path, 'success'],
                        env: {
                            MCP_AUTH_TOKEN: 'super-secret-token',
                        },
                    }),
                ],
            })

            const result = await executeTool(tools[0]!, {})
            expect(resultText(result)).toBe('[redacted]')
        })
    })

    it('does not pass app process secrets to stdio MCP servers', async () => {
        const previousDatabaseUrl = process.env.DATABASE_URL
        process.env.DATABASE_URL = 'postgres://mcp-bridge-secret'
        try {
            await withStdioScript(async (path) => {
                const tools = await createMcpTools({
                    cwd: process.cwd(),
                    servers: [
                        baseServer({
                            id: 'env',
                            allowedTools: ['env_echo'],
                            command: 'bun',
                            args: [path, 'success'],
                        }),
                    ],
                })

                const result = await executeTool(tools[0]!, {})
                expect(resultText(result)).toBe('')
            })
        } finally {
            if (previousDatabaseUrl === undefined) {
                delete process.env.DATABASE_URL
            } else {
                process.env.DATABASE_URL = previousDatabaseUrl
            }
        }
    })

    it('bounds MCP tool output and fails closed on exposed-name collisions', async () => {
        await withStdioScript(async (path) => {
            const tools = await createMcpTools({
                cwd: process.cwd(),
                servers: [
                    baseServer({
                        id: 'large',
                        allowedTools: ['echo'],
                        command: 'bun',
                        args: [path, 'large'],
                    }),
                ],
            })

            const result = await executeTool(tools[0]!, { text: 'ignored' })
            expect(Buffer.byteLength(resultText(result))).toBeLessThanOrEqual(128000)
            expect(result).toMatchObject({
                details: {
                    outputTruncated: true,
                },
            })
            await closeMcpConnections()

            await expect(
                createMcpTools({
                    cwd: process.cwd(),
                    servers: [
                        baseServer({
                            id: 'a b',
                            allowedTools: ['echo'],
                            command: 'bun',
                            args: [path, 'success'],
                        }),
                        baseServer({
                            id: 'a_b',
                            allowedTools: ['echo'],
                            command: 'bun',
                            args: [path, 'success'],
                        }),
                    ],
                }),
            ).rejects.toThrow(/collision/)
        })
    })
})
