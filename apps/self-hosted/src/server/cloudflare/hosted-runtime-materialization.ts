import { Buffer } from 'node:buffer'
import type {
    AppMcpConnectionRecord,
    AppProviderConnectionRecord,
    AppSettingsRecord,
    MaterializedMcpServer,
    MaterializedRoomConfiguration,
    RoomConfigRecord,
    RoomMcpBindingRecord,
    RuntimeSandboxHardening,
    RuntimeSandboxIdentity,
} from '#/domain/domain-types'
import { inspectCodexPiAuthJson, type CodexAppAuthStatus } from '../configuration/codex-auth'
import { resolveEffectiveProvider } from '../configuration/operator-configuration/provider-resolution'
import { toStringArray } from '../configuration/operator-configuration/helpers'
import {
    providerRequiresStoredCredential,
    resolveProviderBaseUrl,
} from '../configuration/provider-config'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import { defaultRuntimeSandboxHardening } from '../rooms/runtime-sandbox-hardening'
import {
    hostedRuntimeFileCallbackUrlEnvKey,
    hostedRuntimeManagedOpenRouterEnvKey,
    hostedRuntimeQuotaCallbackUrlEnvKey,
    hostedRuntimeRoomIdEnvKey,
    hostedRuntimeStateCallbackUrlEnvKey,
    hostedRuntimeUsageCallbackTokenEnvKey,
    hostedRuntimeUsageCallbackUrlEnvKey,
    hostedRuntimeWorkspaceIdEnvKey,
    piCodingAgentDirEnvKey,
    piRuntimeConfigPathEnvKey,
    piRuntimeFileBundleEnvKey,
    piRuntimeRedactionSecretsEnvKey,
    piRuntimeStateDirEnvKey,
    piRuntimeTokenEnvKey,
} from '../rooms/pi-runtime-contract'
import { shellVisibleStoreDirEnvKey, shellVisibleWorkspaceDirEnvKey } from '../security/process-env'
import type { AgentRoomHostedEnv } from './bindings'
import {
    assertHostedRuntimeEgressDestination,
    assertHostedRuntimeEgressUrlLiteral,
    type HostedRuntimeDnsResolver,
} from './hosted-runtime-egress-policy'
import { resolveHostedCodexStatus } from './hosted-operator-config-service'
import { resolveHostedMcpHeaders } from './hosted-mcp-header-secrets'
import type { HostedProviderCandidate } from './hosted-provider-priority'
import {
    assertHostedManagedModelAvailable,
    hostedManagedModelId,
    hostedManagedModelLabel,
    hostedManagedModelProvider,
} from './hosted-model-policy'
import { hostedOpenRouterProxyBaseUrl } from './hosted-provider-proxy'
import {
    hostedProviderAuthPath,
    hostedRoomPaths,
    hostedRuntimeConfigPath,
} from './hosted-runtime-paths'
import { readHostedSecretPlainText } from './hosted-secret-store'

export type ProviderSelectionConfig = Pick<
    RoomConfigRecord,
    'providerMode' | 'providerConnectionId'
>

export const hostedSandbox: RuntimeSandboxIdentity = {
    mode: 'disabled',
    uid: null,
    gid: null,
    userName: null,
    groupName: null,
}

export function hostedSandboxHardening(): RuntimeSandboxHardening {
    return {
        ...defaultRuntimeSandboxHardening(),
        restrictPrivateNetwork: true,
    }
}

export interface RuntimeFileBundleEntry {
    path: string
    contentBase64: string
    mode: number
}

export interface HostedRuntimeMaterialization {
    configObjectKey: string
    tokenObjectKey: string
    bundleObjectKey: string
    runtimeConfig: unknown
    runtimeEnv: Record<string, string>
    providerCandidate: HostedProviderCandidate
    egressAllowedHosts: string[]
}

export interface HostedProviderSelection {
    resolution: ReturnType<typeof resolveEffectiveProvider>
    readyProvider: AppProviderConnectionRecord | null
    apiKeyProvider: AppProviderConnectionRecord | null
    codexProvider: AppProviderConnectionRecord | null
}

