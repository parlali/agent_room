import type {
    AppMcpConnectionRecord,
    AppProviderConnectionRecord,
    AppSettingsRecord,
    CapabilityConfig,
    JsonValue,
    MaterializedRoomConfiguration,
    ProviderApi,
    ProviderAuthMode,
    RoomConfigRecord,
    RoomMcpBindingRecord,
} from '#/domain/domain-types'
import {
    capabilityConfigToJson,
    defaultCapabilities,
    normalizeImageConfig,
    normalizeSearchConfig,
    type SearchConfigDefaults,
    withSearchProviderEnvKeys,
} from '../configuration/capabilities'
import { inspectCodexPiAuthJson, type CodexAppAuthStatus } from '../configuration/codex-auth'
import type {
    McpConnectionSummary,
    OperatorConfigSnapshot,
    ProviderConnectionSummary,
    RoomConfigSnapshot,
} from '../configuration/operator-configuration'
import {
    listReadyProviders,
    resolveEffectiveProvider,
} from '../configuration/operator-configuration/provider-resolution'
import {
    redactedMcpHeaderValue,
    summarizeMcp,
    summarizeProvider,
    summarizeSettings,
    toStringRecord,
} from '../configuration/operator-configuration/helpers'
import { providerCatalog } from '../configuration/provider-config'
import type { HostedActor } from './hosted-auth'
import type { AgentRoomHostedEnv } from './bindings'
import { readHostedSecretPlainText, upsertHostedSecret } from './hosted-secret-store'
import { nowIso, parseJsonValue, stringifyJson, toDate } from './hosted-json'
import {
    hostedMcpHeaderSecretId,
    hostedMcpHeaderSecretKey,
    hostedMcpHeaderSecretRef,
} from './hosted-mcp-header-secrets'

export const hostedSearchDefaults = {
    enabled: true,
    backendUrl: '',
    defaultResultCount: 5,
    timeoutMs: 10000,
    maxSearchesPerRun: 20,
} satisfies SearchConfigDefaults

export function normalizeHostedSearchBackendUrl(value: string): string {
    const normalized = value.trim().replace(/\/$/, '')
    if (normalized && normalized !== 'http://searxng:8080') {
        throw new Error('Hosted SearXNG search backend is disabled')
    }
    return ''
}

const defaultSearchConfig = {
    ...hostedSearchDefaults,
    brave: {
        enabled: true,
        country: null,
        searchLang: null,
        safeSearch: 'moderate',
        timeoutMs: 10000,
        resultCount: 5,
        secretId: null,
    },
    browserbase: {
        enabled: false,
        timeoutMs: 10000,
        resultCount: 5,
        secretId: null,
    },
} satisfies JsonValue

const defaultImageConfig = {
    provider: null,
    model: null,
    secretId: null,
} satisfies JsonValue

function mapSettings(row: HostedWorkspaceSettingsRow): AppSettingsRecord {
    return {
        id: true,
        defaultProviderConnectionId: row.defaultProviderConnectionId,
        defaultModel: row.defaultModel,
        capabilityDefaults: parseJsonValue(
            row.capabilityDefaults,
            capabilityConfigToJson(defaultCapabilities),
        ),
        searchConfig: parseJsonValue(row.searchConfig, defaultSearchConfig),
        imageConfig: parseJsonValue(row.imageConfig, defaultImageConfig),
        onboardingCompletedAt: toDate(row.onboardingCompletedAt),
        createdAt: new Date(row.createdAt),
        updatedAt: new Date(row.updatedAt),
    }
}

function mapProvider(row: HostedProviderRow): AppProviderConnectionRecord {
    return {
        id: row.id,
        label: row.label,
        provider: row.provider,
        authMode: row.authMode as ProviderAuthMode,
        api: row.api as ProviderApi,
        baseUrl: row.baseUrl,
        defaultModel: row.defaultModel,
        fallbackModels: parseJsonValue(row.fallbackModels, []),
        credentialSecretId: row.credentialSecretId,
        status: row.status as AppProviderConnectionRecord['status'],
        validationMessage: row.validationMessage,
        lastValidatedAt: toDate(row.lastValidatedAt),
        createdByUserId: row.createdByUserId,
        createdAt: new Date(row.createdAt),
        updatedAt: new Date(row.updatedAt),
    }
}

