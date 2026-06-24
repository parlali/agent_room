import { randomUUID } from 'node:crypto'
import type {
    AppMcpConnectionRecord,
    AppProviderConnectionRecord,
    JsonValue,
} from '#/domain/domain-types'
import { normalizeSearchConfig, searchProviderSecretId } from '../configuration/capabilities'
import { inspectCodexPiAuthJson } from '../configuration/codex-auth'
import type {
    AppCapabilitySettingsSaveInput,
    AppDefaultsSaveInput,
    McpConnectionSummary,
    OperatorConfigSnapshot,
    ProviderConnectionSummary,
} from '../configuration/operator-configuration'
import {
    imageConfigRecord,
    imageConfigSecretId,
    nullableText,
    parseArgs,
    parseCsv,
} from '../configuration/operator-configuration/helpers'
import {
    assertSupportedProvider,
    assertSupportedProviderApi,
    inferProviderAuthMode,
    normalizeProviderId,
    normalizeProviderModel,
    providerRequiresStoredCredential,
    resolveProviderBaseUrl,
    supportedProviderCatalogEntry,
} from '../configuration/provider-config'
import type { AgentRoomHostedEnv } from './bindings'
import { appendHostedAudit } from './hosted-audit'
import {
    validateHostedMcpConnection,
    validateHostedProviderConnection,
    validateHostedSearchCredential,
} from './hosted-connection-validation'
import { assertChanged } from './hosted-d1'
import type { HostedActor } from './hosted-auth'
import { nowIso, stringifyJson, toJsonValue } from './hosted-json'
import {
    deleteHostedMcpHeaderSecrets,
    hostedMcpHeaderSecretId,
    hostedMcpHeadersFromInput,
} from './hosted-mcp-header-secrets'
import { assertHostedRuntimeEgressUrlLiteral } from './hosted-runtime-egress-policy'
import {
    findHostedMcp,
    findHostedProvider,
    getHostedOperatorConfigSnapshot,
    getHostedWorkspaceSettings,
    hostedSearchDefaults,
    normalizeHostedSearchBackendUrl,
    summarizeHostedMcp,
    summarizeHostedProvider,
} from './hosted-operator-config-service'
import {
    listRunningHostedRoomIdsForMcpConnection,
    rematerializeRunningHostedRooms,
} from './hosted-room-service'
import {
    deleteHostedSecret,
    readHostedSecretPlainText,
    upsertHostedSecret,
} from './hosted-secret-store'

