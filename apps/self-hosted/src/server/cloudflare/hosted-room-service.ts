import { randomUUID } from 'node:crypto'
import type {
    ImageProviderId,
    RoomMode,
    RoomProviderMode,
    userRoomSecretPurposes,
} from '#/domain/domain-types'
import { roomModes, roomProviderModes } from '#/domain/domain-types'
import {
    mergeCapabilities,
    normalizeImageConfig,
    normalizeSearchConfig,
    searchProviderSecretId,
} from '../configuration/capabilities'
import { hostedPlanAllowsManagedBrowserbase } from '@agent-room/billing'
import { upperSnake } from '../configuration/provider-config'
import type { RoomConfigSnapshot, RoomSecretSummary } from '../configuration/operator-configuration'
import { imageConfigSecretId } from '../configuration/operator-configuration/helpers'
import { assertNoReservedRoomRuntimeEnvKeys } from '../security/process-env'
import { appendHostedAudit } from './hosted-audit'
import type { AgentRoomHostedEnv } from './bindings'
import { resolveHostedConfig } from './hosted-config'
import { readHostedBillingAccount } from './hosted-billing-repository'
import { isHostedBillingPlanStatusActive } from './hosted-billing-types'
import { resolveHostedManagedModelAvailable } from './hosted-model-policy'
import { upsertHostedSecret } from './hosted-secret-store'
import { nowIso, stringifyJson, toJsonValue } from './hosted-json'
import type { HostedActor } from './hosted-auth'
import { getHostedRoom } from './hosted-room-store'
import {
    assertHostedMcpConnectionIdsExist,
    getOrCreateHostedRoomConfig,
    listRoomMcpBindings,
    listRoomSecrets,
    replaceRoomMcpBindings,
    readHostedRoomConfig,
    summarizeRoomSecret,
} from './hosted-room-config-store'
import { materializeAndEnqueueHostedRuntime } from './hosted-room-lifecycle-service'
import {
    emptyGithubSummary,
    findHostedProvider,
    getHostedWorkspaceSettings,
    hostedSearchDefaults,
    listHostedMcp,
    listHostedProviders,
    resolveEffectiveProviderSummary,
    resolveHostedCodexStatus,
    summarizeHostedMcp,
    summarizeHostedProvider,
} from './hosted-operator-config-service'

export type { HostedProviderCandidate } from './hosted-provider-priority'
export {
    getHostedOperatorConfigSnapshot,
    getHostedWorkspaceSettings,
    listHostedProviders,
} from './hosted-operator-config-service'
export {
    getHostedRoom,
    getHostedRuntimeEndpointState,
    getHostedRuntimeState,
    listHostedRooms,
} from './hosted-room-store'
export type { HostedRuntimeState } from './hosted-room-store'
export { getHostedRoomMode } from './hosted-room-config-store'
export {
    HostedRuntimeMaterializationConflictError,
    materializeHostedRuntime,
} from './hosted-room-runtime-materializer'
export {
    createHostedRoom,
    deleteHostedRoom,
    failClosedHostedRuntime,
    listRunningHostedRoomIdsForMcpConnection,
    rematerializeRunningHostedRooms,
    resolveHostedRuntimeProviderAvailability,
    setHostedRoomDesiredState,
    stopHostedRuntime,
    updateHostedRoomIdentity,
} from './hosted-room-lifecycle-service'

