import { randomUUID } from 'node:crypto'
import type {
    RoomDesiredState,
    RoomMode,
    RoomProviderMode,
    RoomRecord,
} from '#/domain/domain-types'
import type { AgentRoomHostedEnv } from './bindings'
import type { HostedActor } from './hosted-auth'
import { assertHostedQuotaAllowed } from './hosted-abuse-controls'
import { appendHostedAudit } from './hosted-audit'
import { assertChanged } from './hosted-d1'
import { nowIso } from './hosted-json'
import {
    evaluateHostedRuntimeAccess,
    hostedRuntimeAccessDeniedMessage,
} from './hosted-runtime-access'
import { enqueueHostedRuntimeReconcile } from './hosted-runtime-jobs'
import {
    readHostedBillingAccount,
    releaseAuthorizedHostedBillingReservationsForRoom,
} from './hosted-billing-repository'
import { resolveHostedConfig } from './hosted-config'
import { hostedManagedModelAvailable } from './hosted-model-policy'
import {
    assertHostedProviderSelectionReady,
    type ProviderSelectionConfig,
    resolveHostedProviderSelection,
} from './hosted-runtime-materialization'
import { hostedRuntimeContainerName } from './runtime-contract'
import { hostedWorkspacePrefix } from './workspace-storage'
import {
    assertHostedMcpConnectionIdsExist,
    getOrCreateHostedRoomConfig,
    replaceRoomMcpBindings,
} from './hosted-room-config-store'
import { getHostedRoom, getHostedRuntimeState } from './hosted-room-store'
import {
    deleteHostedWorkspaceObjects,
    deleteHostedWorkspacePrefix,
} from './hosted-workspace-objects'
import {
    findHostedProvider,
    getHostedWorkspaceSettings,
    listHostedProviders,
    resolveHostedCodexStatus,
} from './hosted-operator-config-service'

function normalizeSlug(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
}

function normalizeHostedRoomIdentity(input: { displayName: string; slug?: string | null }): {
    displayName: string
    slug: string
} {
    const displayName = input.displayName.trim()
    if (!displayName) {
        throw new Error('Room display name cannot be empty')
    }
    const slug = input.slug ? normalizeSlug(input.slug) : normalizeSlug(displayName)
    if (!slug) {
        throw new Error('Room slug cannot be empty')
    }
    return {
        displayName,
        slug,
    }
}