export async function saveHostedProviderConnection(input: {
    env: AgentRoomHostedEnv
    actor: HostedActor
    data: {
        id?: string
        label: string
        provider: string
        defaultModel: string
        fallbackModels: string[]
        apiKey?: string
        makeDefault?: boolean
    }
}): Promise<ProviderConnectionSummary> {
    const provider = normalizeProviderId(input.data.provider)
    assertSupportedProvider(provider)
    const catalogEntry = supportedProviderCatalogEntry(provider)
    if (!catalogEntry) {
        throw new Error(`Provider ${provider} is not supported by this Agent Room build`)
    }
    const api = catalogEntry.api
    assertSupportedProviderApi(provider, api)
    const existing = input.data.id
        ? await findHostedProvider({
              env: input.env,
              workspaceId: input.actor.workspaceId,
              id: input.data.id,
          })
        : null
    if (input.data.id && !existing) {
        throw new Error('Provider connection not found')
    }
    if (existing && existing.provider !== provider) {
        throw new Error('Provider type cannot be changed for an existing connection')
    }
    const id = existing?.id ?? randomUUID()
    const authMode = inferProviderAuthMode({ provider, api })
    const requiresCredential =
        providerRequiresStoredCredential({
            provider,
            authMode,
        }) || provider === 'openai-codex'
    const credentialInput = input.data.apiKey?.trim() ?? ''
    let credentialSecretId = existing?.credentialSecretId ?? null
    if (credentialInput) {
        const plainText = credentialInput
        if (provider === 'openai-codex') {
            const authStatus = inspectCodexPiAuthJson({
                authJson: plainText,
                requiresStoredCredential: true,
            })
            if (!authStatus.ready) {
                throw new Error(authStatus.message)
            }
        }
        credentialSecretId = await upsertHostedSecret({
            env: input.env,
            workspaceId: input.actor.workspaceId,
            keyName: `app_provider:${id}:credential`,
            plainText,
        })
    } else if (requiresCredential && !credentialSecretId) {
        throw new Error(
            provider === 'openai-codex'
                ? 'Codex auth JSON is required for hosted Codex connection'
                : 'Provider API key is required for a new provider connection',
        )
    }
    const defaultModel = normalizeProviderModel(provider, input.data.defaultModel)
    const settings = await getHostedWorkspaceSettings({
        env: input.env,
        workspaceId: input.actor.workspaceId,
    })
    const now = nowIso()
    const nowDate = new Date(now)
    const providerRecord: AppProviderConnectionRecord = {
        id,
        label: input.data.label.trim(),
        provider,
        authMode,
        api,
        baseUrl: resolveProviderBaseUrl({ provider, api, baseUrl: null }),
        defaultModel,
        fallbackModels: input.data.fallbackModels.map((model) =>
            normalizeProviderModel(provider, model),
        ),
        credentialSecretId,
        status: 'unchecked',
        validationMessage: null,
        lastValidatedAt: null,
        createdByUserId: input.actor.userId,
        createdAt: existing?.createdAt ?? nowDate,
        updatedAt: nowDate,
    }
    const credentialPlainText =
        credentialInput ||
        (credentialSecretId
            ? await readHostedSecretPlainText({
                  env: input.env,
                  workspaceId: input.actor.workspaceId,
                  secretId: credentialSecretId,
              })
            : null)
    const validation = await validateHostedProviderConnection({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        settings,
        provider: providerRecord,
        credentialPlainText,
    })
    const status = validation.status
    const validationMessage = validation.message
    await input.env.AGENT_ROOM_DB.prepare(
        `
            INSERT INTO hosted_provider_connection (
                id,
                workspace_id,
                label,
                provider,
                auth_mode,
                api,
                base_url,
                default_model,
                fallback_models,
                credential_secret_id,
                status,
                validation_message,
                last_validated_at,
                created_by_user_id,
                created_at,
                updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
            ON CONFLICT(id) DO UPDATE SET
                label = excluded.label,
                default_model = excluded.default_model,
                fallback_models = excluded.fallback_models,
                credential_secret_id = excluded.credential_secret_id,
                status = excluded.status,
                validation_message = excluded.validation_message,
                last_validated_at = excluded.last_validated_at,
                updated_at = excluded.updated_at
            WHERE hosted_provider_connection.workspace_id = excluded.workspace_id
        `,
    )
        .bind(
            id,
            input.actor.workspaceId,
            input.data.label.trim(),
            provider,
            authMode,
            api,
            providerRecord.baseUrl,
            defaultModel,
            stringifyJson(providerRecord.fallbackModels),
            credentialSecretId,
            status,
            validationMessage,
            now,
            input.actor.userId,
            providerRecord.createdAt.toISOString(),
            providerRecord.updatedAt.toISOString(),
        )
        .run()
    if (status === 'ready' && (input.data.makeDefault || !settings.defaultProviderConnectionId)) {
        await updateHostedWorkspaceSettings(input.env, input.actor.workspaceId, {
            defaultProviderConnectionId: id,
            defaultModel: null,
            onboardingCompletedAt: settings.onboardingCompletedAt ?? new Date(),
        })
    }
    await appendHostedAudit({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        actorUserId: input.actor.userId,
        roomId: null,
        action: 'provider_connection.saved',
        payload: {
            providerConnectionId: id,
            provider,
            authMode,
            status,
            hasCredential: credentialSecretId !== null,
            madeDefault:
                status === 'ready' &&
                (input.data.makeDefault || !settings.defaultProviderConnectionId),
        },
    })
    if (
        existing ||
        (status === 'ready' && (input.data.makeDefault || !settings.defaultProviderConnectionId))
    ) {
        await rematerializeRunningHostedRooms({
            env: input.env,
            actor: input.actor,
        })
    }
    const saved = await findHostedProvider({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        id,
    })
    if (!saved) {
        throw new Error('Hosted provider connection was not saved')
    }
    return summarizeHostedProvider(saved)
}