export async function getHostedRoomConfigSnapshot(input: {
    env: AgentRoomHostedEnv
    actor: HostedActor
    roomId: string
}): Promise<RoomConfigSnapshot> {
    const room = await getHostedRoom({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        roomId: input.roomId,
    })
    if (!room) {
        throw new Error('Room not found')
    }
    const [config, settings, providers, mcpConnections, bindings, roomSecrets] = await Promise.all([
        readHostedRoomConfig({
            env: input.env,
            workspaceId: input.actor.workspaceId,
            roomId: input.roomId,
        }),
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
        listRoomMcpBindings({
            env: input.env,
            workspaceId: input.actor.workspaceId,
            roomId: input.roomId,
        }),
        listRoomSecrets({
            env: input.env,
            workspaceId: input.actor.workspaceId,
            roomId: input.roomId,
        }),
    ])
    if (!config) {
        throw new Error('Room config not found')
    }
    const enabledBindings = bindings.filter((binding) => binding.enabled)
    const capabilities = mergeCapabilities({
        defaults: settings.capabilityDefaults,
        overrides: config.capabilityOverrides,
        roomMode: config.roomMode,
        mcpConnectionCount: enabledBindings.length,
    })
    const search = normalizeSearchConfig(settings.searchConfig, hostedSearchDefaults)
    const appImage = normalizeImageConfig({
        appConfig: settings.imageConfig,
        roomProvider: null,
        roomModel: null,
        envKey: null,
    })
    const braveSecretId = searchProviderSecretId({
        config: settings.searchConfig,
        provider: 'brave',
    })
    const browserbaseSecretId = searchProviderSecretId({
        config: settings.searchConfig,
        provider: 'browserbase',
    })
    const hostedConfig = resolveHostedConfig(input.env)
    const managedBraveAvailable = Boolean(hostedConfig.managedProviders.braveApiKey)
    const billingAccount = await readHostedBillingAccount({
        env: input.env,
        workspaceId: input.actor.workspaceId,
    }).catch((error) => {
        console.warn('Hosted billing account lookup failed while resolving room config', {
            workspaceId: input.actor.workspaceId,
            roomId: input.roomId,
            error,
        })
        return null
    })
    const managedBrowserbaseAvailable = Boolean(
        hostedConfig.managedProviders.browserbaseApiKey &&
        billingAccount &&
        isHostedBillingPlanStatusActive(billingAccount.planStatus) &&
        hostedPlanAllowsManagedBrowserbase(billingAccount.planKey),
    )
    const managedOpenRouterAvailable = await resolveHostedManagedModelAvailable({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        billingAccount,
    }).catch((error) => {
        console.warn('Hosted managed model availability lookup failed', {
            workspaceId: input.actor.workspaceId,
            roomId: input.roomId,
            error,
        })
        return false
    })
    const codexAuth = await resolveHostedCodexStatus({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        providers,
    })
    const imageSecretId = imageConfigSecretId(settings.imageConfig)
    const roomMcpIds = enabledBindings.map((binding) => binding.mcpConnectionId)
    return {
        roomId: input.roomId,
        config: {
            instructions: config.instructions,
            providerMode: config.providerMode,
            providerConnectionId: config.providerConnectionId,
            roomMode: config.roomMode,
            capabilities,
            capabilityOverrides:
                config.capabilityOverrides &&
                typeof config.capabilityOverrides === 'object' &&
                !Array.isArray(config.capabilityOverrides)
                    ? (config.capabilityOverrides as Record<string, boolean>)
                    : {},
            imageProvider: config.imageProvider,
            imageModel: config.imageModel,
            hasImageProviderSecret: Boolean(config.imageSecretId),
            cronTimezone: config.cronTimezone,
            browserActionBudget: config.browserActionBudget,
            mcpConnectionIds: roomMcpIds,
            github: {
                enabled: false,
                installationId: null,
                repositories: [],
            },
        },
        effective: resolveEffectiveProviderSummary({
            config,
            settings,
            providers,
            mcpConnections,
            bindings,
            capabilities,
            searchReady: resolveHostedRoomSearchReady({
                searchEnabled: search.enabled,
                braveEnabled: search.brave.enabled,
                braveSecretId,
                managedBraveAvailable,
                browserbaseEnabled: search.browserbase.enabled,
                browserbaseSecretId,
                managedBrowserbaseAvailable,
            }),
            imageReady: resolveHostedRoomImageReady({
                roomImageProvider: config.imageProvider,
                roomImageSecretId: config.imageSecretId,
                appImageProvider: appImage.provider,
                appImageSecretId: imageSecretId,
            }),
            codexAuth,
            managedOpenRouterAvailable,
        }),
        providers: providers.map(summarizeHostedProvider),
        mcpConnections: mcpConnections.map(summarizeHostedMcp),
        github: emptyGithubSummary(),
        roomSecrets: roomSecrets.map(summarizeRoomSecret),
    }
}

export function resolveHostedRoomSearchReady(input: {
    searchEnabled: boolean
    braveEnabled: boolean
    braveSecretId: string | null
    managedBraveAvailable: boolean
    browserbaseEnabled: boolean
    browserbaseSecretId: string | null
    managedBrowserbaseAvailable: boolean
}): boolean {
    if (!input.searchEnabled) {
        return true
    }
    if (input.braveEnabled && !input.braveSecretId && !input.managedBraveAvailable) {
        return false
    }
    if (
        input.browserbaseEnabled &&
        !input.browserbaseSecretId &&
        !input.managedBrowserbaseAvailable
    ) {
        return false
    }
    return true
}

