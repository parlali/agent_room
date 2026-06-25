import type { AppMcpConnectionRecord, JsonValue } from '#/domain/domain-types'
import {
    parseHeaders,
    redactedMcpHeaderValue,
    toStringRecord,
} from '../configuration/operator-configuration/helpers'
import type { AgentRoomHostedEnv } from './bindings'
import {
    deleteHostedSecret,
    readHostedSecretPlainText,
    upsertHostedSecret,
} from './hosted-secret-store'

const hostedMcpHeaderSecretRefPrefix = 'hosted-secret:'

export function hostedMcpHeaderSecretRef(secretId: string): string {
    return `${hostedMcpHeaderSecretRefPrefix}${secretId}`
}

export function hostedMcpHeaderSecretId(value: string): string | null {
    return value.startsWith(hostedMcpHeaderSecretRefPrefix)
        ? value.slice(hostedMcpHeaderSecretRefPrefix.length)
        : null
}

export function hostedMcpHeaderSecretKey(input: {
    connectionId: string
    headerName: string
}): string {
    return `app_mcp:${input.connectionId}:header:${encodeURIComponent(input.headerName)}`
}

export async function hostedMcpHeadersFromInput(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    connectionId: string
    existing: AppMcpConnectionRecord | null
    headersText: string | undefined
}): Promise<Record<string, string>> {
    const submitted = parseHeaders(input.headersText)
    const existingHeaders = input.existing ? toStringRecord(input.existing.headers) : {}
    const headers: Record<string, string> = {}
    for (const [key, value] of Object.entries(submitted)) {
        if (value === redactedMcpHeaderValue && existingHeaders[key] !== undefined) {
            headers[key] = existingHeaders[key]
            continue
        }
        const secretId = await upsertHostedSecret({
            env: input.env,
            workspaceId: input.workspaceId,
            keyName: hostedMcpHeaderSecretKey({
                connectionId: input.connectionId,
                headerName: key,
            }),
            plainText: value,
        })
        headers[key] = hostedMcpHeaderSecretRef(secretId)
    }
    return headers
}

export async function deleteHostedMcpHeaderSecrets(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    headers: JsonValue
    keepSecretIds?: Set<string>
}): Promise<void> {
    const secretIds = Object.values(toStringRecord(input.headers))
        .map(hostedMcpHeaderSecretId)
        .filter((secretId): secretId is string => secretId !== null)
    for (const secretId of secretIds) {
        if (!input.keepSecretIds?.has(secretId)) {
            await deleteHostedSecret({
                env: input.env,
                workspaceId: input.workspaceId,
                secretId,
            })
        }
    }
}

export async function resolveHostedMcpHeaders(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    connection: AppMcpConnectionRecord
}): Promise<Record<string, string>> {
    const headers: Record<string, string> = {}
    for (const [key, value] of Object.entries(toStringRecord(input.connection.headers))) {
        const secretId = hostedMcpHeaderSecretId(value)
        if (!secretId) {
            throw new Error(`MCP connection ${input.connection.serverKey} has unencrypted header`)
        }
        const plainText = await readHostedSecretPlainText({
            env: input.env,
            workspaceId: input.workspaceId,
            secretId,
        })
        if (!plainText) {
            throw new Error(`MCP connection ${input.connection.serverKey} header ${key} is missing`)
        }
        headers[key] = plainText
    }
    return headers
}