function mapMcp(row: HostedMcpRow): AppMcpConnectionRecord {
    return {
        id: row.id,
        name: row.name,
        serverKey: row.serverKey,
        transport: row.transport as AppMcpConnectionRecord['transport'],
        command: row.command,
        args: parseJsonValue(row.args, []),
        url: row.url,
        headers: parseJsonValue(row.headers, {}),
        authMode: row.authMode as AppMcpConnectionRecord['authMode'],
        credentialSecretId: row.credentialSecretId,
        allowedTools: parseJsonValue(row.allowedTools, []),
        status: row.status as AppMcpConnectionRecord['status'],
        validationMessage: row.validationMessage,
        lastValidatedAt: toDate(row.lastValidatedAt),
        createdByUserId: row.createdByUserId,
        createdAt: new Date(row.createdAt),
        updatedAt: new Date(row.updatedAt),
    }
}

function hostedCodexMissingStatus(
    provider: AppProviderConnectionRecord | null,
): CodexAppAuthStatus {
    return {
        ready: false,
        status: provider ? 'invalid' : 'missing',
        accountId: null,
        expiresAt: null,
        message:
            provider?.validationMessage ??
            'Hosted Codex requires saving a Codex auth JSON credential on the Codex provider connection',
        requiresStoredCredential: true,
    }
}

export async function resolveHostedCodexStatus(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    providers: AppProviderConnectionRecord[]
}): Promise<CodexAppAuthStatus> {
    const provider = input.providers.find((entry) => entry.provider === 'openai-codex') ?? null
    if (!provider?.credentialSecretId || provider.status !== 'ready') {
        return hostedCodexMissingStatus(provider)
    }
    const authJson = await readHostedSecretPlainText({
        env: input.env,
        workspaceId: input.workspaceId,
        secretId: provider.credentialSecretId,
    })
    if (!authJson) {
        return hostedCodexMissingStatus({
            ...provider,
            validationMessage: 'Codex provider credential is missing',
        })
    }
    return inspectCodexPiAuthJson({
        authJson,
        requiresStoredCredential: true,
    })
}

export function summarizeHostedSettings(
    record: AppSettingsRecord,
    _env?: AgentRoomHostedEnv,
): OperatorConfigSnapshot['settings'] {
    return summarizeSettings(record, { searchDefaults: hostedSearchDefaults })
}

export function summarizeHostedProvider(
    record: AppProviderConnectionRecord,
): ProviderConnectionSummary {
    return summarizeProvider(record, { requireCodexCredential: true })
}

export function summarizeHostedMcp(record: AppMcpConnectionRecord): McpConnectionSummary {
    return summarizeMcp(record, { redactHeaders: true })
}

async function ensureHostedMcpHeaderSecrets(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    row: HostedMcpRow
}): Promise<HostedMcpRow> {
    const headers = toStringRecord(parseJsonValue(input.row.headers, {}))
    const nextHeaders: Record<string, string> = {}
    let migrated = false
    for (const [key, value] of Object.entries(headers)) {
        if (hostedMcpHeaderSecretId(value)) {
            nextHeaders[key] = value
            continue
        }
        if (value === redactedMcpHeaderValue) {
            throw new Error(`MCP connection ${input.row.serverKey} has a redacted plaintext header`)
        }
        const secretId = await upsertHostedSecret({
            env: input.env,
            workspaceId: input.workspaceId,
            keyName: hostedMcpHeaderSecretKey({
                connectionId: input.row.id,
                headerName: key,
            }),
            plainText: value,
        })
        nextHeaders[key] = hostedMcpHeaderSecretRef(secretId)
        migrated = true
    }
    if (!migrated) {
        return input.row
    }
    const now = nowIso()
    await input.env.AGENT_ROOM_DB.prepare(
        `
            UPDATE hosted_mcp_connection
            SET headers = ?1,
                updated_at = ?2
            WHERE workspace_id = ?3
              AND id = ?4
        `,
    )
        .bind(stringifyJson(nextHeaders), now, input.workspaceId, input.row.id)
        .run()
    return {
        ...input.row,
        headers: stringifyJson(nextHeaders),
        updatedAt: now,
    }
}

