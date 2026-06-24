import type {
    ImageProviderId,
    RoomConfigRecord,
    RoomMcpBindingRecord,
    RoomMode,
    RoomProviderMode,
    RoomSecretRecord,
} from '#/domain/domain-types'
import type { RoomSecretSummary } from '../configuration/operator-configuration'
import type { AgentRoomHostedEnv } from './bindings'
import { nowIso, parseJsonValue } from './hosted-json'
import { listHostedMcp } from './hosted-operator-config-service'

function mapConfig(row: HostedRoomConfigRow): RoomConfigRecord {
    return {
        roomId: row.roomId,
        instructions: row.instructions,
        providerMode: row.providerMode as RoomProviderMode,
        providerConnectionId: row.providerConnectionId,
        roomMode: row.roomMode as RoomMode,
        capabilityOverrides: parseJsonValue(row.capabilityOverrides, {}),
        imageProvider: row.imageProvider as ImageProviderId | null,
        imageModel: row.imageModel,
        imageSecretId: row.imageSecretId,
        cronTimezone: row.cronTimezone,
        browserActionBudget: row.browserActionBudget,
        createdAt: new Date(row.createdAt),
        updatedAt: new Date(row.updatedAt),
    }
}

export type ProviderSelectionConfig = Pick<
    RoomConfigRecord,
    'providerMode' | 'providerConnectionId'
>

export async function readHostedRoomConfig(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
}): Promise<RoomConfigRecord | null> {
    const row = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT
                room_id AS roomId,
                instructions,
                provider_mode AS providerMode,
                provider_connection_id AS providerConnectionId,
                room_mode AS roomMode,
                capability_overrides AS capabilityOverrides,
                image_provider AS imageProvider,
                image_model AS imageModel,
                image_secret_id AS imageSecretId,
                cron_timezone AS cronTimezone,
                browser_action_budget AS browserActionBudget,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM hosted_room_config
            WHERE workspace_id = ?1
              AND room_id = ?2
        `,
    )
        .bind(input.workspaceId, input.roomId)
        .first<HostedRoomConfigRow>()
    return row ? mapConfig(row) : null
}

export async function getOrCreateHostedRoomConfig(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
}): Promise<RoomConfigRecord> {
    const existing = await readHostedRoomConfig(input)
    if (existing) {
        return existing
    }
    const now = nowIso()
    await input.env.AGENT_ROOM_DB.prepare(
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
            VALUES (?1, ?2, '', 'app_default', NULL, 'coworker', '{}', NULL, NULL, NULL, 'UTC', 50, ?3, ?3)
        `,
    )
        .bind(input.roomId, input.workspaceId, now)
        .run()
    return getOrCreateHostedRoomConfig(input)
}

export async function getHostedRoomMode(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
}): Promise<RoomMode> {
    const config = await readHostedRoomConfig(input)
    return config?.roomMode ?? 'coworker'
}

export async function listRoomMcpBindings(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
}): Promise<RoomMcpBindingRecord[]> {
    const rows = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT
                room_id AS roomId,
                mcp_connection_id AS mcpConnectionId,
                allowed_tools AS allowedTools,
                enabled,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM hosted_room_mcp_binding
            WHERE workspace_id = ?1
              AND room_id = ?2
        `,
    )
        .bind(input.workspaceId, input.roomId)
        .all<HostedRoomMcpBindingRow>()
    return rows.results.map((row) => ({
        roomId: row.roomId,
        mcpConnectionId: row.mcpConnectionId,
        allowedTools: parseJsonValue(row.allowedTools, []),
        enabled: row.enabled === 1,
        createdAt: new Date(row.createdAt),
        updatedAt: new Date(row.updatedAt),
    }))
}

export async function replaceRoomMcpBindings(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    mcpConnectionIds: string[]
}): Promise<void> {
    const now = nowIso()
    const mcpConnectionIds = Array.from(new Set(input.mcpConnectionIds))
    await assertHostedMcpConnectionIdsExist({
        env: input.env,
        workspaceId: input.workspaceId,
        mcpConnectionIds,
    })
    const statements = [
        input.env.AGENT_ROOM_DB.prepare(
            `
                DELETE FROM hosted_room_mcp_binding
                WHERE workspace_id = ?1
                  AND room_id = ?2
            `,
        ).bind(input.workspaceId, input.roomId),
        ...mcpConnectionIds.map((id) =>
            input.env.AGENT_ROOM_DB.prepare(
                `
                    INSERT INTO hosted_room_mcp_binding (
                        workspace_id,
                        room_id,
                        mcp_connection_id,
                        allowed_tools,
                        enabled,
                        created_at,
                        updated_at
                    )
                    VALUES (?1, ?2, ?3, '[]', 1, ?4, ?4)
                `,
            ).bind(input.workspaceId, input.roomId, id, now),
        ),
    ]
    await input.env.AGENT_ROOM_DB.batch(statements)
}

export async function assertHostedMcpConnectionIdsExist(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    mcpConnectionIds: string[]
}): Promise<void> {
    const mcpConnectionIds = Array.from(new Set(input.mcpConnectionIds))
    if (mcpConnectionIds.length === 0) {
        return
    }
    const availableConnections = await listHostedMcp({
        env: input.env,
        workspaceId: input.workspaceId,
    })
    const availableIds = new Set(availableConnections.map((connection) => connection.id))
    const missingIds = mcpConnectionIds.filter((id) => !availableIds.has(id))
    if (missingIds.length > 0) {
        throw new Error(`MCP connection not found: ${missingIds.join(', ')}`)
    }
}

export async function listRoomSecrets(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
}): Promise<RoomSecretRecord[]> {
    const rows = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT
                id,
                room_id AS roomId,
                secret_id AS secretId,
                label,
                env_key AS envKey,
                purpose,
                provider,
                created_by_user_id AS createdByUserId,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM hosted_room_secret
            WHERE workspace_id = ?1
              AND room_id = ?2
            ORDER BY updated_at DESC
        `,
    )
        .bind(input.workspaceId, input.roomId)
        .all<HostedRoomSecretRow>()
    return rows.results.map((row) => ({
        id: row.id,
        roomId: row.roomId,
        secretId: row.secretId,
        label: row.label,
        envKey: row.envKey,
        purpose: row.purpose as RoomSecretRecord['purpose'],
        provider: row.provider,
        createdByUserId: row.createdByUserId,
        createdAt: new Date(row.createdAt),
        updatedAt: new Date(row.updatedAt),
    }))
}

export function summarizeRoomSecret(record: RoomSecretRecord): RoomSecretSummary {
    return {
        id: record.id,
        label: record.label,
        envKey: record.envKey,
        purpose: record.purpose,
        provider: record.provider,
        updatedAt: record.updatedAt.toISOString(),
    }
}

interface HostedRoomConfigRow {
    roomId: string
    instructions: string
    providerMode: string
    providerConnectionId: string | null
    roomMode: string
    capabilityOverrides: string
    imageProvider: string | null
    imageModel: string | null
    imageSecretId: string | null
    cronTimezone: string
    browserActionBudget: number
    createdAt: string
    updatedAt: string
}

interface HostedRoomMcpBindingRow {
    roomId: string
    mcpConnectionId: string
    allowedTools: string
    enabled: number
    createdAt: string
    updatedAt: string
}

interface HostedRoomSecretRow {
    id: string
    roomId: string
    secretId: string
    label: string
    envKey: string
    purpose: string
    provider: string | null
    createdByUserId: string | null
    createdAt: string
    updatedAt: string
}