export function randomHostedRuntimeToken(): string {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    return Buffer.from(bytes).toString('base64url')
}

export function runtimeFileBundle(
    entries: Array<{ path: string; content: string; mode: number }>,
): RuntimeFileBundleEntry[] {
    return entries.map((entry) => ({
        path: entry.path,
        contentBase64: Buffer.from(entry.content, 'utf8').toString('base64url'),
        mode: entry.mode,
    }))
}

export function resolveHostedProviderSelection(input: {
    config: ProviderSelectionConfig
    settings: Pick<AppSettingsRecord, 'defaultProviderConnectionId'>
    providers: AppProviderConnectionRecord[]
    codexAuth: CodexAppAuthStatus
}): HostedProviderSelection {
    const resolution = resolveEffectiveProvider({
        config: input.config,
        settings: input.settings,
        providers: input.providers,
        codexAuth: input.codexAuth,
    })
    const readyProvider = resolution.blockedReasons.length === 0 ? resolution.provider : null
    const apiKeyProvider =
        readyProvider &&
        readyProvider.provider !== 'openai-codex' &&
        readyProvider.credentialSecretId !== null &&
        providerRequiresStoredCredential({
            provider: readyProvider.provider,
            authMode: readyProvider.authMode,
        })
            ? readyProvider
            : null
    const codexProvider =
        readyProvider &&
        readyProvider.provider === 'openai-codex' &&
        readyProvider.credentialSecretId !== null
            ? readyProvider
            : null
    return { resolution, readyProvider, apiKeyProvider, codexProvider }
}

export function assertHostedProviderSelectionReady(input: {
    selection: HostedProviderSelection
    appConnectionMessage: string
    appDefaultMessage: string
}): void {
    if (input.selection.resolution.blockedReasons.length > 0) {
        throw new Error(
            input.selection.resolution.blockedReasons[0] ??
                (input.selection.resolution.source === 'app_connection'
                    ? input.appConnectionMessage
                    : input.appDefaultMessage),
        )
    }
}

export async function materializeHostedProvider(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    runtimeToken: string
    publicOrigin: string
    config: ProviderSelectionConfig
    settings: Pick<AppSettingsRecord, 'defaultModel' | 'defaultProviderConnectionId'>
    providers: AppProviderConnectionRecord[]
}): Promise<{
    provider: MaterializedRoomConfiguration['provider']
    env: Record<string, string>
    authJson: string | null
    candidate: HostedProviderCandidate
}> {
    const codexAuth = await resolveHostedCodexStatus({
        env: input.env,
        workspaceId: input.workspaceId,
        providers: input.providers,
    })
    if (input.config.providerMode === 'managed_hosted') {
        await assertHostedManagedModelAvailable({
            env: input.env,
            workspaceId: input.workspaceId,
        })
        return {
            provider: {
                provider: hostedManagedModelProvider,
                authMode: 'api_key',
                api: 'openai-completions',
                model: hostedManagedModelId,
                modelLabel: hostedManagedModelLabel,
                fallbackModels: [],
                baseUrl: hostedOpenRouterProxyBaseUrl({
                    publicOrigin: input.publicOrigin,
                    workspaceId: input.workspaceId,
                    roomId: input.roomId,
                }),
                authPath: hostedProviderAuthPath,
            },
            env: {},
            authJson: providerAuthJson(hostedManagedModelProvider, {
                type: 'api_key',
                key: input.runtimeToken,
            }),
            candidate: 'hosted_openrouter',
        }
    }

    const selection = resolveHostedProviderSelection({
        ...input,
        codexAuth,
    })
    assertHostedProviderSelectionReady({
        selection,
        appConnectionMessage: 'Selected provider connection is not configured',
        appDefaultMessage: 'Default provider connection is not configured',
    })
    const { apiKeyProvider, codexProvider } = selection
    if (apiKeyProvider) {
        const apiKey = await readHostedSecretPlainText({
            env: input.env,
            workspaceId: input.workspaceId,
            secretId: apiKeyProvider.credentialSecretId,
        })
        if (!apiKey) {
            throw new Error('User provider credential is missing')
        }
        return providerMaterializationFromSecret({
            provider: apiKeyProvider,
            authJson: providerAuthJson(apiKeyProvider.provider, {
                type: 'api_key',
                key: apiKey,
            }),
            candidate: 'user_key',
        })
    }
    if (codexProvider) {
        const authJson = await readHostedSecretPlainText({
            env: input.env,
            workspaceId: input.workspaceId,
            secretId: codexProvider.credentialSecretId,
        })
        if (!authJson) {
            throw new Error('Codex provider credential is missing')
        }
        const authStatus = inspectCodexPiAuthJson({
            authJson,
            requiresStoredCredential: true,
        })
        if (!authStatus.ready) {
            throw new Error(authStatus.message)
        }
        return providerMaterializationFromSecret({
            provider: codexProvider,
            authJson,
            candidate: 'codex',
        })
    }
    throw new Error('No hosted provider candidate is available')
}

