import type {
    AppMcpConnectionRecord,
    AppProviderConnectionRecord,
    AppSettingsRecord,
    MaterializedMcpServer,
    RoomMcpBindingRecord,
    SearchRuntimeConfig,
} from '#/domain/domain-types'
import { searchProviderEnvKey } from '../configuration/capabilities'
import {
    boundedMessage,
    buildMcpInitializeRequest,
    hasMcpInitializeResponse,
    sanitizeOutput,
    type ConnectionValidationResult,
} from '../configuration/connection-validation-model'
import {
    type ValidatedWebSearchProviderId,
    withIsolatedWebSearchProviderEnv,
    validateWebSearchRuntimeProviders,
} from '../pi-runtime/web-search-validation'
import {
    hostedRuntimeBraveProxyUrlEnvKey,
    piRuntimeTokenEnvKey,
} from '../rooms/pi-runtime-contract'
import type { ProviderSelectionConfig } from './hosted-runtime-materialization'
import {
    materializeHostedMcpServers,
    materializeHostedProvider,
} from './hosted-runtime-materialization'
import type { AgentRoomHostedEnv } from './bindings'
import { assertHostedRuntimeEgressUrl } from './hosted-runtime-egress-policy'

const hostedConnectionValidationRoomId = 'connection-validation'
const hostedConnectionValidationRuntimeToken = 'connection-validation-runtime-token'

function readyProvider(provider: AppProviderConnectionRecord): AppProviderConnectionRecord {
    return {
        ...provider,
        status: 'ready',
        validationMessage: 'Hosted provider connection is being validated',
    }
}

function readyMcp(connection: AppMcpConnectionRecord): AppMcpConnectionRecord {
    return {
        ...connection,
        status: 'ready',
        validationMessage: 'Hosted MCP connection is being validated',
    }
}

function validationSettings(
    settings: Pick<AppSettingsRecord, 'defaultModel'>,
    providerConnectionId: string,
): Pick<AppSettingsRecord, 'defaultModel' | 'defaultProviderConnectionId'> {
    return {
        defaultModel: settings.defaultModel,
        defaultProviderConnectionId: providerConnectionId,
    }
}

function validationProviderConfig(providerConnectionId: string): ProviderSelectionConfig {
    return {
        providerMode: 'app_connection',
        providerConnectionId,
    }
}

function providerResponseText(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') {
        return null
    }
    const choices = (payload as { choices?: unknown }).choices
    if (!Array.isArray(choices)) {
        return null
    }
    const first = choices[0]
    if (!first || typeof first !== 'object') {
        return null
    }
    const message = (first as { message?: unknown }).message
    if (!message || typeof message !== 'object') {
        return null
    }
    const content = (message as { content?: unknown }).content
    return typeof content === 'string' ? content : null
}

export async function validateHostedOpenRouterProvider(input: {
    publicOrigin: string
    baseUrl: string
    model: string
    apiKey: string
}): Promise<ConnectionValidationResult> {
    try {
        const url = new URL(input.baseUrl.replace(/\/$/, ''))
        url.pathname = `${url.pathname.replace(/\/$/, '')}/chat/completions`
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                accept: 'application/json',
                authorization: `Bearer ${input.apiKey}`,
                'content-type': 'application/json',
                'http-referer': input.publicOrigin,
                'x-title': 'Agent Room Hosted',
            },
            body: JSON.stringify({
                model: input.model,
                messages: [
                    {
                        role: 'user',
                        content: 'Reply with exactly: ok',
                    },
                ],
                max_tokens: 8,
                temperature: 0,
                stream: false,
            }),
            signal: AbortSignal.timeout(45_000),
        })
        const bodyText = await response.text()
        if (!response.ok) {
            return {
                status: 'invalid',
                message: `OpenRouter probe returned ${String(response.status)}: ${boundedMessage(
                    sanitizeOutput(bodyText, [input.apiKey]),
                )}`,
            }
        }
        const payload = bodyText ? (JSON.parse(bodyText) as unknown) : null
        const text = providerResponseText(payload)
        if (!text) {
            return {
                status: 'invalid',
                message: 'OpenRouter probe returned no assistant text',
            }
        }
        if (text.trim() !== 'ok') {
            return {
                status: 'invalid',
                message: `OpenRouter probe returned unexpected assistant text: ${boundedMessage(
                    sanitizeOutput(text, [input.apiKey]),
                )}`,
            }
        }
        return {
            status: 'ready',
            message: 'OpenRouter probe completed through the hosted provider path',
        }
    } catch (error) {
        return {
            status: 'invalid',
            message: boundedMessage(
                sanitizeOutput(error instanceof Error ? error.message : 'OpenRouter probe failed', [
                    input.apiKey,
                ]),
            ),
        }
    }
}

