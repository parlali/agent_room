import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ConnectionStatus, McpAuthMode, McpTransport, ProviderApi } from '../domain/types'
import { providerEnvKey, resolveProviderBaseUrl } from './provider-config'

export interface ConnectionValidationResult {
    status: ConnectionStatus
    message: string
}

interface ProviderValidationInput {
    provider: string
    authMode: 'api_key' | 'oauth'
    api: ProviderApi
    baseUrl: string | null
    model: string
    apiKey: string | null
}

interface McpValidationInput {
    transport: McpTransport
    command: string | null
    args: string[]
    url: string | null
    headers: Record<string, string>
    authMode: McpAuthMode
    bearerToken: string | null
}

function boundedMessage(value: string): string {
    return value
        .replace(/[^\S\r\n]+/g, ' ')
        .trim()
        .slice(0, 600)
}

function sanitizeOutput(output: string, secrets: string[]): string {
    let sanitized = output
    for (const secret of secrets) {
        if (secret) {
            sanitized = sanitized.replaceAll(secret, '[redacted]')
        }
    }
    return boundedMessage(sanitized)
}

function runCommand(input: {
    command: string
    args: string[]
    env: Record<string, string>
    timeoutMs: number
    input?: string
    secrets?: string[]
}): Promise<{
    exitCode: number | null
    stdout: string
    stderr: string
    timedOut: boolean
}> {
    return new Promise((resolve) => {
        const child = spawn(input.command, input.args, {
            env: {
                ...process.env,
                ...input.env,
            },
            stdio: 'pipe',
        })

        let stdout = ''
        let stderr = ''
        let timedOut = false

        const timeout = setTimeout(() => {
            timedOut = true
            child.kill('SIGTERM')
        }, input.timeoutMs)

        child.stdout.on('data', (chunk) => {
            stdout += String(chunk)
        })
        child.stderr.on('data', (chunk) => {
            stderr += String(chunk)
        })
        child.on('error', (error) => {
            clearTimeout(timeout)
            resolve({
                exitCode: null,
                stdout,
                stderr: error.message,
                timedOut,
            })
        })
        child.on('exit', (exitCode) => {
            clearTimeout(timeout)
            resolve({
                exitCode,
                stdout: sanitizeOutput(stdout, input.secrets ?? []),
                stderr: sanitizeOutput(stderr, input.secrets ?? []),
                timedOut,
            })
        })

        if (input.input) {
            child.stdin.write(input.input)
        }
        child.stdin.end()
    })
}

function runMcpStdioInitialize(input: {
    command: string
    args: string[]
    env: Record<string, string>
    timeoutMs: number
    secrets?: string[]
}): Promise<{
    initialized: boolean
    exitCode: number | null
    stdout: string
    stderr: string
    timedOut: boolean
}> {
    return new Promise((resolve) => {
        const child = spawn(input.command, input.args, {
            env: {
                ...process.env,
                ...input.env,
            },
            stdio: 'pipe',
        })

        let stdout = ''
        let stderr = ''
        let timedOut = false
        let settled = false

        const finish = (result: {
            initialized: boolean
            exitCode: number | null
            timedOut: boolean
        }) => {
            if (settled) {
                return
            }
            settled = true
            clearTimeout(timeout)
            resolve({
                initialized: result.initialized,
                exitCode: result.exitCode,
                stdout: sanitizeOutput(stdout, input.secrets ?? []),
                stderr: sanitizeOutput(stderr, input.secrets ?? []),
                timedOut: result.timedOut,
            })
        }

        const timeout = setTimeout(() => {
            timedOut = true
            child.kill('SIGTERM')
            finish({
                initialized: false,
                exitCode: null,
                timedOut,
            })
        }, input.timeoutMs)

        child.stdout.on('data', (chunk) => {
            stdout += String(chunk)
            if (stdout.includes('"id"')) {
                child.kill('SIGTERM')
                finish({
                    initialized: true,
                    exitCode: null,
                    timedOut: false,
                })
            }
        })
        child.stderr.on('data', (chunk) => {
            stderr += String(chunk)
        })
        child.on('error', (error) => {
            stderr = error.message
            finish({
                initialized: false,
                exitCode: null,
                timedOut,
            })
        })
        child.on('exit', (exitCode) => {
            finish({
                initialized: false,
                exitCode,
                timedOut,
            })
        })

        child.stdin.write(buildMcpInitializeRequest())
        child.stdin.end()
    })
}

