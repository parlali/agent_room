import { randomUUID } from 'node:crypto'
import {
    appMcpConnectionRepository,
    auditRepository,
    secretRepository,
} from '../../db/repositories'
import { getAppEnv } from '../../config/env'
import { validateMcpConnection } from '../connection-validation'
import type { McpConnectionSummary, McpSaveInput } from './contracts'
import { mcpSaveSchema } from './contracts'
import { nullableText, parseArgs, parseCsv, parseHeaders, summarizeMcp } from './helpers'
import { decryptSecretRecord, resolveSecret, upsertEncryptedSecret } from './secrets'

export async function saveMcpConnection(
    rawInput: McpSaveInput,
    actorUserId: string,
): Promise<McpConnectionSummary> {
    const input = mcpSaveSchema.parse(rawInput)
    const id = input.id ?? randomUUID()
    const existing = input.id ? await appMcpConnectionRepository.findById(input.id) : null
    const args = parseArgs(input.argsText)
    const headers = parseHeaders(input.headersText)
    const allowedTools = parseCsv(input.allowedToolsText)
    const command = nullableText(input.command)
    const url = nullableText(input.url)

    if (input.transport === 'stdio' && !command) {
        throw new Error('MCP stdio transport requires a command')
    }
    if (input.transport !== 'stdio' && !url) {
        throw new Error('MCP HTTP transport requires a URL')
    }
    if (url) {
        const parsed = new URL(url)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            throw new Error('MCP URL must use http or https')
        }
    }

    const bearerToken = input.bearerToken?.trim() ?? ''
    let credentialSecretId = existing?.credentialSecretId ?? null
    let secretAction: string | null = null

    if (input.authMode === 'bearer') {
        if (bearerToken) {
            const secret = await upsertEncryptedSecret({
                keyName: `app_mcp:${id}:bearer`,
                plainText: bearerToken,
            })
            credentialSecretId = secret.id
            secretAction = existing?.credentialSecretId ? 'secret.rotated' : 'secret.created'
        } else if (!credentialSecretId) {
            throw new Error('Bearer token is required for bearer-auth MCP connections')
        }
    } else {
        credentialSecretId = null
    }

    let validationBearerToken: string | null = null
    if (input.authMode === 'bearer') {
        validationBearerToken = bearerToken || null
        if (!validationBearerToken && credentialSecretId) {
            const existingSecret = await resolveSecret(credentialSecretId)
            if (existingSecret) {
                validationBearerToken = decryptSecretRecord(
                    existingSecret,
                    getAppEnv().encryptionKey,
                )
            }
        }
    }

    const validation = await validateMcpConnection({
        transport: input.transport,
        command,
        args,
        url,
        headers,
        authMode: input.authMode,
        bearerToken: validationBearerToken,
    })

    const saved = await appMcpConnectionRepository.upsert({
        id,
        name: input.name,
        serverKey: input.serverKey,
        transport: input.transport,
        command,
        args,
        url,
        headers,
        authMode: input.authMode,
        credentialSecretId,
        allowedTools,
        status: validation.status,
        validationMessage: validation.message,
        lastValidatedAt: new Date(),
        createdByUserId: actorUserId,
    })

    if (secretAction) {
        await auditRepository.appendEvent({
            actorUserId,
            roomId: null,
            action: `mcp_connection.${secretAction}`,
            payload: {
                mcpConnectionId: saved.id,
                serverKey: saved.serverKey,
            },
        })
    }

    await auditRepository.appendEvent({
        actorUserId,
        roomId: null,
        action: 'mcp_connection.saved',
        payload: {
            mcpConnectionId: saved.id,
            serverKey: saved.serverKey,
            transport: saved.transport,
            hasCredential: saved.credentialSecretId !== null,
        },
    })

    return summarizeMcp(saved)
}

export async function deleteMcpConnection(input: {
    id: string
    actorUserId: string
}): Promise<{ id: string }> {
    const existing = await appMcpConnectionRepository.findById(input.id)
    if (!existing) {
        throw new Error('Connected tool does not exist')
    }

    const roomBindings = await appMcpConnectionRepository.countRoomBindings(existing.id)
    if (roomBindings > 0) {
        throw new Error(
            `Connected tool is used by ${roomBindings} room${roomBindings === 1 ? '' : 's'}. Remove it from those rooms before deleting.`,
        )
    }

    const deleted = await appMcpConnectionRepository.deleteByIdIfUnused(existing.id)
    if (!deleted) {
        const currentBindings = await appMcpConnectionRepository.countRoomBindings(existing.id)
        if (currentBindings > 0) {
            throw new Error(
                `Connected tool is used by ${currentBindings} room${currentBindings === 1 ? '' : 's'}. Remove it from those rooms before deleting.`,
            )
        }
        throw new Error('Connected tool could not be deleted')
    }

    if (existing.credentialSecretId) {
        await secretRepository.deleteById(existing.credentialSecretId)
    }

    await auditRepository.appendEvent({
        actorUserId: input.actorUserId,
        roomId: null,
        action: 'mcp_connection.deleted',
        payload: {
            mcpConnectionId: existing.id,
            serverKey: existing.serverKey,
            transport: existing.transport,
            hadCredential: existing.credentialSecretId !== null,
        },
    })

    return { id: existing.id }
}