function providerMaterializationFromSecret(input: {
    provider: AppProviderConnectionRecord
    authJson: string
    candidate: HostedProviderCandidate
}): {
    provider: MaterializedRoomConfiguration['provider']
    env: Record<string, string>
    authJson: string
    candidate: HostedProviderCandidate
} {
    return {
        provider: {
            provider: input.provider.provider,
            authMode: input.provider.authMode,
            api: input.provider.api,
            model: input.provider.defaultModel,
            fallbackModels: toStringArray(input.provider.fallbackModels),
            baseUrl: resolveProviderBaseUrl({
                provider: input.provider.provider,
                api: input.provider.api,
                baseUrl: input.provider.baseUrl,
            }),
            authPath: hostedProviderAuthPath,
        },
        env: {},
        authJson: input.authJson.trim().startsWith('{')
            ? input.authJson.trim()
            : providerAuthJson(input.provider.provider, input.authJson),
        candidate: input.candidate,
    }
}

function providerAuthJson(provider: string, credential: unknown): string {
    return JSON.stringify(
        {
            [provider]: credential,
        },
        null,
        4,
    )
}

export async function materializeHostedMcpServers(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    mcpConnections: AppMcpConnectionRecord[]
    bindings: RoomMcpBindingRecord[]
}): Promise<MaterializedMcpServer[]> {
    const servers: MaterializedMcpServer[] = []
    for (const binding of input.bindings) {
        const connection = input.mcpConnections.find(
            (entry) => entry.id === binding.mcpConnectionId,
        )
        if (!connection || connection.status !== 'ready') {
            throw new Error(
                connection?.validationMessage ??
                    `MCP binding ${binding.mcpConnectionId} points to a missing or unready connection`,
            )
        }
        const headers = await resolveHostedMcpHeaders({
            env: input.env,
            workspaceId: input.workspaceId,
            connection,
        })
        const env: Record<string, string> = {}
        if (connection.authMode === 'bearer') {
            const token = await readHostedSecretPlainText({
                env: input.env,
                workspaceId: input.workspaceId,
                secretId: connection.credentialSecretId,
            })
            if (!token) {
                throw new Error(
                    `MCP connection ${connection.serverKey} requires a saved bearer token`,
                )
            }
            if (connection.transport === 'stdio') {
                env.MCP_AUTH_TOKEN = token
            } else {
                headers.Authorization = `Bearer ${token}`
            }
        }
        servers.push({
            id: connection.serverKey,
            provider: connection.name,
            allowedTools:
                toStringArray(binding.allowedTools).length > 0
                    ? toStringArray(binding.allowedTools)
                    : toStringArray(connection.allowedTools),
            transport: connection.transport,
            command: connection.command,
            args: toStringArray(connection.args),
            url: connection.url,
            env,
            headers,
        })
    }
    return servers
}

