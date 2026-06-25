import { randomUUID } from 'node:crypto'
import type { AppProviderConnectionRecord } from '#/domain/domain-types'
import type { ProviderConnectionSummary } from '../configuration/operator-configuration'
import { inspectCodexPiAuthJson } from '../configuration/codex-auth'
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
import type { HostedActor } from './hosted-auth'
import { validateHostedProviderConnection } from './hosted-connection-validation'
import { assertChanged } from './hosted-d1'
import { nowIso, stringifyJson } from './hosted-json'
import {
    findHostedProvider,
    getHostedWorkspaceSettings,
    summarizeHostedProvider,
} from './hosted-operator-config-service'
import { rematerializeRunningHostedRooms } from './hosted-room-service'
import {
    deleteHostedSecret,
    readHostedSecretPlainText,
    upsertHostedSecret,
} from './hosted-secret-store'
import { updateHostedWorkspaceSettings } from './hosted-workspace-settings-write'

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
