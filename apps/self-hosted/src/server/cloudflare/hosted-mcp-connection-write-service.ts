import { randomUUID } from 'node:crypto'
import type { AppMcpConnectionRecord } from '#/domain/domain-types'
import type { McpConnectionSummary } from '../configuration/operator-configuration'
import { parseArgs, parseCsv } from '../configuration/operator-configuration/helpers'
import type { AgentRoomHostedEnv } from './bindings'
import { appendHostedAudit } from './hosted-audit'
import type { HostedActor } from './hosted-auth'
import { validateHostedMcpConnection } from './hosted-connection-validation'
import { assertChanged } from './hosted-d1'
import { nowIso, stringifyJson } from './hosted-json'
import {
    deleteHostedMcpHeaderSecrets,
    hostedMcpHeaderSecretId,
    hostedMcpHeadersFromInput,
} from './hosted-mcp-header-secrets'
import { findHostedMcp, summarizeHostedMcp } from './hosted-operator-config-service'
import {
    listRunningHostedRoomIdsForMcpConnection,
    rematerializeRunningHostedRooms,
} from './hosted-room-service'
import { assertHostedRuntimeEgressUrlLiteral } from './hosted-runtime-egress-policy'
import { deleteHostedSecret, upsertHostedSecret } from './hosted-secret-store'

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