function encodeBundle(bundle: RuntimeFileBundleEntry[]): string {
    return Buffer.from(JSON.stringify(bundle), 'utf8').toString('base64url')
}

function collectStringLeaves(value: unknown): string[] {
    if (typeof value === 'string') {
        return [value]
    }
    if (!value || typeof value !== 'object') {
        return []
    }
    if (Array.isArray(value)) {
        return value.flatMap(collectStringLeaves)
    }
    return Object.values(value as Record<string, unknown>).flatMap(collectStringLeaves)
}

function secretRedactionParts(value: string | null | undefined): string[] {
    if (!value) {
        return []
    }
    const values = [value]
    const bearer = value.match(/^Bearer\s+(.+)$/i)
    if (bearer) {
        values.push(bearer[1]!)
    }
    try {
        values.push(...collectStringLeaves(JSON.parse(value) as unknown))
    } catch {}
    return values
}

export function hostedRuntimeRedactionSecrets(input: {
    providerAuthJson: string | null
    env: Record<string, string>
    mcpServers: MaterializedMcpServer[]
}): string[] {
    const values = [
        ...secretRedactionParts(input.providerAuthJson),
        ...Object.values(input.env).flatMap(secretRedactionParts),
    ]
    for (const server of input.mcpServers) {
        values.push(
            ...Object.values(server.env).flatMap(secretRedactionParts),
            ...Object.values(server.headers).flatMap(secretRedactionParts),
        )
    }
    return [...new Set(values.filter((value) => value.trim().length >= 6))].sort(
        (left, right) => right.length - left.length,
    )
}

export function buildHostedRuntimeEnv(input: {
    roomConfiguration: MaterializedRoomConfiguration
    token: string
    bundle: RuntimeFileBundleEntry[]
    redactionSecrets: string[]
    providerCandidate: HostedProviderCandidate
    workspaceId: string
    roomId: string
    publicOrigin: string
}): Record<string, string> {
    const paths = hostedRoomPaths()
    const env: Record<string, string> = {
        ...input.roomConfiguration.entitlements.env,
        ...input.roomConfiguration.entitlements.internalEnv,
        [piRuntimeConfigPathEnvKey]: hostedRuntimeConfigPath,
        [piRuntimeTokenEnvKey]: input.token,
        [piRuntimeStateDirEnvKey]: paths.engineStateDir,
        [shellVisibleWorkspaceDirEnvKey]: paths.workspaceDir,
        [shellVisibleStoreDirEnvKey]: paths.storeDir,
        [piCodingAgentDirEnvKey]: paths.engineStateDir,
        [piRuntimeFileBundleEnvKey]: encodeBundle(input.bundle),
        [piRuntimeRedactionSecretsEnvKey]: Buffer.from(
            JSON.stringify(input.redactionSecrets),
            'utf8',
        ).toString('base64url'),
        [hostedRuntimeUsageCallbackUrlEnvKey]: `${input.publicOrigin}/api/hosted/runtime/usage`,
        [hostedRuntimeUsageCallbackTokenEnvKey]: input.token,
        [hostedRuntimeFileCallbackUrlEnvKey]: `${input.publicOrigin}/api/hosted/runtime/file`,
        [hostedRuntimeStateCallbackUrlEnvKey]: `${input.publicOrigin}/api/hosted/runtime/state`,
        [hostedRuntimeQuotaCallbackUrlEnvKey]: `${input.publicOrigin}/api/hosted/runtime/quota`,
        [hostedRuntimeWorkspaceIdEnvKey]: input.workspaceId,
        [hostedRuntimeRoomIdEnvKey]: input.roomId,
        HOME: '/workspace/runtime/pi-state/home',
        TMPDIR: '/workspace/runtime/pi-state/tmp',
    }
    if (input.providerCandidate === 'hosted_openrouter') {
        env[hostedRuntimeManagedOpenRouterEnvKey] = '1'
    }
    return env
}