export async function readRequiredHostedSecretPlainText(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    secretId: string | null
    label: string
}): Promise<string> {
    const plainText = await readHostedSecretPlainText({
        env: input.env,
        workspaceId: input.workspaceId,
        secretId: input.secretId,
    })
    if (!plainText) {
        throw new Error(`${input.label} is missing`)
    }
    return plainText
}

export function emptyGithubSummary(): OperatorConfigSnapshot['github'] {
    return {
        app: {
            configured: false,
            appId: null,
            slug: null,
            name: null,
            clientId: null,
            htmlUrl: null,
            status: null,
            validationMessage: null,
            lastValidatedAt: null,
            updatedAt: null,
            installUrl: null,
        },
        user: {
            connected: false,
            login: null,
            name: null,
            avatarUrl: null,
            htmlUrl: null,
            status: null,
            validationMessage: null,
            lastAuthorizedAt: null,
            updatedAt: null,
        },
        installations: [],
        accounts: [],
    }
}

export function materializedSearchConfig(input: {
    settings: AppSettingsRecord
    enabled: boolean
    braveApiKeyAvailable: boolean
    braveBaseUrl?: string | null
    browserbaseApiKeyAvailable: boolean
    browserbaseBaseUrl?: string | null
}): MaterializedRoomConfiguration['search'] {
    const search = normalizeSearchConfig(input.settings.searchConfig, hostedSearchDefaults)
    const backendUrl = normalizeHostedSearchBackendUrl(search.backendUrl)
    const enabled = input.enabled && search.enabled
    return withSearchProviderEnvKeys(
        {
            ...search,
            enabled,
            backendUrl,
            brave: {
                ...search.brave,
                enabled: enabled && search.brave.enabled,
                baseUrl: input.braveBaseUrl ?? search.brave.baseUrl,
            },
            browserbase: {
                ...search.browserbase,
                enabled: enabled && search.browserbase.enabled,
                baseUrl: input.browserbaseBaseUrl ?? search.browserbase.baseUrl,
            },
        },
        {
            brave: input.braveApiKeyAvailable,
            browserbase: input.browserbaseApiKeyAvailable,
        },
    )
}

export function materializedImageConfig(input: {
    settings: AppSettingsRecord
    config: RoomConfigRecord
    envKey: string | null
}): MaterializedRoomConfiguration['image'] {
    return normalizeImageConfig({
        appConfig: input.settings.imageConfig,
        roomProvider: input.config.imageProvider,
        roomModel: input.config.imageModel,
        envKey: input.envKey,
    })
}

export function resolveEffectiveProviderSummary(input: {
    config: RoomConfigRecord
    settings: AppSettingsRecord
    providers: AppProviderConnectionRecord[]
    mcpConnections: AppMcpConnectionRecord[]
    bindings: RoomMcpBindingRecord[]
    capabilities: CapabilityConfig
    searchReady: boolean
    imageReady: boolean
    codexAuth: CodexAppAuthStatus
    managedOpenRouterAvailable: boolean
}): RoomConfigSnapshot['effective'] {
    const providerResolution = resolveEffectiveProvider({
        config: input.config,
        settings: input.settings,
        providers: input.providers,
        codexAuth: input.codexAuth,
    })
    const selected = providerResolution.provider
    const blockedReasons = [...providerResolution.blockedReasons]
    const usingManagedOpenRouterFallback =
        input.managedOpenRouterAvailable &&
        input.config.providerMode === 'app_default' &&
        !input.settings.defaultProviderConnectionId &&
        selected === null
    if (usingManagedOpenRouterFallback) {
        const defaultProviderIndex = blockedReasons.indexOf('Select an app default provider')
        if (defaultProviderIndex >= 0) {
            blockedReasons.splice(defaultProviderIndex, 1)
        }
    }
    for (const binding of input.bindings.filter((entry) => entry.enabled)) {
        const connection = input.mcpConnections.find(
            (entry) => entry.id === binding.mcpConnectionId,
        )
        if (!connection) {
            blockedReasons.push(
                `MCP binding ${binding.mcpConnectionId} points to a missing connection`,
            )
            continue
        }
        if (connection.authMode === 'bearer' && !connection.credentialSecretId) {
            blockedReasons.push(`MCP connection ${connection.serverKey} requires a bearer token`)
        }
        if (connection.status !== 'ready') {
            blockedReasons.push(
                connection.validationMessage ??
                    `MCP connection ${connection.serverKey} is ${connection.status}`,
            )
        }
    }
    return {
        ready: blockedReasons.length === 0,
        blockedReasons,
        providerSource: providerResolution.source,
        providerLabel: usingManagedOpenRouterFallback
            ? 'Hosted OpenRouter'
            : (selected?.label ?? null),
        provider: usingManagedOpenRouterFallback ? 'openrouter' : (selected?.provider ?? null),
        model: usingManagedOpenRouterFallback
            ? input.settings.defaultModel || 'openrouter/auto'
            : (selected?.defaultModel ?? null),
        mcpServers: input.bindings
            .filter((binding) => binding.enabled)
            .map((binding) => {
                const connection = input.mcpConnections.find(
                    (entry) => entry.id === binding.mcpConnectionId,
                )
                return connection?.serverKey ?? binding.mcpConnectionId
            }),
        capabilities: input.capabilities,
        searchReady: input.searchReady,
        imageReady: input.imageReady,
        codexAuth: providerResolution.codexAuth,
        github: {
            ready: true,
            enabled: false,
            installationId: null,
            accountLogin: null,
            repositories: [],
            message: null,
        },
    }
}

