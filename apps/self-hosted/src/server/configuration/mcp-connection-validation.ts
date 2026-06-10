import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildBoundedProcessEnv, disableImplicitEnvFileForCommand } from '../security/process-env'
import {
    appendBoundedOutput,
    buildMcpInitializeRequest,
    hasMcpInitializeResponse,
    sanitizeOutput,
    type ConnectionValidationResult,
    type McpValidationInput,
} from './connection-validation-model'

async function runMcpStdioInitialize(input: {
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
    const tempDir = await mkdtemp(join(tmpdir(), 'agent-room-mcp-validation-'))
    const homeDir = join(tempDir, 'home')
    const tmpDirPath = join(tempDir, 'tmp')
    await Promise.all([
        mkdir(homeDir, {
            recursive: true,
            mode: 0o700,
        }),
        mkdir(tmpDirPath, {
            recursive: true,
            mode: 0o700,
        }),
    ])

    return await new Promise((resolve) => {
        const child = spawn(
            input.command,
            disableImplicitEnvFileForCommand(input.command, input.args),
            {
                env: buildBoundedProcessEnv({
                    ...input.env,
                    HOME: homeDir,
                    TMPDIR: tmpDirPath,
                }),
                cwd: tempDir,
                stdio: 'pipe',
            },
        )

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
            void rm(tempDir, {
                force: true,
                recursive: true,
            }).finally(() => {
                resolve({
                    initialized: result.initialized,
                    exitCode: result.exitCode,
                    stdout: sanitizeOutput(stdout, input.secrets ?? []),
                    stderr: sanitizeOutput(stderr, input.secrets ?? []),
                    timedOut: result.timedOut,
                })
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
            stdout = appendBoundedOutput(stdout, chunk)
            if (hasMcpInitializeResponse(stdout)) {
                child.kill('SIGTERM')
                finish({
                    initialized: true,
                    exitCode: null,
                    timedOut: false,
                })
            }
        })
        child.stderr.on('data', (chunk) => {
            stderr = appendBoundedOutput(stderr, chunk)
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
            const body = await response.text()
            if (hasMcpInitializeResponse(body)) {
                return {
                    status: 'ready',
                    message: 'MCP HTTP initialize completed',
                }
            }
            return {
                status: 'invalid',
                message: 'MCP HTTP initialize returned no JSON-RPC result',
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
