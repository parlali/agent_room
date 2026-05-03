import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    AuthStorage,
    createAgentSession,
    ModelRegistry,
    SessionManager,
    SettingsManager,
    type AgentSession,
} from '@mariozechner/pi-coding-agent'
import type {
    ConnectionStatus,
    MaterializedRoomConfiguration,
    McpAuthMode,
    McpTransport,
    ProviderApi,
    RoomPaths,
} from '../domain/types'
import { buildPiRuntimeConfig } from '../rooms/pi-runtime-config'
import { createPiResourceLoader } from '../pi-runtime/resource-loader'
import { buildBoundedProcessEnv, disableImplicitEnvFileForCommand } from '../security/process-env'
import {
    assertSupportedProviderApi,
    isLocalProvider,
    isSupportedProvider,
    providerEnvKey,
    providerRequiresStoredCredential,
    resolveProviderBaseUrl,
} from './provider-config'

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
    timeoutMs?: number
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

const maxValidationOutputBytes = 128000

function boundedMessage(value: string): string {
    return value
        .replace(/[^\S\r\n]+/g, ' ')
        .trim()
        .slice(0, 600)
}

function appendBoundedOutput(current: string, chunk: Buffer | string): string {
    const next = current + chunk.toString()
    if (Buffer.byteLength(next) <= maxValidationOutputBytes) {
        return next
    }
    return Buffer.from(next).subarray(0, maxValidationOutputBytes).toString('utf8')
}

function sanitizeOutput(output: string, secrets: string[]): string {
    let sanitized = output
    for (const secret of [...new Set(secrets)].sort((left, right) => right.length - left.length)) {
        if (secret) {
            sanitized = sanitized.replaceAll(secret, '[redacted]')
        }
    }
    return boundedMessage(sanitized)
}

function hasMcpInitializeResponse(output: string): boolean {
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

function buildValidationRoomPaths(tempDir: string): RoomPaths {
    return {
        roomRootDir: tempDir,
        runtimeDir: join(tempDir, 'runtime'),
        runtimeLogsDir: join(tempDir, 'runtime', 'logs'),
        runtimeSecretsDir: join(tempDir, 'runtime', 'secrets'),
        engineStateDir: join(tempDir, 'pi-state'),
        workspaceDir: join(tempDir, 'workspace'),
        storeDir: join(tempDir, 'store'),
        storeBlobsDir: join(tempDir, 'store', 'blobs'),
        storeManifestsDir: join(tempDir, 'store', 'manifests'),
        storeExportsDir: join(tempDir, 'store', 'exports'),
        runtimeConfigPath: join(tempDir, 'runtime', 'pi-runtime.config.json'),
        runtimeEnvPath: join(tempDir, 'runtime', 'pi-runtime.env'),
        runtimeLogPath: join(tempDir, 'runtime', 'logs', 'pi-runtime.log'),
        runtimeMetadataPath: join(tempDir, 'runtime', 'runtime.json'),
        runtimeHealthPath: join(tempDir, 'runtime', 'health.json'),
        runtimeTokenPath: join(tempDir, 'runtime', 'token'),
    }
}

function buildValidationRoomConfiguration(
    input: ProviderValidationInput,
): MaterializedRoomConfiguration {
    return {
        instructions: '',
        toolsProfile: 'read-only',
        provider: {
            provider: input.provider,
            authMode: input.authMode,
            api: input.api,
            model: input.model,
            fallbackModels: [],
            baseUrl: resolveProviderBaseUrl({
                provider: input.provider,
                api: input.api,
                baseUrl: input.baseUrl,
            }),
            envKey: providerRequiresStoredCredential({
                provider: input.provider,
                authMode: input.authMode,
            })
                ? providerEnvKey(input.provider)
                : null,
        },
        entitlements: {
            env: {},
            secretRefs: [],
            mcpServers: [],
        },
    }
}

function extractPiProbeError(session: AgentSession): string | null {
    const entries = session.sessionManager.getEntries()
    for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index]
        if (!entry || entry.type !== 'message') {
            continue
        }
        const message = entry.message as unknown as Record<string, unknown>
        if (message.role !== 'assistant') {
            continue
        }
        if (typeof message.errorMessage === 'string' && message.errorMessage.trim()) {
            return message.errorMessage
        }
        if (message.stopReason === 'error' || message.stopReason === 'aborted') {
            return `Provider returned stop reason ${String(message.stopReason)}`
        }
    }
    return null
}

function extractPiProbeAssistantText(session: AgentSession): string | null {
    const entries = session.sessionManager.getEntries()
    for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index]
        if (!entry || entry.type !== 'message') {
            continue
        }
        const message = entry.message as unknown as Record<string, unknown>
        if (message.role !== 'assistant') {
            continue
        }
        const content = message.content
        if (typeof content === 'string') {
            return content
        }
        if (Array.isArray(content)) {
            return content
                .map((part) => {
                    if (!part || typeof part !== 'object') {
                        return ''
                    }
                    const record = part as Record<string, unknown>
                    return typeof record.text === 'string' ? record.text : ''
                })
                .join('')
        }
    }
    return null
}

function assertProviderModelBelongsToProvider(input: ProviderValidationInput): string | null {
    const provider = input.provider.trim().toLowerCase()
    const modelProvider = input.model.includes('/')
        ? input.model.split('/')[0]?.trim().toLowerCase()
        : null
    if (!modelProvider || modelProvider === provider) {
        return null
    }
    if (provider === 'lmstudio' && modelProvider === 'lm-studio') {
        return null
    }
    return `Model ${input.model} does not belong to provider ${input.provider}`
}

