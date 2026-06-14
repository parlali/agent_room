import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { defineTool, type ToolDefinition } from '@mariozechner/pi-coding-agent'
import { Type } from '@mariozechner/pi-ai'
import type { MaterializedMcpServer } from '#/domain/domain-types'
import { buildBoundedProcessEnv, disableImplicitEnvFileForCommand } from '../security/process-env'
import { boundTextByUtf8Bytes } from './bounded-text'
import { combineAbortSignals, currentToolRunSignal } from './tool-run-context'
import { assertSafeUrl } from './web-url-safety'

interface ConnectedMcpServer {
    server: MaterializedMcpServer
    client: Client
    transport: {
        close: () => Promise<void>
    }
    redactions: string[]
}

const connectedServers: ConnectedMcpServer[] = []
const maxMcpOutputBytes = 128000

function toolName(input: { serverId: string; toolName: string }): string {
    return `mcp_${input.serverId}_${input.toolName}`
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 96)
}

function redact(value: string, secrets: string[]): string {
    let output = value
    for (const secret of secrets) {
        if (secret.trim()) {
            output = output.replaceAll(secret, '[redacted]')
        }
    }
    return output
}

function resultToText(value: unknown): string {
    if (!value || typeof value !== 'object') {
        return String(value ?? '')
    }
    const result = value as {
        content?: Array<{ type?: string; text?: string }>
        structuredContent?: unknown
    }
    const text = result.content
        ?.map((entry) =>
            entry.type === 'text' && typeof entry.text === 'string' ? entry.text : null,
        )
        .filter((entry): entry is string => entry !== null)
        .join('\n')
    if (text !== undefined) {
        return text
    }
    if (result.structuredContent !== undefined) {
        return JSON.stringify(result.structuredContent)
    }
    return JSON.stringify(value)
}

function jsonSchemaToParameters(schema: unknown) {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
        return Type.Object({})
    }
    const record = schema as Record<string, unknown>
    if (record.type !== undefined && record.type !== 'object') {
        throw new Error('MCP tool input schema must be an object schema')
    }
    return Type.Unsafe(record)
}

function serverRedactions(server: MaterializedMcpServer): string[] {
    const values: string[] = []
    for (const value of [...Object.values(server.env), ...Object.values(server.headers)]) {
        values.push(value)
        const bearerMatch = value.match(/^Bearer\s+(.+)$/i)
        if (bearerMatch) {
            values.push(bearerMatch[1]!)
        }
    }
    return [...new Set(values.filter((value) => value.trim().length > 0))].sort(
        (left, right) => right.length - left.length,
    )
}

function stdioEnvironment(env: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
        Object.entries(buildBoundedProcessEnv(env)).filter(
            (entry): entry is [string, string] => entry[1] !== undefined,
        ),
    )
}

async function resolveHttpServerUrl(input: {
    server: MaterializedMcpServer
    restrictPrivateNetwork: boolean
}): Promise<URL> {
    const url = new URL(input.server.url ?? '')
    if (input.restrictPrivateNetwork) {
        await assertSafeUrl(url)
    }
    return url
}

async function connectServer(input: {
    server: MaterializedMcpServer
    cwd: string
    restrictPrivateNetwork: boolean
}): Promise<ConnectedMcpServer> {
    const client = new Client(
        {
            name: 'agent-room',
            version: '0.0.0',
        },
        {
            capabilities: {},
        },
    )
    const transport =
        input.server.transport === 'stdio'
            ? new StdioClientTransport({
                  command: input.server.command ?? '',
                  args: disableImplicitEnvFileForCommand(
                      input.server.command ?? '',
                      input.server.args,
                  ),
                  cwd: input.cwd,
                  env: stdioEnvironment(input.server.env),
                  stderr: 'pipe',
              })
            : new StreamableHTTPClientTransport(
                  await resolveHttpServerUrl({
                      server: input.server,
                      restrictPrivateNetwork: input.restrictPrivateNetwork,
                  }),
                  {
                      requestInit: {
                          headers: input.server.headers,
                      },
                  },
              )

    try {
        await client.connect(transport, {
            timeout: 10000,
        })
    } catch (error) {
        try {
            await transport.close()
        } catch {}
        throw error
    }

    const connected: ConnectedMcpServer = {
        server: input.server,
        client,
        transport,
        redactions: serverRedactions(input.server),
    }
    connectedServers.push(connected)
    return connected
}

async function closeConnectedServer(server: ConnectedMcpServer): Promise<void> {
    try {
        await server.client.close()
    } catch {}
    try {
        await server.transport.close()
    } catch {}
}

function createMcpTool(input: {
    connected: ConnectedMcpServer
    sourceName: string
    exposedName: string
    description: string
    inputSchema: unknown
}): ToolDefinition {
    return defineTool({
        name: input.exposedName,
        label: input.sourceName,
        description: input.description,
        parameters: jsonSchemaToParameters(input.inputSchema),
        execute: async (_toolCallId, params, signal) => {
            const combined = combineAbortSignals([signal, currentToolRunSignal()])
            try {
                const result = await input.connected.client.callTool(
                    {
                        name: input.sourceName,
                        arguments:
                            params && typeof params === 'object' && !Array.isArray(params)
                                ? (params as Record<string, unknown>)
                                : {},
                    },
                    undefined,
                    {
                        signal: combined.signal,
                        timeout: 60000,
                    },
                )
                const bounded = boundTextByUtf8Bytes(
                    redact(resultToText(result), input.connected.redactions),
                    maxMcpOutputBytes,
                )
                return {
                    content: [
                        {
                            type: 'text',
                            text: bounded.text,
                        },
                    ],
                    details: {
                        serverId: input.connected.server.id,
                        toolName: input.sourceName,
                        outputTruncated: bounded.truncated,
                    },
                }
            } catch (error) {
                const message = redact(
                    error instanceof Error ? error.message : 'MCP tool call failed',
                    input.connected.redactions,
                )
                throw new Error(message)
            } finally {
                combined.dispose()
            }
        },
    })
}

export async function createMcpTools(input: {
    servers: MaterializedMcpServer[]
    cwd: string
    restrictPrivateNetwork?: boolean
}): Promise<ToolDefinition[]> {
    const tools: ToolDefinition[] = []
    const exposedNames = new Set<string>()
    for (const server of input.servers) {
        const connected = await connectServer({
            server,
            cwd: input.cwd,
            restrictPrivateNetwork: input.restrictPrivateNetwork ?? false,
        })
        try {
            const listed = await connected.client.listTools(
                {},
                {
                    timeout: 10000,
                },
            )
            for (const tool of listed.tools) {
                if (server.allowedTools.length > 0 && !server.allowedTools.includes(tool.name)) {
                    continue
                }
                const exposedName = toolName({
                    serverId: server.id,
                    toolName: tool.name,
                })
                if (exposedNames.has(exposedName)) {
                    throw new Error(`MCP tool name collision for ${exposedName}`)
                }
                exposedNames.add(exposedName)
                tools.push(
                    createMcpTool({
                        connected,
                        sourceName: tool.name,
                        exposedName,
                        description:
                            tool.description ??
                            `Call MCP tool ${tool.name} from configured server ${server.id}`,
                        inputSchema: tool.inputSchema,
                    }),
                )
            }
        } catch (error) {
            await closeConnectedServer(connected)
            throw error
        }
    }
    return tools
}

export async function closeMcpConnections(): Promise<void> {
    const servers = connectedServers.splice(0)
    await Promise.all(servers.map((server) => closeConnectedServer(server)))
}