function hostFromUrl(value: string | null | undefined, label: string): string | null {
    if (!value) {
        return null
    }
    return assertHostedRuntimeEgressUrlLiteral(value, label)
}

function addUrlHost(hosts: Set<string>, url: string | null | undefined, label: string): void {
    const host = hostFromUrl(url, label)
    if (host) {
        hosts.add(host)
    }
}

async function addTenantUrlHost(
    hosts: Set<string>,
    input: {
        url: string
        label: string
        resolveHostnameAddresses?: HostedRuntimeDnsResolver
    },
): Promise<void> {
    const destination = await assertHostedRuntimeEgressDestination({
        value: input.url,
        label: input.label,
        resolveHostnameAddresses: input.resolveHostnameAddresses,
    })
    const pinnedHosts =
        destination.resolvedAddresses.length > 0
            ? destination.resolvedAddresses
            : [destination.hostname]
    for (const host of pinnedHosts) {
        hosts.add(host)
    }
}

export async function hostedRuntimeAllowedHosts(input: {
    runtimeConfig: PiRuntimeConfig
    usageCallbackUrl: string | undefined
    quotaCallbackUrl: string | undefined
    resolveTenantHostnameAddresses?: HostedRuntimeDnsResolver
}): Promise<string[]> {
    const hosts = new Set<string>()
    addUrlHost(hosts, input.runtimeConfig.provider.baseUrl, 'Provider base')
    addUrlHost(hosts, input.usageCallbackUrl, 'Hosted runtime usage callback')
    addUrlHost(hosts, input.quotaCallbackUrl, 'Hosted runtime quota callback')
    if (input.runtimeConfig.search.enabled) {
        addUrlHost(hosts, input.runtimeConfig.search.backendUrl, 'Hosted search backend')
    }
    if (
        input.runtimeConfig.urlFetch.mode === 'managed' &&
        input.runtimeConfig.urlFetch.proxyUrl &&
        input.runtimeConfig.urlFetch.tokenEnvKey
    ) {
        addUrlHost(hosts, input.runtimeConfig.urlFetch.proxyUrl, 'Hosted fetch URL proxy')
    }
    if (input.runtimeConfig.search.brave.enabled && input.runtimeConfig.search.brave.envKey) {
        addUrlHost(
            hosts,
            input.runtimeConfig.search.brave.baseUrl ?? 'https://api.search.brave.com',
            input.runtimeConfig.search.brave.baseUrl
                ? 'Hosted Brave Search proxy'
                : 'Brave Search API',
        )
    }
    if (
        input.runtimeConfig.search.browserbase.enabled &&
        input.runtimeConfig.search.browserbase.envKey
    ) {
        addUrlHost(
            hosts,
            input.runtimeConfig.search.browserbase.baseUrl ?? 'https://api.browserbase.com',
            input.runtimeConfig.search.browserbase.baseUrl
                ? 'Hosted Browserbase proxy'
                : 'Browserbase API',
        )
        addUrlHost(hosts, 'https://connect.browserbase.com', 'Browserbase CDP')
    }
    if (input.runtimeConfig.image.enabled && input.runtimeConfig.image.provider === 'openai') {
        addUrlHost(hosts, 'https://api.openai.com', 'OpenAI image API')
    }
    if (input.runtimeConfig.image.enabled && input.runtimeConfig.image.provider === 'gemini') {
        addUrlHost(hosts, 'https://generativelanguage.googleapis.com', 'Gemini image API')
    }
    for (const server of input.runtimeConfig.mcpServers) {
        if ((server.transport === 'http' || server.transport === 'streamable_http') && server.url) {
            await addTenantUrlHost(hosts, {
                url: server.url,
                label: `MCP connection ${server.id}`,
                resolveHostnameAddresses: input.resolveTenantHostnameAddresses,
            })
        }
    }
    if (hosts.size === 0) {
        throw new Error('Hosted runtime egress allowlist is empty')
    }
    return Array.from(hosts).sort()
}