export function resolveHostedRoomImageReady(input: {
    roomImageProvider: ImageProviderId | null
    roomImageSecretId: string | null
    appImageProvider: ImageProviderId | null
    appImageSecretId: string | null
}): boolean {
    if (input.roomImageProvider) {
        return Boolean(input.roomImageSecretId)
    }
    if (!input.appImageProvider) {
        return true
    }
    return Boolean(input.appImageSecretId)
}

export function resolveHostedRoomImageSecret(input: {
    roomId: string
    currentImageProvider: ImageProviderId | null
    currentImageSecretId: string | null
    imageProvider: ImageProviderId | null
    imageModel: string | null
    imageApiKey: string
}): {
    imageProvider: ImageProviderId | null
    imageModel: string | null
    imageSecretId: string | null
    upsert: { keyName: string; plainText: string } | null
} {
    const imageProvider = input.imageProvider
    const imageModel = imageProvider ? input.imageModel?.trim() || null : null
    const imageApiKey = input.imageApiKey.trim()
    if (!imageProvider || !imageModel) {
        return {
            imageProvider,
            imageModel,
            imageSecretId: null,
            upsert: null,
        }
    }
    if (imageApiKey) {
        return {
            imageProvider,
            imageModel,
            imageSecretId: null,
            upsert: {
                keyName: `room:${input.roomId}:image:${imageProvider}`,
                plainText: imageApiKey,
            },
        }
    }
    return {
        imageProvider,
        imageModel,
        imageSecretId:
            input.currentImageProvider === imageProvider ? input.currentImageSecretId : null,
        upsert: null,
    }
}

export async function saveHostedRoomConfig(input: {
    env: AgentRoomHostedEnv
    actor: HostedActor
    data: {
        roomId: string
        instructions: string
        providerMode: RoomProviderMode
        providerConnectionId?: string | null
        roomMode: RoomMode
        capabilityOverrides: Record<string, boolean>
        imageProvider?: ImageProviderId | null
        imageModel?: string | null
        imageApiKey?: string
        cronTimezone: string
        browserActionBudget?: number
        mcpConnectionIds: string[]
    }
}): Promise<RoomConfigSnapshot> {
    if (!roomProviderModes.includes(input.data.providerMode)) {
        throw new Error('Invalid room provider mode')
    }
    if (!roomModes.includes(input.data.roomMode)) {
        throw new Error('Invalid room mode')
    }
    const providerConnectionId =
        input.data.providerMode === 'app_connection'
            ? (input.data.providerConnectionId ?? null)
            : null
    const room = await getHostedRoom({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        roomId: input.data.roomId,
    })
    if (!room) {
        throw new Error('Room not found')
    }
    if (input.data.providerMode === 'app_connection') {
        if (!providerConnectionId) {
            throw new Error('Provider connection is required for room provider mode')
        }
        const provider = await findHostedProvider({
            env: input.env,
            workspaceId: input.actor.workspaceId,
            id: providerConnectionId,
        })
        if (!provider) {
            throw new Error('Provider connection not found')
        }
    }
    const mcpConnectionIds = Array.from(new Set(input.data.mcpConnectionIds))
    await assertHostedMcpConnectionIdsExist({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        mcpConnectionIds,
    })
    const current = await getOrCreateHostedRoomConfig({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        roomId: input.data.roomId,
    })
    const imageSecret = resolveHostedRoomImageSecret({
        roomId: input.data.roomId,
        currentImageProvider: current.imageProvider,
        currentImageSecretId: current.imageSecretId,
        imageProvider: input.data.imageProvider ?? null,
        imageModel: input.data.imageModel ?? null,
        imageApiKey: input.data.imageApiKey ?? '',
    })
    const imageSecretId = imageSecret.upsert
        ? await upsertHostedSecret({
              env: input.env,
              workspaceId: input.actor.workspaceId,
              keyName: imageSecret.upsert.keyName,
              plainText: imageSecret.upsert.plainText,
          })
        : imageSecret.imageSecretId
    const now = nowIso()
    await input.env.AGENT_ROOM_DB.prepare(
        `
            UPDATE hosted_room_config
            SET instructions = ?1,
                provider_mode = ?2,
                provider_connection_id = ?3,
                room_mode = ?4,
                capability_overrides = ?5,
                image_provider = ?6,
                image_model = ?7,
                image_secret_id = ?8,
                cron_timezone = ?9,
                browser_action_budget = ?10,
                updated_at = ?11
            WHERE workspace_id = ?12
              AND room_id = ?13
        `,
    )
        .bind(
            input.data.instructions,
            input.data.providerMode,
            providerConnectionId,
            input.data.roomMode,
            stringifyJson(toJsonValue(input.data.capabilityOverrides)),
            imageSecret.imageProvider,
            imageSecret.imageModel,
            imageSecretId,
            input.data.cronTimezone,
            input.data.browserActionBudget ?? current.browserActionBudget,
            now,
            input.actor.workspaceId,
            input.data.roomId,
        )
        .run()
    await appendHostedAudit({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        actorUserId: input.actor.userId,
        roomId: input.data.roomId,
        action: 'room.config.saved',
        payload: {
            providerMode: input.data.providerMode,
            providerConnectionId,
            roomMode: input.data.roomMode,
            imageProvider: imageSecret.imageProvider,
            imageModel: imageSecret.imageModel,
            hasImageProviderSecret: imageSecretId !== null,
            cronTimezone: input.data.cronTimezone,
            browserActionBudget: input.data.browserActionBudget ?? current.browserActionBudget,
            mcpConnectionIds: [...mcpConnectionIds].sort(),
        },
    })
    await replaceRoomMcpBindings({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        roomId: input.data.roomId,
        mcpConnectionIds,
    })
    if (room.desiredState === 'running') {
        await materializeAndEnqueueHostedRuntime({
            env: input.env,
            actor: input.actor,
            roomId: input.data.roomId,
            config: {
                providerMode: input.data.providerMode,
                providerConnectionId,
            },
        })
    }
    return getHostedRoomConfigSnapshot({
        env: input.env,
        actor: input.actor,
        roomId: input.data.roomId,
    })
}

