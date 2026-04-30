import { createInterface } from 'node:readline'

const rl = createInterface({
    input: process.stdin,
})

function send(payload: unknown): void {
    process.stdout.write(`${JSON.stringify(payload)}\n`)
}

rl.on('line', (line) => {
    const message = JSON.parse(line) as {
        id?: string | number
        method?: string
        params?: {
            name?: string
            arguments?: Record<string, unknown>
        }
    }

    if (message.method === 'notifications/initialized') {
        return
    }

    if (message.method === 'initialize') {
        send({
            jsonrpc: '2.0',
            id: message.id,
            result: {
                protocolVersion: '2024-11-05',
                capabilities: {
                    tools: {},
                },
                serverInfo: {
                    name: 'agent-room-smoke',
                    version: '1.0.0',
                },
            },
        })
        return
    }

    if (message.method === 'tools/list') {
        send({
            jsonrpc: '2.0',
            id: message.id,
            result: {
                tools: [
                    {
                        name: 'echo',
                        description: 'Echo text for Agent Room MCP smoke tests',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                text: {
                                    type: 'string',
                                },
                            },
                        },
                    },
                ],
            },
        })
        return
    }

    if (message.method === 'tools/call') {
        const text = String(message.params?.arguments?.text ?? '')
        send({
            jsonrpc: '2.0',
            id: message.id,
            result: {
                content: [
                    {
                        type: 'text',
                        text: `mcp-smoke:${text}`,
                    },
                ],
            },
        })
        return
    }

    send({
        jsonrpc: '2.0',
        id: message.id,
        error: {
            code: -32601,
            message: 'Method not found',
        },
    })
})