function providerConfigForValidation(input: ProviderValidationInput): Record<string, unknown> {
    const baseUrl = resolveProviderBaseUrl({
        provider: input.provider,
        api: input.api,
        baseUrl: input.baseUrl,
    })
    const modelId = input.model.replace(`${input.provider}/`, '')

    return {
        agents: {
            defaults: {
                model: {
                    primary: input.model,
                },
            },
        },
        models: {
            mode: 'merge',
            providers: {
                [input.provider]: {
                    ...(baseUrl ? { baseUrl } : {}),
                    ...(input.authMode === 'api_key'
                        ? { apiKey: providerEnvKey(input.provider) }
                        : {}),
                    api: input.api,
                    models: [
                        {
                            id: modelId,
                            name: input.model,
                        },
                    ],
                },
            },
        },
    }
}

export async function validateProviderConnection(
    input: ProviderValidationInput,
): Promise<ConnectionValidationResult> {
    if (input.authMode === 'oauth') {
        return {
            status: 'ready',
            message:
                'OAuth provider config saved; each room must complete provider auth in its own runtime',
        }
    }

    if (!input.apiKey) {
        return {
            status: 'invalid',
            message: 'Provider API key is required',
        }
    }

    const tempDir = await mkdtemp(join(tmpdir(), 'agent-room-provider-validation-'))
    try {
        const configPath = join(tempDir, 'openclaw.config.json')
        await writeFile(configPath, JSON.stringify(providerConfigForValidation(input), null, 4), {
            encoding: 'utf8',
            mode: 0o600,
        })

        const result = await runCommand({
            command: 'openclaw',
            args: [
                'models',
                'status',
                '--probe-provider',
                input.provider,
                '--probe-max-tokens',
                '1',
                '--json',
            ],
            env: {
                OPENCLAW_CONFIG_PATH: configPath,
                OPENCLAW_STATE_DIR: join(tempDir, 'state'),
                [providerEnvKey(input.provider)]: input.apiKey,
            },
            timeoutMs: 45_000,
            secrets: [input.apiKey],
        })

        if (result.timedOut) {
            return {
                status: 'invalid',
                message: 'Provider probe timed out',
            }
        }

        if (result.exitCode === 0) {
            return {
                status: 'ready',
                message: 'Provider probe completed through OpenClaw',
            }
        }

        return {
            status: 'invalid',
            message:
                result.stderr ||
                result.stdout ||
                `Provider probe exited with code ${String(result.exitCode)}`,
        }
    } finally {
        await rm(tempDir, {
            force: true,
            recursive: true,
        })
    }
}

function buildMcpInitializeRequest(): string {
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

export async function validateMcpConnection(
    input: McpValidationInput,
): Promise<ConnectionValidationResult> {
    if (input.transport === 'stdio') {
        if (!input.command) {
            return {
                status: 'invalid',
                message: 'MCP stdio transport requires a command',
            }
        }

        const result = await runMcpStdioInitialize({
            command: input.command,
            args: input.args,
            env:
                input.authMode === 'bearer' && input.bearerToken
                    ? {
                          MCP_AUTH_TOKEN: input.bearerToken,
                      }
                    : {},
            timeoutMs: 8_000,
            secrets: input.bearerToken ? [input.bearerToken] : [],
        })

        if (result.timedOut) {
            return {
                status: 'invalid',
                message: 'MCP stdio initialize timed out',
            }
        }

        if (result.initialized) {
            return {
                status: 'ready',
                message: 'MCP stdio initialize completed',
            }
        }

        return {
            status: 'invalid',
            message:
                result.stderr ||
                result.stdout ||
                `MCP stdio initialize exited with code ${String(result.exitCode)}`,
        }
    }

    if (!input.url) {
        return {
            status: 'invalid',
            message: 'MCP HTTP transport requires a URL',
        }
    }

    const headers = {
        ...input.headers,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        ...(input.authMode === 'bearer' && input.bearerToken
            ? {
                  authorization: `Bearer ${input.bearerToken}`,
              }
            : {}),
    }

    try {
        const response = await fetch(input.url, {
            method: 'POST',
            headers,
            body: buildMcpInitializeRequest(),
            signal: AbortSignal.timeout(8_000),
        })

        if (response.ok) {
            return {
                status: 'ready',
                message: 'MCP HTTP initialize completed',
            }
        }

        return {
            status: 'invalid',
            message: `MCP HTTP initialize returned ${String(response.status)}`,
        }
    } catch (error) {
        return {
            status: 'invalid',
            message: error instanceof Error ? error.message : 'MCP HTTP initialize failed',
        }
    }
}