export async function saveHostedRoomSecret(input: {
    env: AgentRoomHostedEnv
    actor: HostedActor
    data: {
        roomId: string
        label: string
        envKey: string
        purpose: (typeof userRoomSecretPurposes)[number]
        provider?: string | null
        value: string
    }
}): Promise<RoomSecretSummary> {
    const room = await getHostedRoom({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        roomId: input.data.roomId,
    })
    if (!room) {
        throw new Error('Room not found')
    }
    const id = randomUUID()
    const envKey = upperSnake(input.data.envKey)
    if (!envKey) {
        throw new Error('Room secret env key must contain at least one letter or number')
    }
    assertNoReservedRoomRuntimeEnvKeys(
        {
            [envKey]: 'reserved-check',
        },
        'Room secret env key',
    )
    const secretId = await upsertHostedSecret({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        keyName: `room:${input.data.roomId}:secret:${envKey}`,
        plainText: input.data.value,
    })
    const now = nowIso()
    await input.env.AGENT_ROOM_DB.prepare(
        `
            INSERT INTO hosted_room_secret (
                id,
                workspace_id,
                room_id,
                secret_id,
                label,
                env_key,
                purpose,
                provider,
                created_by_user_id,
                created_at,
                updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
            ON CONFLICT(workspace_id, room_id, env_key) DO UPDATE SET
                secret_id = excluded.secret_id,
                label = excluded.label,
                purpose = excluded.purpose,
                provider = excluded.provider,
                updated_at = excluded.updated_at
        `,
    )
        .bind(
            id,
            input.actor.workspaceId,
            input.data.roomId,
            secretId,
            input.data.label.trim(),
            envKey,
            input.data.purpose,
            input.data.provider ?? null,
            input.actor.userId,
            now,
        )
        .run()
    await appendHostedAudit({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        actorUserId: input.actor.userId,
        roomId: input.data.roomId,
        action: 'room.secret.saved',
        payload: {
            envKey,
            purpose: input.data.purpose,
            provider: input.data.provider ?? null,
        },
    })
    if (room.desiredState === 'running') {
        const config = await getOrCreateHostedRoomConfig({
            env: input.env,
            workspaceId: input.actor.workspaceId,
            roomId: input.data.roomId,
        })
        await materializeAndEnqueueHostedRuntime({
            env: input.env,
            actor: input.actor,
            roomId: input.data.roomId,
            config,
        })
    }
    const secret = (
        await listRoomSecrets({
            env: input.env,
            workspaceId: input.actor.workspaceId,
            roomId: input.data.roomId,
        })
    ).find((entry) => entry.envKey === envKey)
    if (!secret) {
        throw new Error('Hosted room secret was not saved')
    }
    return summarizeRoomSecret(secret)
}