export async function createHostedRoom(input: {
    env: AgentRoomHostedEnv
    actor: HostedActor
    displayName: string
    slug?: string | null
    startImmediately?: boolean
    instructions?: string
    providerMode?: RoomProviderMode
    providerConnectionId?: string | null
    roomMode?: RoomMode
    cronTimezone?: string
    mcpConnectionIds?: string[]
}): Promise<RoomRecord> {
    const { displayName, slug } = normalizeHostedRoomIdentity(input)
    const roomId = randomUUID()
    const now = nowIso()
    const desiredState = input.startImmediately === false ? 'stopped' : 'running'
    const status = desiredState === 'running' ? 'starting' : 'stopped'
    const providerMode = input.providerMode ?? 'managed_hosted'
    const providerConnectionId =
        providerMode === 'managed_hosted' ? null : (input.providerConnectionId ?? null)
    if (providerMode === 'app_connection') {
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
    if (input.mcpConnectionIds?.length) {
        await assertHostedMcpConnectionIdsExist({
            env: input.env,
            workspaceId: input.actor.workspaceId,
            mcpConnectionIds: input.mcpConnectionIds,
        })
    }
    if (desiredState === 'running') {
        await assertHostedRuntimeStartAllowed({
            env: input.env,
            workspaceId: input.actor.workspaceId,
            roomId,
            config: {
                providerMode,
                providerConnectionId,
            },
            actorUserId: input.actor.userId,
        })
    }
    const containerName = hostedRuntimeContainerName({
        workspaceId: input.actor.workspaceId,
        roomId,
    })
    await input.env.AGENT_ROOM_DB.batch([
        input.env.AGENT_ROOM_DB.prepare(
            `
                INSERT INTO hosted_room (
                    id,
                    workspace_id,
                    slug,
                    display_name,
                    status,
                    desired_state,
                    created_by_user_id,
                    created_at,
                    updated_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
            `,
        ).bind(
            roomId,
            input.actor.workspaceId,
            slug,
            displayName,
            status,
            desiredState,
            input.actor.userId,
            now,
        ),
        input.env.AGENT_ROOM_DB.prepare(
            `
                INSERT INTO hosted_room_runtime_state (
                    room_id,
                    workspace_id,
                    container_name,
                    config_object_key,
                    workspace_snapshot_key,
                    config_version,
                    token_version,
                    health_status,
                    updated_at
                )
                VALUES (?1, ?2, ?3, NULL, NULL, 1, 1, 'unknown', ?4)
            `,
        ).bind(roomId, input.actor.workspaceId, containerName, now),
        input.env.AGENT_ROOM_DB.prepare(
            `
                INSERT INTO hosted_room_config (
                    room_id,
                    workspace_id,
                    instructions,
                    provider_mode,
                    provider_connection_id,
                    room_mode,
                    capability_overrides,
                    image_provider,
                    image_model,
                    image_secret_id,
                    cron_timezone,
                    browser_action_budget,
                    created_at,
                    updated_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, '{}', NULL, NULL, NULL, ?7, 50, ?8, ?8)
            `,
        ).bind(
            roomId,
            input.actor.workspaceId,
            input.instructions ?? '',
            providerMode,
            providerConnectionId,
            input.roomMode ?? 'coworker',
            input.cronTimezone ?? 'UTC',
            now,
        ),
        input.env.AGENT_ROOM_DB.prepare(
            `
                INSERT INTO hosted_room_onboarding (
                    room_id,
                    workspace_id,
                    status,
                    session_key,
                    created_at,
                    updated_at,
                    completed_at,
                    deferred_at
                )
                VALUES (?1, ?2, 'completed', NULL, ?3, ?3, ?3, NULL)
            `,
        ).bind(roomId, input.actor.workspaceId, now),
    ])
    if (input.mcpConnectionIds?.length) {
        await replaceRoomMcpBindings({
            env: input.env,
            workspaceId: input.actor.workspaceId,
            roomId,
            mcpConnectionIds: input.mcpConnectionIds,
        })
    }
    await appendHostedAudit({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        actorUserId: input.actor.userId,
        roomId,
        action: 'room.created',
        payload: {
            slug,
            desiredState,
        },
    })
    if (desiredState === 'running') {
        await materializeAndEnqueueHostedRuntimeAfterAccessCheck({
            env: input.env,
            actor: input.actor,
            roomId,
        })
    }
    const room = await getHostedRoom({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        roomId,
    })
    if (!room) {
        throw new Error('Hosted room was not created')
    }
    return room
}

export async function setHostedRoomDesiredState(input: {
    env: AgentRoomHostedEnv
    actor: HostedActor
    roomId: string
    desiredState: RoomDesiredState
}): Promise<void> {
    const now = nowIso()
    const status = input.desiredState === 'running' ? 'starting' : 'stopped'
    if (input.desiredState === 'running') {
        const config = await getOrCreateHostedRoomConfig({
            env: input.env,
            workspaceId: input.actor.workspaceId,
            roomId: input.roomId,
        })
        await assertHostedRuntimeStartAllowed({
            env: input.env,
            workspaceId: input.actor.workspaceId,
            roomId: input.roomId,
            config,
            actorUserId: input.actor.userId,
        })
        const result = await input.env.AGENT_ROOM_DB.prepare(
            `
                UPDATE hosted_room
                SET desired_state = 'running',
                    status = 'starting',
                    updated_at = ?3
                WHERE workspace_id = ?1
                  AND id = ?2
            `,
        )
            .bind(input.actor.workspaceId, input.roomId, now)
            .run()
        assertChanged(result, 'Room not found')
        await appendHostedAudit({
            env: input.env,
            workspaceId: input.actor.workspaceId,
            actorUserId: input.actor.userId,
            roomId: input.roomId,
            action: 'room.desired_state.changed',
            payload: {
                desiredState: input.desiredState,
                status,
            },
        })
        await materializeAndEnqueueHostedRuntimeAfterAccessCheck({
            env: input.env,
            actor: input.actor,
            roomId: input.roomId,
        })
        return
    }
    const result = await input.env.AGENT_ROOM_DB.prepare(
        `
            UPDATE hosted_room
            SET desired_state = 'stopped',
                status = ?3,
                updated_at = ?4
            WHERE workspace_id = ?1
              AND id = ?2
        `,
    )
        .bind(input.actor.workspaceId, input.roomId, status, now)
        .run()
    assertChanged(result, 'Room not found')
    await appendHostedAudit({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        actorUserId: input.actor.userId,
        roomId: input.roomId,
        action: 'room.desired_state.changed',
        payload: {
            desiredState: input.desiredState,
            status,
        },
    })
    await stopHostedRuntime({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        roomId: input.roomId,
    })
}

export async function stopHostedRuntime(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
}): Promise<void> {
    const runtimeState = await getHostedRuntimeState(input)
    if (!runtimeState) {
        return
    }
    const objectKeys = [
        runtimeState.row.configObjectKey,
        runtimeState.row.tokenObjectKey,
        runtimeState.row.runtimeBundleObjectKey,
    ].filter((key): key is string => key !== null)
    await input.env.AGENT_ROOM_RUNTIME.getByName(runtimeState.row.containerName).destroy()
    await deleteHostedWorkspaceObjects({
        env: input.env,
        keys: objectKeys,
    })
    await input.env.AGENT_ROOM_DB.prepare(
        `
            UPDATE hosted_room_runtime_state
            SET config_object_key = NULL,
                token_object_key = NULL,
                runtime_bundle_object_key = NULL,
                provider_candidate = NULL,
                health_status = 'unknown',
                started_at = NULL,
                last_health_at = NULL,
                last_error = 'Runtime stopped',
                updated_at = ?3
            WHERE workspace_id = ?1
              AND room_id = ?2
        `,
    )
        .bind(input.workspaceId, input.roomId, nowIso())
        .run()
}