export async function getHostedWorkspaceSettings(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
}): Promise<AppSettingsRecord> {
    const existing = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT
                workspace_id AS workspaceId,
                default_provider_connection_id AS defaultProviderConnectionId,
                default_model AS defaultModel,
                capability_defaults AS capabilityDefaults,
                search_config AS searchConfig,
                image_config AS imageConfig,
                onboarding_completed_at AS onboardingCompletedAt,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM hosted_workspace_settings
            WHERE workspace_id = ?1
        `,
    )
        .bind(input.workspaceId)
        .first<HostedWorkspaceSettingsRow>()
    if (existing) {
        return mapSettings(existing)
    }
    const now = nowIso()
    await input.env.AGENT_ROOM_DB.prepare(
        `
            INSERT INTO hosted_workspace_settings (
                workspace_id,
                default_provider_connection_id,
                default_model,
                capability_defaults,
                search_config,
                image_config,
                onboarding_completed_at,
                created_at,
                updated_at
            )
            VALUES (?1, NULL, NULL, ?2, ?3, ?4, NULL, ?5, ?5)
        `,
    )
        .bind(
            input.workspaceId,
            stringifyJson(capabilityConfigToJson(defaultCapabilities)),
            stringifyJson(defaultSearchConfig),
            stringifyJson(defaultImageConfig),
            now,
        )
        .run()
    return getHostedWorkspaceSettings(input)
}

export async function listHostedProviders(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
}): Promise<AppProviderConnectionRecord[]> {
    const rows = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT
                id,
                label,
                provider,
                auth_mode AS authMode,
                api,
                base_url AS baseUrl,
                default_model AS defaultModel,
                fallback_models AS fallbackModels,
                credential_secret_id AS credentialSecretId,
                status,
                validation_message AS validationMessage,
                last_validated_at AS lastValidatedAt,
                created_by_user_id AS createdByUserId,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM hosted_provider_connection
            WHERE workspace_id = ?1
            ORDER BY updated_at DESC
        `,
    )
        .bind(input.workspaceId)
        .all<HostedProviderRow>()
    return rows.results.map(mapProvider)
}