async function updateHostedWorkspaceSettings(
    env: AgentRoomHostedEnv,
    workspaceId: string,
    patch: Partial<{
        defaultProviderConnectionId: string | null
        defaultModel: string | null
        capabilityDefaults: JsonValue
        searchConfig: JsonValue
        imageConfig: JsonValue
        onboardingCompletedAt: Date | null
    }>,
): Promise<void> {
    const current = await getHostedWorkspaceSettings({ env, workspaceId })
    const now = nowIso()
    await env.AGENT_ROOM_DB.prepare(
        `
            UPDATE hosted_workspace_settings
            SET default_provider_connection_id = ?1,
                default_model = ?2,
                capability_defaults = ?3,
                search_config = ?4,
                image_config = ?5,
                onboarding_completed_at = ?6,
                updated_at = ?7
            WHERE workspace_id = ?8
        `,
    )
        .bind(
            patch.defaultProviderConnectionId !== undefined
                ? patch.defaultProviderConnectionId
                : current.defaultProviderConnectionId,
            patch.defaultModel !== undefined ? patch.defaultModel : current.defaultModel,
            stringifyJson(patch.capabilityDefaults ?? current.capabilityDefaults),
            stringifyJson(patch.searchConfig ?? current.searchConfig),
            stringifyJson(patch.imageConfig ?? current.imageConfig),
            patch.onboardingCompletedAt !== undefined
                ? (patch.onboardingCompletedAt?.toISOString() ?? null)
                : (current.onboardingCompletedAt?.toISOString() ?? null),
            now,
            workspaceId,
        )
        .run()
}

type HostedSearchSecretProvider = 'brave' | 'browserbase'

interface HostedSearchSecretInput {
    env: AgentRoomHostedEnv
    workspaceId: string
    provider: HostedSearchSecretProvider
    enabled: boolean
    apiKey: string | undefined
    currentConfig: JsonValue
}

interface ResolvedHostedSearchCredential {
    secretId: string | null
    plainText: string | null
    writeNewSecret: boolean
}

async function resolveHostedSearchCredential(
    input: HostedSearchSecretInput,
): Promise<ResolvedHostedSearchCredential> {
    if (!input.enabled) {
        return {
            secretId: null,
            plainText: null,
            writeNewSecret: false,
        }
    }
    const apiKey = input.apiKey?.trim() ?? ''
    if (apiKey) {
        return {
            secretId: null,
            plainText: apiKey,
            writeNewSecret: true,
        }
    }
    const currentSecretId = searchProviderSecretId({
        config: input.currentConfig,
        provider: input.provider,
    })
    if (currentSecretId) {
        const existing = await readHostedSecretPlainText({
            env: input.env,
            workspaceId: input.workspaceId,
            secretId: currentSecretId,
        })
        if (!existing) {
            throw new Error(`${input.provider} search API key is missing; enter a new key`)
        }
        return {
            secretId: currentSecretId,
            plainText: existing,
            writeNewSecret: false,
        }
    }
    throw new Error(`${input.provider} search API key is required when enabling search`)
}

async function validateResolvedHostedSearchCredential(input: {
    provider: HostedSearchSecretProvider
    searchConfig: unknown
    credential: ResolvedHostedSearchCredential
}): Promise<void> {
    if (!input.credential.plainText) {
        return
    }
    const validation = await validateHostedSearchCredential({
        provider: input.provider,
        search: normalizeSearchConfig(input.searchConfig, hostedSearchDefaults),
        apiKey: input.credential.plainText,
    })
    if (validation.status !== 'ready') {
        throw new Error(validation.message)
    }
}

async function writeHostedSearchSecretId(input: {
    credential: ResolvedHostedSearchCredential
    env: AgentRoomHostedEnv
    workspaceId: string
    provider: HostedSearchSecretProvider
    enabled: boolean
}): Promise<string | null> {
    if (!input.enabled) {
        return null
    }
    if (input.credential.writeNewSecret && input.credential.plainText) {
        return upsertHostedSecret({
            env: input.env,
            workspaceId: input.workspaceId,
            keyName: `app_search:${input.provider}`,
            plainText: input.credential.plainText,
        })
    }
    return input.credential.secretId
}

async function resolveHostedImageSecretId(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    apiKey: string
    currentProvider: string | null
    currentSecretId: string | null
    provider: string
}): Promise<string> {
    if (input.apiKey) {
        return upsertHostedSecret({
            env: input.env,
            workspaceId: input.workspaceId,
            keyName: 'app_image',
            plainText: input.apiKey,
        })
    }
    if (input.currentProvider === input.provider && input.currentSecretId) {
        const existing = await readHostedSecretPlainText({
            env: input.env,
            workspaceId: input.workspaceId,
            secretId: input.currentSecretId,
        })
        if (!existing) {
            throw new Error('Saved image API key is missing; enter a new image API key')
        }
        return input.currentSecretId
    }
    throw new Error('Image API key is required when enabling an app image provider')
}