export async function failClosedHostedRuntime(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    error: unknown
}): Promise<void> {
    const runtimeState = await getHostedRuntimeState(input)
    const message =
        input.error instanceof Error
            ? input.error.message
                  .replaceAll(input.workspaceId, 'workspace')
                  .replaceAll(input.roomId, 'room')
            : 'Hosted runtime failed'
    const objectKeys = runtimeState
        ? [
              runtimeState.row.configObjectKey,
              runtimeState.row.tokenObjectKey,
              runtimeState.row.runtimeBundleObjectKey,
          ].filter((key): key is string => key !== null)
        : []
    const now = nowIso()
    if (runtimeState) {
        await input.env.AGENT_ROOM_RUNTIME.getByName(runtimeState.row.containerName).destroy()
        await deleteHostedWorkspaceObjects({
            env: input.env,
            keys: objectKeys,
        })
    }
    await input.env.AGENT_ROOM_DB.batch([
        input.env.AGENT_ROOM_DB.prepare(
            `
                UPDATE hosted_room
                SET status = 'failed',
                    desired_state = 'stopped',
                    updated_at = ?3
                WHERE workspace_id = ?1
                  AND id = ?2
            `,
        ).bind(input.workspaceId, input.roomId, now),
        input.env.AGENT_ROOM_DB.prepare(
            `
                UPDATE hosted_room_runtime_state
                SET config_object_key = NULL,
                    token_object_key = NULL,
                    runtime_bundle_object_key = NULL,
                    provider_candidate = NULL,
                    health_status = 'unhealthy',
                    started_at = NULL,
                    last_health_at = NULL,
                    last_error = ?3,
                    updated_at = ?4
                WHERE workspace_id = ?1
                  AND room_id = ?2
            `,
        ).bind(input.workspaceId, input.roomId, message, now),
    ])
    await appendHostedAudit({
        env: input.env,
        workspaceId: input.workspaceId,
        actorUserId: null,
        roomId: input.roomId,
        action: 'room.runtime.fail_closed',
        payload: {
            status: 'failed',
            desiredState: 'stopped',
            runtimeDestroyed: runtimeState !== null,
            runtimeObjectCount: objectKeys.length,
            error: message.slice(0, 600),
        },
    })
}

export async function updateHostedRoomIdentity(input: {
    env: AgentRoomHostedEnv
    actor: HostedActor
    roomId: string
    displayName: string
    slug?: string | null
}): Promise<RoomRecord> {
    const { displayName, slug } = normalizeHostedRoomIdentity(input)
    const result = await input.env.AGENT_ROOM_DB.prepare(
        `
            UPDATE hosted_room
            SET display_name = ?1,
                slug = ?2,
                updated_at = ?3
            WHERE workspace_id = ?4
              AND id = ?5
        `,
    )
        .bind(displayName, slug, nowIso(), input.actor.workspaceId, input.roomId)
        .run()
    assertChanged(result, 'Room not found')
    await appendHostedAudit({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        actorUserId: input.actor.userId,
        roomId: input.roomId,
        action: 'room.identity.updated',
        payload: {
            displayName,
            slug,
        },
    })
    const room = await getHostedRoom({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        roomId: input.roomId,
    })
    if (!room) {
        throw new Error('Room not found')
    }
    if (room.desiredState === 'running') {
        const config = await getOrCreateHostedRoomConfig({
            env: input.env,
            workspaceId: input.actor.workspaceId,
            roomId: input.roomId,
        })
        await materializeAndEnqueueHostedRuntime({
            env: input.env,
            actor: input.actor,
            roomId: input.roomId,
            config,
        })
    }
    return room
}

