import type { ConnectionStatus, McpAuthMode, McpTransport, ProviderApi } from '../domain/types'

export interface ConnectionValidationResult {
    status: ConnectionStatus
    message: string
}

export interface ProviderValidationInput {
    provider: string
    authMode: 'api_key' | 'oauth'
    api: ProviderApi
    baseUrl: string | null
    model: string
    apiKey: string | null
    timeoutMs?: number
}

export interface McpValidationInput {
    transport: McpTransport
    command: string | null
    args: string[]
    url: string | null
    headers: Record<string, string>
    authMode: McpAuthMode
    bearerToken: string | null
}

const maxValidationOutputBytes = 128000

export function boundedMessage(value: string): string {
    return value
        .replace(/[^\S\r\n]+/g, ' ')
        .trim()
        .slice(0, 600)
}

export function appendBoundedOutput(current: string, chunk: Buffer | string): string {
    const next = current + chunk.toString()
    if (Buffer.byteLength(next) <= maxValidationOutputBytes) {
        return next
    }
    return Buffer.from(next).subarray(0, maxValidationOutputBytes).toString('utf8')
}

export function sanitizeOutput(output: string, secrets: string[]): string {
    let sanitized = output
    for (const secret of [...new Set(secrets)].sort((left, right) => right.length - left.length)) {
        if (secret) {
            sanitized = sanitized.replaceAll(secret, '[redacted]')
        }
    }
    return boundedMessage(sanitized)
}

export function hasMcpInitializeResponse(output: string): boolean {
    for (const line of output.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed) {
            continue
        }
        try {
            const parsed = JSON.parse(trimmed) as {
                jsonrpc?: unknown
                id?: unknown
                result?: unknown
            }
            if (parsed.jsonrpc === '2.0' && parsed.id === 1 && parsed.result !== undefined) {
                return true
            }
        } catch {}
    }
    return false
}

export function buildMcpInitializeRequest(): string {
    return `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: {
                name: 'agent-room-validation',
                version: '0.0.0',
            },
        },
    })}\n`
}