async function deleteStaleHostedAppCapabilitySecrets(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    currentSearchConfig: JsonValue
    currentImageSecretId: string | null
    retainedSecretIds: Set<string>
}): Promise<void> {
    const staleSecretIds = [
        searchProviderSecretId({
            config: input.currentSearchConfig,
            provider: 'brave',
        }),
        searchProviderSecretId({
            config: input.currentSearchConfig,
            provider: 'browserbase',
        }),
        input.currentImageSecretId,
    ].filter(
        (secretId): secretId is string =>
            typeof secretId === 'string' && !input.retainedSecretIds.has(secretId),
    )
    for (const secretId of [...new Set(staleSecretIds)]) {
        await deleteHostedSecret({
            env: input.env,
            workspaceId: input.workspaceId,
            secretId,
        })
    }
}

export async function updateHostedAppDefaults(input: {
    env: AgentRoomHostedEnv
    actor: HostedActor
    data: AppDefaultsSaveInput
}): Promise<OperatorConfigSnapshot> {
    if (input.data.defaultProviderConnectionId) {
        const provider = await findHostedProvider({
            env: input.env,
            workspaceId: input.actor.workspaceId,
            id: input.data.defaultProviderConnectionId,
        })
        if (!provider) {
            throw new Error('Provider connection not found')
        }
        if (provider.status !== 'ready') {
            throw new Error('Default provider connection must be ready')
        }
    }
    await updateHostedWorkspaceSettings(input.env, input.actor.workspaceId, {
        defaultProviderConnectionId: input.data.defaultProviderConnectionId,
        defaultModel: input.data.defaultModel,
        onboardingCompletedAt: input.data.onboardingCompleted ? new Date() : null,
    })
    await appendHostedAudit({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        actorUserId: input.actor.userId,
        roomId: null,
        action: 'operator.defaults.saved',
        payload: {
            defaultProviderConnectionId: input.data.defaultProviderConnectionId,
            defaultModel: input.data.defaultModel,
            onboardingCompleted: input.data.onboardingCompleted,
        },
    })
    await rematerializeRunningHostedRooms({
        env: input.env,
        actor: input.actor,
    })
    return getHostedOperatorConfigSnapshot(input)
}