async function promptWithTimeout(session: AgentSession, timeoutMs: number): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | null = null
    try {
        await Promise.race([
            session.prompt('Reply with exactly: ok', {
                source: 'rpc',
            }),
            new Promise<never>((_, reject) => {
                timeout = setTimeout(() => reject(new Error('Provider probe timed out')), timeoutMs)
            }),
        ])
    } finally {
        if (timeout) {
            clearTimeout(timeout)
        }
        if (session.isStreaming) {
            await session.abort()
        }
    }
}

async function runPiProviderProbe(
    input: ProviderValidationInput,
): Promise<ConnectionValidationResult> {
    const tempDir = await mkdtemp(join(tmpdir(), 'agent-room-provider-validation-'))

    try {
        const paths = buildValidationRoomPaths(tempDir)
        const config = buildPiRuntimeConfig({
            roomId: 'provider-validation',
            displayName: 'Provider Validation',
            port: 0,
            token: 'provider-validation-token-provider-validation',
            paths,
            roomConfiguration: buildValidationRoomConfiguration(input),
        })
        if (input.apiKey) {
            const providerConfig = config.models.providers[config.provider.piProvider]
            if (providerConfig) {
                providerConfig.apiKey = input.apiKey
            }
        }
        await Promise.all([
            mkdir(config.paths.stateDir, { recursive: true, mode: 0o700 }),
            mkdir(config.paths.sessionsDir, { recursive: true, mode: 0o700 }),
            mkdir(config.paths.workspaceDir, { recursive: true, mode: 0o700 }),
            mkdir(config.paths.storeDir, { recursive: true, mode: 0o700 }),
        ])
        await writeFile(config.paths.modelsPath, JSON.stringify(config.models, null, 4), {
            encoding: 'utf8',
            mode: 0o600,
        })

        const authStorage = AuthStorage.create(config.paths.authPath)
        const modelRegistry = ModelRegistry.create(authStorage, config.paths.modelsPath)
        const modelError = modelRegistry.getError()
        if (modelError) {
            return {
                status: 'invalid',
                message: boundedMessage(modelError),
            }
        }

        const model = modelRegistry.find(config.provider.piProvider, config.provider.piModel)
        if (!model) {
            return {
                status: 'invalid',
                message: `Pi model ${config.provider.piProvider}/${config.provider.piModel} is not available`,
            }
        }

        const settingsManager = SettingsManager.inMemory({
            compaction: {
                enabled: false,
            },
            retry: {
                enabled: false,
                provider: {
                    timeoutMs: 30000,
                    maxRetries: 0,
                    maxRetryDelayMs: 0,
                },
            },
        })
        const { session } = await createAgentSession({
            cwd: config.paths.workspaceDir,
            agentDir: config.paths.stateDir,
            authStorage,
            modelRegistry,
            model,
            sessionManager: SessionManager.create(
                config.paths.workspaceDir,
                config.paths.sessionsDir,
            ),
            settingsManager,
            resourceLoader: createPiResourceLoader(
                'You are validating a provider connection. Reply with exactly: ok',
            ),
            noTools: 'all',
            tools: [],
        })
        try {
            await promptWithTimeout(session, input.timeoutMs ?? 45_000)
            const probeError = extractPiProbeError(session)
            if (probeError) {
                return {
                    status: 'invalid',
                    message: boundedMessage(
                        sanitizeOutput(probeError, input.apiKey ? [input.apiKey] : []),
                    ),
                }
            }
            const assistantText = extractPiProbeAssistantText(session)?.trim().toLowerCase() ?? ''
            if (assistantText !== 'ok') {
                return {
                    status: 'invalid',
                    message: assistantText
                        ? `Provider probe returned unexpected response: ${boundedMessage(assistantText)}`
                        : 'Provider probe returned no assistant text',
                }
            }
        } finally {
            session.dispose()
        }

        return {
            status: 'ready',
            message: 'Provider probe completed through Pi',
        }
    } catch (error) {
        return {
            status: 'invalid',
            message: boundedMessage(
                sanitizeOutput(
                    error instanceof Error ? error.message : 'Provider probe failed',
                    input.apiKey ? [input.apiKey] : [],
                ),
            ),
        }
    } finally {
        await rm(tempDir, {
            force: true,
            recursive: true,
        })
    }
}

export async function validateProviderConnection(
    input: ProviderValidationInput,
): Promise<ConnectionValidationResult> {
    if (!isSupportedProvider(input.provider)) {
        return {
            status: 'invalid',
            message: `Provider ${input.provider} is not supported by this Agent Room build`,
        }
    }
    try {
        assertSupportedProviderApi(input.provider, input.api)
    } catch (error) {
        return {
            status: 'invalid',
            message: error instanceof Error ? error.message : 'Unsupported provider API',
        }
    }

    const providerMismatch = assertProviderModelBelongsToProvider(input)
    if (providerMismatch) {
        return {
            status: 'invalid',
            message: providerMismatch,
        }
    }

    if (input.authMode === 'oauth') {
        return {
            status: 'ready',
            message:
                'OAuth provider config saved; each room must complete provider auth in its own runtime',
        }
    }

    const requiresCredential = providerRequiresStoredCredential({
        provider: input.provider,
        authMode: input.authMode,
    })

    if (requiresCredential && !input.apiKey) {
        return {
            status: 'invalid',
            message: 'Provider API key is required',
        }
    }

    if (isLocalProvider(input.provider) && !resolveProviderBaseUrl(input)) {
        return {
            status: 'invalid',
            message: 'Local provider base URL is required',
        }
    }

    return runPiProviderProbe(input)
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
