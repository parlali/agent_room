import type {
    HealthStatus,
    RoomDesiredState,
    RoomRecord,
    RoomRuntimeMetadataRecord,
    RoomStatus,
} from '#/domain/domain-types'
import type { AgentRoomHostedEnv } from './bindings'
import { toDate } from './hosted-json'
import type { HostedProviderCandidate } from './hosted-provider-priority'
import { hostedRuntimePort } from './hosted-runtime-paths'

function mapRoom(row: HostedRoomRow): RoomRecord {
    return {
        id: row.id,
        slug: row.slug,
        displayName: row.displayName,
        status: row.status as RoomStatus,
        desiredState: row.desiredState as RoomDesiredState,
        createdByUserId: row.createdByUserId,
        createdAt: new Date(row.createdAt),
        updatedAt: new Date(row.updatedAt),
    }
}

function mapRuntimeMetadata(row: HostedRuntimeRow | null): RoomRuntimeMetadataRecord | null {
    if (!row) {
        return null
    }
    return {
        roomId: row.roomId,
        port: row.healthStatus === 'healthy' ? hostedRuntimePort : null,
        pid: null,
        sandboxUid: null,
        sandboxGid: null,
        sandboxUserName: null,
        sandboxGroupName: null,
        configVersion: row.configVersion,
        tokenVersion: row.tokenVersion,
        healthStatus: row.healthStatus as HealthStatus,
        startedAt: toDate(row.startedAt),
        lastHealthAt: toDate(row.lastHealthAt),
        lastError: row.lastError,
        updatedAt: new Date(row.updatedAt),
    }
}

export async function getHostedRoom(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
}): Promise<RoomRecord | null> {
    const row = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT
                id,
                slug,
                display_name AS displayName,
                status,
                desired_state AS desiredState,
                created_by_user_id AS createdByUserId,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM hosted_room
            WHERE workspace_id = ?1
              AND id = ?2
        `,
    )
        .bind(input.workspaceId, input.roomId)
        .first<HostedRoomRow>()
    return row ? mapRoom(row) : null
}

export async function listHostedRooms(input: {
    env: AgentRoomHostedEnv
    actor: {
        workspaceId: string
    }
}): Promise<RoomRecord[]> {
    const rows = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT
                id,
                slug,
                display_name AS displayName,
                status,
                desired_state AS desiredState,
                created_by_user_id AS createdByUserId,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM hosted_room
            WHERE workspace_id = ?1
            ORDER BY updated_at DESC
        `,
    )
        .bind(input.actor.workspaceId)
        .all<HostedRoomRow>()
    return rows.results.map(mapRoom)
}

export async function getHostedRuntimeState(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
}): Promise<HostedRuntimeState | null> {
    const row = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT
                room_id AS roomId,
                workspace_id AS workspaceId,
                container_name AS containerName,
                config_object_key AS configObjectKey,
                token_object_key AS tokenObjectKey,
                runtime_bundle_object_key AS runtimeBundleObjectKey,
                provider_candidate AS providerCandidate,
                workspace_snapshot_key AS workspaceSnapshotKey,
                config_version AS configVersion,
                token_version AS tokenVersion,
                health_status AS healthStatus,
                started_at AS startedAt,
                last_health_at AS lastHealthAt,
                last_error AS lastError,
                updated_at AS updatedAt
            FROM hosted_room_runtime_state
            WHERE workspace_id = ?1
              AND room_id = ?2
        `,
    )
        .bind(input.workspaceId, input.roomId)
        .first<HostedRuntimeSqlRow>()
    if (!row) {
        return null
    }
    const runtimeRow = mapRuntimeRow(row)
    return {
        row: runtimeRow,
        metadata: mapRuntimeMetadata(runtimeRow),
    }
}

export async function getHostedRuntimeEndpointState(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
}): Promise<{
    desiredState: string
    status: string
    runtime: HostedRuntimeRow
} | null> {
    const row = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT
                room.desired_state AS desiredState,
                room.status AS status,
                runtime.room_id AS roomId,
                runtime.workspace_id AS workspaceId,
                runtime.container_name AS containerName,
                runtime.config_object_key AS configObjectKey,
                runtime.token_object_key AS tokenObjectKey,
                runtime.runtime_bundle_object_key AS runtimeBundleObjectKey,
                runtime.provider_candidate AS providerCandidate,
                runtime.workspace_snapshot_key AS workspaceSnapshotKey,
                runtime.config_version AS configVersion,
                runtime.token_version AS tokenVersion,
                runtime.health_status AS healthStatus,
                runtime.started_at AS startedAt,
                runtime.last_health_at AS lastHealthAt,
                runtime.last_error AS lastError,
                runtime.updated_at AS updatedAt
            FROM hosted_room AS room
            INNER JOIN hosted_room_runtime_state AS runtime
                ON runtime.room_id = room.id
               AND runtime.workspace_id = room.workspace_id
            WHERE room.workspace_id = ?1
              AND room.id = ?2
            LIMIT 1
        `,
    )
        .bind(input.workspaceId, input.roomId)
        .first<
            HostedRuntimeSqlRow & {
                desiredState: string
                status: string
            }
        >()
    return row
        ? {
              desiredState: row.desiredState,
              status: row.status,
              runtime: {
                  roomId: row.roomId,
                  workspaceId: row.workspaceId,
                  containerName: row.containerName,
                  configObjectKey: row.configObjectKey,
                  tokenObjectKey: row.tokenObjectKey,
                  runtimeBundleObjectKey: row.runtimeBundleObjectKey,
                  providerCandidate: row.providerCandidate,
                  workspaceSnapshotKey: row.workspaceSnapshotKey,
                  configVersion: row.configVersion,
                  tokenVersion: row.tokenVersion,
                  healthStatus: row.healthStatus,
                  startedAt: row.startedAt,
                  lastHealthAt: row.lastHealthAt,
                  lastError: row.lastError,
                  updatedAt: row.updatedAt,
              },
          }
        : null
}

interface HostedRoomRow {
    id: string
    slug: string
    displayName: string
    status: string
    desiredState: string
    createdByUserId: string
    createdAt: string
    updatedAt: string
}

export interface HostedRuntimeRow {
    roomId: string
    workspaceId: string
    containerName: string
    configObjectKey: string | null
    tokenObjectKey: string | null
    runtimeBundleObjectKey: string | null
    providerCandidate: HostedProviderCandidate | null
    workspaceSnapshotKey: string | null
    configVersion: number
    tokenVersion: number
    healthStatus: string
    startedAt: string | null
    lastHealthAt: string | null
    lastError: string | null
    updatedAt: string
}

export interface HostedRuntimeState {
    row: HostedRuntimeRow
    metadata: RoomRuntimeMetadataRecord | null
}

type HostedRuntimeSqlRow = HostedRuntimeRow

function mapRuntimeRow(row: HostedRuntimeSqlRow): HostedRuntimeRow {
    return row
}