export async function updateHostedAppCapabilitySettings(input: {
    env: AgentRoomHostedEnv
    actor: HostedActor
    data: AppCapabilitySettingsSaveInput
}): Promise<OperatorConfigSnapshot> {
    const settings = await getHostedWorkspaceSettings({
        env: input.env,
        workspaceId: input.actor.workspaceId,
    })
    const nextSearch = input.data.search
        ? {
              ...input.data.search,
              backendUrl: normalizeHostedSearchBackendUrl(input.data.search.backendUrl),
          }
        : null
    const currentImageProvider = imageConfigRecord(settings.imageConfig).provider
    const currentImageSecretId = imageConfigSecretId(settings.imageConfig)
    const imageProvider = input.data.image.provider
    const imageModel = imageProvider ? nullableText(input.data.image.model) : null
    const imageApiKey = input.data.image.apiKey?.trim() ?? ''

    if (imageProvider && !imageModel) {
        throw new Error('Default image model is required when image generation is enabled')
    }

    const braveSearchSecretInput = nextSearch
        ? {
              env: input.env,
              workspaceId: input.actor.workspaceId,
              provider: 'brave' as const,
              enabled: nextSearch.brave.enabled,
              apiKey: nextSearch.brave.apiKey,
              currentConfig: settings.searchConfig,
          }
        : null
    const browserbaseSearchSecretInput = nextSearch
        ? {
              env: input.env,
              workspaceId: input.actor.workspaceId,
              provider: 'browserbase' as const,
              enabled: nextSearch.browserbase.enabled,
              apiKey: nextSearch.browserbase.apiKey,
              currentConfig: settings.searchConfig,
          }
        : null
    const [braveCredential, browserbaseCredential] =
        braveSearchSecretInput && browserbaseSearchSecretInput
            ? await Promise.all([
                  resolveHostedSearchCredential(braveSearchSecretInput),
                  resolveHostedSearchCredential(browserbaseSearchSecretInput),
              ])
            : [
                  {
                      secretId: searchProviderSecretId({
                          config: settings.searchConfig,
                          provider: 'brave',
                      }),
                      plainText: null,
                      writeNewSecret: false,
                  },
                  {
                      secretId: searchProviderSecretId({
                          config: settings.searchConfig,
                          provider: 'browserbase',
                      }),
                      plainText: null,
                      writeNewSecret: false,
                  },
              ]
    if (nextSearch) {
        await validateResolvedHostedSearchCredential({
            provider: 'brave',
            searchConfig: nextSearch,
            credential: braveCredential,
        })
        await validateResolvedHostedSearchCredential({
            provider: 'browserbase',
            searchConfig: nextSearch,
            credential: browserbaseCredential,
        })
    }
    const [braveSecretId, browserbaseSecretId] =
        braveSearchSecretInput && browserbaseSearchSecretInput
            ? await Promise.all([
                  writeHostedSearchSecretId({
                      ...braveSearchSecretInput,
                      credential: braveCredential,
                  }),
                  writeHostedSearchSecretId({
                      ...browserbaseSearchSecretInput,
                      credential: browserbaseCredential,
                  }),
              ])
            : [braveCredential.secretId, browserbaseCredential.secretId]
    const imageSecretId =
        imageProvider && imageModel
            ? await resolveHostedImageSecretId({
                  env: input.env,
                  workspaceId: input.actor.workspaceId,
                  apiKey: imageApiKey,
                  currentProvider:
                      typeof currentImageProvider === 'string' ? currentImageProvider : null,
                  currentSecretId: currentImageSecretId,
                  provider: imageProvider,
              })
            : null
    const searchConfig = nextSearch
        ? {
              enabled: nextSearch.enabled,
              backendUrl: nextSearch.backendUrl,
              defaultResultCount: nextSearch.defaultResultCount,
              timeoutMs: nextSearch.timeoutMs,
              maxSearchesPerRun: nextSearch.maxSearchesPerRun,
              brave: {
                  enabled: nextSearch.brave.enabled,
                  country: nextSearch.brave.country,
                  searchLang: nextSearch.brave.searchLang,
                  safeSearch: nextSearch.brave.safeSearch,
                  timeoutMs: nextSearch.brave.timeoutMs,
                  resultCount: nextSearch.brave.resultCount,
                  secretId: braveSecretId,
              },
              browserbase: {
                  enabled: nextSearch.browserbase.enabled,
                  timeoutMs: nextSearch.browserbase.timeoutMs,
                  resultCount: nextSearch.browserbase.resultCount,
                  secretId: browserbaseSecretId,
              },
          }
        : settings.searchConfig
    await updateHostedWorkspaceSettings(input.env, input.actor.workspaceId, {
        capabilityDefaults: toJsonValue(input.data.capabilityDefaults),
        searchConfig: toJsonValue(searchConfig),
        imageConfig: {
            provider: imageProvider,
            model: imageModel,
            secretId: imageSecretId,
        },
    })
    await deleteStaleHostedAppCapabilitySecrets({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        currentSearchConfig: settings.searchConfig,
        currentImageSecretId,
        retainedSecretIds: new Set(
            [braveSecretId, browserbaseSecretId, imageSecretId].filter(
                (secretId): secretId is string => secretId !== null,
            ),
        ),
    })
    await appendHostedAudit({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        actorUserId: input.actor.userId,
        roomId: null,
        action: 'operator.capabilities.saved',
        payload: {
            capabilityDefaults: toJsonValue(input.data.capabilityDefaults),
            search: nextSearch
                ? {
                      enabled: nextSearch.enabled,
                      backendUrl: nextSearch.backendUrl,
                      brave: {
                          enabled: nextSearch.brave.enabled,
                          credentialMode: braveSecretId ? 'stored' : 'none',
                      },
                      browserbase: {
                          enabled: nextSearch.browserbase.enabled,
                          credentialMode: browserbaseSecretId ? 'stored' : 'none',
                      },
                  }
                : null,
            image: {
                provider: imageProvider,
                model: imageModel,
                hasCredential: imageSecretId !== null,
            },
        },
    })
    await rematerializeRunningHostedRooms({
        env: input.env,
        actor: input.actor,
    })
    return getHostedOperatorConfigSnapshot(input)
}