export async function findHostedProvider(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    id: string
}): Promise<AppProviderConnectionRecord | null> {
    const row = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT
                id,
                label,
                provider,
                auth_mode AS authMode,
                api,
                base_url AS baseUrl,
                default_model AS defaultModel,
                fallback_models AS fallbackModels,
                credential_secret_id AS credentialSecretId,
                status,
                validation_message AS validationMessage,
                last_validated_at AS lastValidatedAt,
                created_by_user_id AS createdByUserId,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM hosted_provider_connection
            WHERE workspace_id = ?1
              AND id = ?2
        `,
    )
        .bind(input.workspaceId, input.id)
        .first<HostedProviderRow>()
    return row ? mapProvider(row) : null
}

export async function listHostedMcp(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
}): Promise<AppMcpConnectionRecord[]> {
    const rows = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT
                id,
                name,
                server_key AS serverKey,
                transport,
                command,
                args,
                url,
                headers,
                auth_mode AS authMode,
                credential_secret_id AS credentialSecretId,
                allowed_tools AS allowedTools,
                status,
                validation_message AS validationMessage,
                last_validated_at AS lastValidatedAt,
                created_by_user_id AS createdByUserId,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM hosted_mcp_connection
            WHERE workspace_id = ?1
            ORDER BY updated_at DESC
        `,
    )
        .bind(input.workspaceId)
        .all<HostedMcpRow>()
    const migratedRows = await Promise.all(
        rows.results.map((row) =>
            ensureHostedMcpHeaderSecrets({
                env: input.env,
                workspaceId: input.workspaceId,
                row,
            }),
        ),
    )
    return migratedRows.map(mapMcp)
}

export async function findHostedMcp(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    id: string
}): Promise<AppMcpConnectionRecord | null> {
    const row = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT
                id,
                name,
                server_key AS serverKey,
                transport,
                command,
                args,
                url,
                headers,
                auth_mode AS authMode,
                credential_secret_id AS credentialSecretId,
                allowed_tools AS allowedTools,
                status,
                validation_message AS validationMessage,
                last_validated_at AS lastValidatedAt,
                created_by_user_id AS createdByUserId,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM hosted_mcp_connection
            WHERE workspace_id = ?1
              AND id = ?2
        `,
    )
        .bind(input.workspaceId, input.id)
        .first<HostedMcpRow>()
    if (!row) {
        return null
    }
    return mapMcp(
        await ensureHostedMcpHeaderSecrets({
            env: input.env,
            workspaceId: input.workspaceId,
            row,
        }),
    )
}

export async function getHostedOperatorConfigSnapshot(input: {
    env: AgentRoomHostedEnv
    actor: HostedActor
}): Promise<OperatorConfigSnapshot> {
    const [settings, providers, mcpConnections] = await Promise.all([
        getHostedWorkspaceSettings({
            env: input.env,
            workspaceId: input.actor.workspaceId,
        }),
        listHostedProviders({
            env: input.env,
            workspaceId: input.actor.workspaceId,
        }),
        listHostedMcp({
            env: input.env,
            workspaceId: input.actor.workspaceId,
        }),
    ])
    const codexAuth = await resolveHostedCodexStatus({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        providers,
    })
    const readyProviders = listReadyProviders(providers, codexAuth)
    const managedOpenRouterAvailable = Boolean(
        input.env.AGENT_ROOM_HOSTED_OPENROUTER_API_KEY?.trim(),
    )
    return {
        settings: summarizeHostedSettings(settings, input.env),
        codexAuth,
        providerCatalog,
        providers: providers.map(summarizeHostedProvider),
        mcpConnections: mcpConnections.map(summarizeHostedMcp),
        github: emptyGithubSummary(),
        onboarding: {
            completed: settings.onboardingCompletedAt !== null,
            hasProvider: readyProviders.length > 0,
            hasDefaultProvider: settings.defaultProviderConnectionId !== null,
            managedOpenRouterAvailable,
        },
    }
}

interface HostedWorkspaceSettingsRow {
    workspaceId: string
    defaultProviderConnectionId: string | null
    defaultModel: string | null
    capabilityDefaults: string
    searchConfig: string
    imageConfig: string
    onboardingCompletedAt: string | null
    createdAt: string
    updatedAt: string
}

interface HostedProviderRow {
    id: string
    label: string
    provider: string
    authMode: string
    api: string
    baseUrl: string | null
    defaultModel: string
    fallbackModels: string
    credentialSecretId: string | null
    status: string
    validationMessage: string | null
    lastValidatedAt: string | null
    createdByUserId: string | null
    createdAt: string
    updatedAt: string
}

interface HostedMcpRow {
    id: string
    name: string
    serverKey: string
    transport: string
    command: string | null
    args: string
    url: string | null
    headers: string
    authMode: string
    credentialSecretId: string | null
    allowedTools: string
    status: string
    validationMessage: string | null
    lastValidatedAt: string | null
    createdByUserId: string | null
    createdAt: string
    updatedAt: string
}