export async function deleteHostedRoom(input: {
    env: AgentRoomHostedEnv
    actor: HostedActor
    roomId: string
    confirmSlug: string
}): Promise<void> {
    const room = await getHostedRoom({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        roomId: input.roomId,
    })
    if (!room) {
        throw new Error('Room not found')
    }
    if (room.slug !== input.confirmSlug) {
        throw new Error('Confirmation slug does not match room slug')
    }
    const runtimeState = await getHostedRuntimeState({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        roomId: input.roomId,
    })
    await releaseAuthorizedHostedBillingReservationsForRoom({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        roomId: input.roomId,
    })
    await appendHostedAudit({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        actorUserId: input.actor.userId,
        roomId: input.roomId,
        action: 'room.deleted',
        payload: {
            slug: room.slug,
            displayName: room.displayName,
            status: room.status,
            desiredState: room.desiredState,
        },
    })
    const deleteResult = await input.env.AGENT_ROOM_DB.prepare(
        `
            DELETE FROM hosted_room
            WHERE workspace_id = ?1
              AND id = ?2
        `,
    )
        .bind(input.actor.workspaceId, input.roomId)
        .run()
    assertChanged(deleteResult, 'Room not found')
    await input.env.AGENT_ROOM_DB.prepare(
        `
            DELETE FROM hosted_secret
            WHERE workspace_id = ?1
              AND key_name GLOB ?2
        `,
    )
        .bind(input.actor.workspaceId, `room:${input.roomId}:*`)
        .run()
    if (runtimeState) {
        await input.env.AGENT_ROOM_RUNTIME.getByName(runtimeState.row.containerName).destroy()
    }
    await deleteHostedWorkspacePrefix({
        env: input.env,
        prefix: hostedWorkspacePrefix({
            workspaceId: input.actor.workspaceId,
            roomId: input.roomId,
        }),
    })
}

async function resolveHostedRuntimeProviderAvailabilityForSelection(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    config: ProviderSelectionConfig
    requireSelectionReady: boolean
}): Promise<{
    userKeyAvailable: boolean
    codexAvailable: boolean
    managedOpenRouterAvailable: boolean
}> {
    const [settings, providers] = await Promise.all([
        getHostedWorkspaceSettings({
            env: input.env,
            workspaceId: input.workspaceId,
        }),
        listHostedProviders({
            env: input.env,
            workspaceId: input.workspaceId,
        }),
    ])
    const codexAuth = await resolveHostedCodexStatus({
        env: input.env,
        workspaceId: input.workspaceId,
        providers,
    })
    const hostedConfig = resolveHostedConfig(input.env)
    const billingAccount = await readHostedBillingAccount({
        env: input.env,
        workspaceId: input.workspaceId,
    })
    const managedOpenRouterAvailable = hostedManagedModelAvailable({
        openRouterApiKey: hostedConfig.managedProviders.openRouterApiKey,
        hostedModelsDisabled: hostedConfig.killSwitches.hostedModels,
        planKey: billingAccount.planKey,
        planStatus: billingAccount.planStatus,
    })
    if (input.config.providerMode === 'managed_hosted') {
        if (input.requireSelectionReady && !managedOpenRouterAvailable) {
            throw new Error('Hosted model access is not available for this workspace')
        }
        return {
            userKeyAvailable: false,
            codexAvailable: false,
            managedOpenRouterAvailable,
        }
    }

    const selection = resolveHostedProviderSelection({
        config: input.config,
        settings,
        providers,
        codexAuth,
    })
    if (input.requireSelectionReady) {
        assertHostedProviderSelectionReady({
            selection,
            appConnectionMessage: 'Selected provider connection is not configured',
            appDefaultMessage: 'Default provider connection is not configured',
        })
    }
    return {
        userKeyAvailable: selection.apiKeyProvider !== null,
        codexAvailable: selection.codexProvider !== null,
        managedOpenRouterAvailable,
    }
}