export async function deleteHostedProviderConnection(input: {
    env: AgentRoomHostedEnv
    actor: HostedActor
    id: string
}): Promise<{ id: string }> {
    const provider = await findHostedProvider({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        id: input.id,
    })
    if (!provider) {
        throw new Error('Provider connection does not exist')
    }
    const settings = await getHostedWorkspaceSettings({
        env: input.env,
        workspaceId: input.actor.workspaceId,
    })
    if (settings.defaultProviderConnectionId === input.id) {
        throw new Error('Provider connection is still configured as the app default')
    }
    const roomReference = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT room_id AS roomId
            FROM hosted_room_config
            WHERE workspace_id = ?1
              AND provider_connection_id = ?2
            LIMIT 1
        `,
    )
        .bind(input.actor.workspaceId, input.id)
        .first<{ roomId: string }>()
    if (roomReference) {
        throw new Error('Provider connection is still configured on a room')
    }
    const result = await input.env.AGENT_ROOM_DB.prepare(
        `
            DELETE FROM hosted_provider_connection
            WHERE workspace_id = ?1
              AND id = ?2
        `,
    )
        .bind(input.actor.workspaceId, input.id)
        .run()
    assertChanged(result, 'Provider connection does not exist')
    await deleteHostedSecret({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        secretId: provider.credentialSecretId,
    })
    await appendHostedAudit({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        actorUserId: input.actor.userId,
        roomId: null,
        action: 'provider_connection.deleted',
        payload: {
            providerConnectionId: provider.id,
            provider: provider.provider,
            authMode: provider.authMode,
            hadCredential: provider.credentialSecretId !== null,
        },
    })
    return { id: input.id }
}

export async function saveHostedMcpConnection(input: {
    env: AgentRoomHostedEnv
    actor: HostedActor
    data: {
        id?: string
        name: string
        serverKey: string
        transport: AppMcpConnectionRecord['transport']
        command?: string | null
        argsText?: string
        url?: string | null
        headersText?: string
        authMode: AppMcpConnectionRecord['authMode']
        bearerToken?: string
        allowedToolsText?: string
    }
}): Promise<McpConnectionSummary> {
    const existing = input.data.id
        ? await findHostedMcp({
              env: input.env,
              workspaceId: input.actor.workspaceId,
              id: input.data.id,
          })
        : null
    if (input.data.id && !existing) {
        throw new Error('MCP connection not found')
    }
    const id = existing?.id ?? randomUUID()
    const args = parseArgs(input.data.argsText)
    const url = input.data.url?.trim() || null
    if ((input.data.transport === 'http' || input.data.transport === 'streamable_http') && !url) {
        throw new Error('MCP HTTP transport requires a URL')
    }
    if ((input.data.transport === 'http' || input.data.transport === 'streamable_http') && url) {
        assertHostedRuntimeEgressUrlLiteral(url, 'MCP connection')
    }
    const headers = await hostedMcpHeadersFromInput({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        connectionId: id,
        existing,
        headersText: input.data.headersText,
    })
    const allowedTools = parseCsv(input.data.allowedToolsText)
    const bearerToken = input.data.bearerToken?.trim() ?? ''
    const credentialSecretId =
        input.data.authMode === 'bearer'
            ? bearerToken
                ? await upsertHostedSecret({
                      env: input.env,
                      workspaceId: input.actor.workspaceId,
                      keyName: `app_mcp:${id}:bearer`,
                      plainText: bearerToken,
                  })
                : existing?.authMode === 'bearer' && existing.credentialSecretId
                  ? existing.credentialSecretId
                  : null
            : null
    if (input.data.authMode === 'bearer' && !credentialSecretId) {
        throw new Error('Bearer token is required for hosted MCP bearer auth')
    }
    const now = nowIso()
    const nowDate = new Date(now)
    const connectionRecord: AppMcpConnectionRecord = {
        id,
        name: input.data.name.trim(),
        serverKey: input.data.serverKey.trim(),
        transport: input.data.transport,
        command: input.data.command?.trim() || null,
        args,
        url,
        headers,
        authMode: input.data.authMode,
        credentialSecretId,
        allowedTools,
        status: 'unchecked',
        validationMessage: null,
        lastValidatedAt: null,
        createdByUserId: input.actor.userId,
        createdAt: existing?.createdAt ?? nowDate,
        updatedAt: nowDate,
    }
    const validation = await validateHostedMcpConnection({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        connection: connectionRecord,
    })
    await input.env.AGENT_ROOM_DB.prepare(
        `
            INSERT INTO hosted_mcp_connection (
                id,
                workspace_id,
                name,
                server_key,
                transport,
                command,
                args,
                url,
                headers,
                auth_mode,
                credential_secret_id,
                allowed_tools,
                status,
                validation_message,
                last_validated_at,
                created_by_user_id,
                created_at,
                updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                server_key = excluded.server_key,
                transport = excluded.transport,
                command = excluded.command,
                args = excluded.args,
                url = excluded.url,
                headers = excluded.headers,
                auth_mode = excluded.auth_mode,
                credential_secret_id = excluded.credential_secret_id,
                allowed_tools = excluded.allowed_tools,
                status = excluded.status,
                validation_message = excluded.validation_message,
                last_validated_at = excluded.last_validated_at,
                updated_at = excluded.updated_at
            WHERE hosted_mcp_connection.workspace_id = excluded.workspace_id
        `,
    )
        .bind(
            id,
            input.actor.workspaceId,
            connectionRecord.name,
            connectionRecord.serverKey,
            connectionRecord.transport,
            connectionRecord.command,
            stringifyJson(args),
            url,
            stringifyJson(headers),
            connectionRecord.authMode,
            credentialSecretId,
            stringifyJson(allowedTools),
            validation.status,
            validation.message,
            now,
            input.actor.userId,
            connectionRecord.createdAt.toISOString(),
            connectionRecord.updatedAt.toISOString(),
        )
        .run()
    const saved = await findHostedMcp({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        id,
    })
    if (!saved) {
        throw new Error('Hosted MCP connection was not saved')
    }
    if (existing?.credentialSecretId && existing.credentialSecretId !== saved.credentialSecretId) {
        await deleteHostedSecret({
            env: input.env,
            workspaceId: input.actor.workspaceId,
            secretId: existing.credentialSecretId,
        })
    }
    if (existing) {
        await deleteHostedMcpHeaderSecrets({
            env: input.env,
            workspaceId: input.actor.workspaceId,
            headers: existing.headers,
            keepSecretIds: new Set(
                Object.values(headers)
                    .map(hostedMcpHeaderSecretId)
                    .filter((secretId): secretId is string => secretId !== null),
            ),
        })
    }
    await appendHostedAudit({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        actorUserId: input.actor.userId,
        roomId: null,
        action: 'mcp_connection.saved',
        payload: {
            mcpConnectionId: id,
            serverKey: saved.serverKey,
            transport: saved.transport,
            authMode: saved.authMode,
            status: saved.status,
            hasCredential: saved.credentialSecretId !== null,
        },
    })
    if (existing) {
        await rematerializeRunningHostedRooms({
            env: input.env,
            actor: input.actor,
            roomIds: await listRunningHostedRoomIdsForMcpConnection({
                env: input.env,
                workspaceId: input.actor.workspaceId,
                mcpConnectionId: id,
            }),
        })
    }
    return summarizeHostedMcp(saved)
}

export async function deleteHostedMcpConnection(input: {
    env: AgentRoomHostedEnv
    actor: HostedActor
    id: string
}): Promise<{ id: string }> {
    const mcp = await findHostedMcp({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        id: input.id,
    })
    if (!mcp) {
        throw new Error('MCP connection does not exist')
    }
    const roomReference = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT room_id AS roomId
            FROM hosted_room_mcp_binding
            WHERE workspace_id = ?1
              AND mcp_connection_id = ?2
            LIMIT 1
        `,
    )
        .bind(input.actor.workspaceId, input.id)
        .first<{ roomId: string }>()
    if (roomReference) {
        throw new Error('MCP connection is still bound to a room')
    }
    const result = await input.env.AGENT_ROOM_DB.prepare(
        `
            DELETE FROM hosted_mcp_connection
            WHERE workspace_id = ?1
              AND id = ?2
        `,
    )
        .bind(input.actor.workspaceId, input.id)
        .run()
    assertChanged(result, 'MCP connection does not exist')
    await deleteHostedSecret({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        secretId: mcp.credentialSecretId,
    })
    await deleteHostedMcpHeaderSecrets({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        headers: mcp.headers,
    })
    await appendHostedAudit({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        actorUserId: input.actor.userId,
        roomId: null,
        action: 'mcp_connection.deleted',
        payload: {
            mcpConnectionId: mcp.id,
            serverKey: mcp.serverKey,
            transport: mcp.transport,
            authMode: mcp.authMode,
            hadCredential: mcp.credentialSecretId !== null,
        },
    })
    return { id: input.id }
}