export async function validateHostedSearchCredential(input: {
    provider: ValidatedWebSearchProviderId
    search: SearchRuntimeConfig
    apiKey: string
}): Promise<ConnectionValidationResult> {
    const envKey = searchProviderEnvKey(input.provider)
    const isolatedEnvKeys = new Set([
        envKey,
        hostedRuntimeBraveProxyUrlEnvKey,
        piRuntimeTokenEnvKey,
    ])
    const search = {
        ...input.search,
        enabled: true,
        brave: {
            ...input.search.brave,
            enabled: input.provider === 'brave',
            envKey: input.provider === 'brave' ? envKey : null,
        },
        browserbase: {
            ...input.search.browserbase,
            enabled: input.provider === 'browserbase',
            envKey: input.provider === 'browserbase' ? envKey : null,
        },
    }
    try {
        await withIsolatedWebSearchProviderEnv({
            isolatedEnvKeys,
            env: {
                [envKey]: input.apiKey,
            },
            run: async () => {
                await validateWebSearchRuntimeProviders({
                    config: {
                        runtime: {
                            roomId: hostedConnectionValidationRoomId,
                        },
                        search,
                    },
                    providers: [input.provider],
                })
            },
        })
        return {
            status: 'ready',
            message: `${input.provider} search credential validated through the hosted runtime path`,
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : `${input.provider} search failed`
        return {
            status: 'invalid',
            message: boundedMessage(sanitizeOutput(message, [input.apiKey])),
        }
    }
}
export async function validateHostedProviderConnection(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    settings: Pick<AppSettingsRecord, 'defaultModel'>
    provider: AppProviderConnectionRecord
    credentialPlainText: string | null
}): Promise<ConnectionValidationResult> {
    const publicOrigin = new URL(input.env.BETTER_AUTH_URL).origin
    let materialized: Awaited<ReturnType<typeof materializeHostedProvider>>
    try {
        materialized = await materializeHostedProvider({
            env: input.env,
            workspaceId: input.workspaceId,
            roomId: hostedConnectionValidationRoomId,
            runtimeToken: hostedConnectionValidationRuntimeToken,
            publicOrigin,
            config: validationProviderConfig(input.provider.id),
            settings: validationSettings(input.settings, input.provider.id),
            providers: [readyProvider(input.provider)],
        })
    } catch (error) {
        return {
            status: 'invalid',
            message:
                error instanceof Error
                    ? boundedMessage(error.message)
                    : 'Hosted provider runtime materialization failed',
        }
    }
    if (input.provider.provider === 'openrouter') {
        if (!input.credentialPlainText) {
            return {
                status: 'invalid',
                message: 'OpenRouter API key is required',
            }
        }
        if (!materialized.provider.baseUrl) {
            return {
                status: 'invalid',
                message: 'OpenRouter base URL is missing',
            }
        }
        return validateHostedOpenRouterProvider({
            publicOrigin,
            baseUrl: materialized.provider.baseUrl,
            model: materialized.provider.model,
            apiKey: input.credentialPlainText,
        })
    }
    return {
        status: 'ready',
        message: 'Hosted provider credential materialized through the runtime path',
    }
}

function validationBinding(connection: AppMcpConnectionRecord): RoomMcpBindingRecord {
    const now = new Date()
    return {
        roomId: hostedConnectionValidationRoomId,
        mcpConnectionId: connection.id,
        allowedTools: connection.allowedTools,
        enabled: true,
        createdAt: now,
        updatedAt: now,
    }
}

async function validateHostedMcpHttpInitialize(
    server: MaterializedMcpServer,
): Promise<ConnectionValidationResult> {
    if (!server.url) {
        return {
            status: 'invalid',
            message: 'MCP HTTP transport requires a URL',
        }
    }
    try {
        await assertHostedRuntimeEgressUrl({
            value: server.url,
            label: 'MCP connection',
        })
        const response = await fetch(server.url, {
            method: 'POST',
            headers: {
                ...server.headers,
                accept: 'application/json, text/event-stream',
                'content-type': 'application/json',
            },
            body: buildMcpInitializeRequest(),
            signal: AbortSignal.timeout(8_000),
        })
        const body = await response.text()
        if (!response.ok) {
            return {
                status: 'invalid',
                message: `MCP HTTP initialize returned ${String(response.status)}`,
            }
        }
        if (!hasMcpInitializeResponse(body)) {
            return {
                status: 'invalid',
                message: 'MCP HTTP initialize returned no JSON-RPC result',
            }
        }
        return {
            status: 'ready',
            message: 'MCP HTTP initialize completed through the hosted runtime config',
        }
    } catch (error) {
        return {
            status: 'invalid',
            message: error instanceof Error ? error.message : 'MCP HTTP initialize failed',
        }
    }
}

export async function validateHostedMcpConnection(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    connection: AppMcpConnectionRecord
}): Promise<ConnectionValidationResult> {
    if (input.connection.transport === 'stdio') {
        return {
            status: 'invalid',
            message: 'Hosted MCP stdio connections are not supported; use HTTP transport',
        }
    }
    let servers: MaterializedMcpServer[]
    try {
        servers = await materializeHostedMcpServers({
            env: input.env,
            workspaceId: input.workspaceId,
            mcpConnections: [readyMcp(input.connection)],
            bindings: [validationBinding(input.connection)],
        })
    } catch (error) {
        return {
            status: 'invalid',
            message:
                error instanceof Error
                    ? boundedMessage(error.message)
                    : 'Hosted MCP runtime materialization failed',
        }
    }
    const server = servers[0]
    if (!server) {
        return {
            status: 'invalid',
            message: 'Hosted MCP connection did not materialize a runtime server',
        }
    }
    return validateHostedMcpHttpInitialize(server)
}