export async function resolveHostedRuntimeProviderAvailability(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
}): Promise<{
    userKeyAvailable: boolean
    codexAvailable: boolean
    managedOpenRouterAvailable: boolean
}> {
    const config = await getOrCreateHostedRoomConfig({
        env: input.env,
        workspaceId: input.workspaceId,
        roomId: input.roomId,
    })
    return resolveHostedRuntimeProviderAvailabilityForSelection({
        env: input.env,
        workspaceId: input.workspaceId,
        config,
        requireSelectionReady: false,
    })
}

async function assertHostedRuntimeStartAllowed(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    config: ProviderSelectionConfig
    actorUserId?: string | null
    consumeQuota?: boolean
}): Promise<void> {
    const access = await evaluateHostedRuntimeAccess({
        env: input.env,
        workspaceId: input.workspaceId,
        roomId: input.roomId,
    })
    if (!access.allowed) {
        throw new Error(hostedRuntimeAccessDeniedMessage(access.reason))
    }
    await assertHostedQuotaAllowed({
        env: input.env,
        workspaceId: input.workspaceId,
        roomId: input.roomId,
        actorUserId: input.actorUserId ?? null,
        action: 'runtime_start',
        amount: {
            count: 1,
        },
        consume: input.consumeQuota ?? false,
    })
    await resolveHostedRuntimeProviderAvailabilityForSelection({
        env: input.env,
        workspaceId: input.workspaceId,
        config: input.config,
        requireSelectionReady: true,
    })
}

export async function materializeAndEnqueueHostedRuntime(input: {
    env: AgentRoomHostedEnv
    actor: Pick<HostedActor, 'workspaceId' | 'userId'>
    roomId: string
    config: ProviderSelectionConfig
}): Promise<void> {
    try {
        await assertHostedRuntimeStartAllowed({
            env: input.env,
            workspaceId: input.actor.workspaceId,
            roomId: input.roomId,
            config: input.config,
            actorUserId: input.actor.userId,
        })
        await materializeAndEnqueueHostedRuntimeAfterAccessCheck(input)
    } catch (error) {
        await failClosedHostedRuntime({
            env: input.env,
            workspaceId: input.actor.workspaceId,
            roomId: input.roomId,
            error,
        })
        throw error
    }
}

async function materializeAndEnqueueHostedRuntimeAfterAccessCheck(input: {
    env: AgentRoomHostedEnv
    actor: Pick<HostedActor, 'workspaceId' | 'userId'>
    roomId: string
}): Promise<void> {
    try {
        await enqueueHostedRuntimeReconcile({
            env: input.env,
            workspaceId: input.actor.workspaceId,
            roomId: input.roomId,
            actorUserId: input.actor.userId,
        })
    } catch (error) {
        await failClosedHostedRuntime({
            env: input.env,
            workspaceId: input.actor.workspaceId,
            roomId: input.roomId,
            error,
        })
        throw error
    }
}

async function listRunningHostedRoomIds(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
}): Promise<string[]> {
    const rows = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT id
            FROM hosted_room
            WHERE workspace_id = ?1
              AND desired_state = 'running'
        `,
    )
        .bind(input.workspaceId)
        .all<{ id: string }>()
    return rows.results.map((row) => row.id)
}

export async function listRunningHostedRoomIdsForMcpConnection(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    mcpConnectionId: string
}): Promise<string[]> {
    const rows = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT room.id AS id
            FROM hosted_room AS room
            INNER JOIN hosted_room_mcp_binding AS binding
                ON binding.workspace_id = room.workspace_id
               AND binding.room_id = room.id
            WHERE room.workspace_id = ?1
              AND room.desired_state = 'running'
              AND binding.mcp_connection_id = ?2
        `,
    )
        .bind(input.workspaceId, input.mcpConnectionId)
        .all<{ id: string }>()
    return rows.results.map((row) => row.id)
}

export async function rematerializeRunningHostedRooms(input: {
    env: AgentRoomHostedEnv
    actor: Pick<HostedActor, 'workspaceId' | 'userId'>
    roomIds?: string[]
}): Promise<void> {
    const roomIds =
        input.roomIds ??
        (await listRunningHostedRoomIds({
            env: input.env,
            workspaceId: input.actor.workspaceId,
        }))
    for (const roomId of roomIds) {
        const config = await getOrCreateHostedRoomConfig({
            env: input.env,
            workspaceId: input.actor.workspaceId,
            roomId,
        })
        await materializeAndEnqueueHostedRuntime({
            env: input.env,
            actor: input.actor,
            roomId,
            config,
        })
    }
}
