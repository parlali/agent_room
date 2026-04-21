import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type {
    MaterializedEntitlements,
    MaterializedMcpServer,
    RoomEntitlementRecord,
    SecretRecord,
} from '../domain/types'
import { decryptSecret } from '../security/encryption'

const mcpScopeSchema = z.object({
    transport: z.enum(['stdio', 'http']),
    command: z.string().min(1).optional(),
    args: z.array(z.string()).default([]),
    url: z.url().optional(),
    allowedTools: z.array(z.string()).default([]),
    env: z.record(z.string(), z.string()).default({}),
})

function upperSnake(value: string): string {
    return value
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toUpperCase()
}

function requireSecret(entitlement: RoomEntitlementRecord, secretById: Map<string, SecretRecord>) {
    if (!entitlement.secretId) {
        throw new Error(`Entitlement ${entitlement.id} (${entitlement.kind}) is missing secret_id`)
    }
    const secret = secretById.get(entitlement.secretId)
    if (!secret) {
        throw new Error(
            `Secret ${entitlement.secretId} for entitlement ${entitlement.id} was not found`,
        )
    }
    return secret
}

function materializeMcpServer(input: {
    entitlement: RoomEntitlementRecord
    decryptedSecret: string | null
}): MaterializedMcpServer {
    const parsedScope = mcpScopeSchema.safeParse(input.entitlement.scope)
    if (!parsedScope.success) {
        throw new Error(
            `Invalid MCP entitlement scope for ${input.entitlement.id}: ${parsedScope.error.message}`,
        )
    }
    const scope = parsedScope.data
    if (scope.transport === 'stdio' && !scope.command) {
        throw new Error(
            `MCP entitlement ${input.entitlement.id} requires command for stdio transport`,
        )
    }
    if (scope.transport === 'http' && !scope.url) {
        throw new Error(`MCP entitlement ${input.entitlement.id} requires url for http transport`)
    }
    const env = scope.env
    if (input.decryptedSecret) {
        env.MCP_AUTH_TOKEN = input.decryptedSecret
    }
    return {
        id: input.entitlement.serverId ?? input.entitlement.id,
        provider: input.entitlement.provider,
        allowedTools: scope.allowedTools,
        transport: scope.transport,
        command: scope.command ?? null,
        args: scope.args,
        url: scope.url ?? null,
        env,
        headers: {},
    }
}

export async function materializeEntitlements(input: {
    runtimeSecretsDir: string
    entitlements: RoomEntitlementRecord[]
    secretById: Map<string, SecretRecord>
    encryptionKey: Buffer
}): Promise<MaterializedEntitlements> {
    const env: Record<string, string> = {}
    const secretRefs: MaterializedEntitlements['secretRefs'] = []
    const mcpServers: MaterializedMcpServer[] = []

    for (const entitlement of input.entitlements) {
        if (entitlement.kind === 'mcp') {
            const secret = entitlement.secretId
                ? requireSecret(entitlement, input.secretById)
                : null
            const decryptedSecret = entitlement.secretId
                ? decryptSecret(
                      {
                          cipherText: secret!.cipherText,
                          nonce: secret!.nonce,
                          authTag: secret!.authTag,
                          keyVersion: secret!.keyVersion,
                      },
                      input.encryptionKey,
                  )
                : null
            mcpServers.push(
                materializeMcpServer({
                    entitlement,
                    decryptedSecret,
                }),
            )
            continue
        }

        const secret = requireSecret(entitlement, input.secretById)
        const plainText = decryptSecret(
            {
                cipherText: secret.cipherText,
                nonce: secret.nonce,
                authTag: secret.authTag,
                keyVersion: secret.keyVersion,
            },
            input.encryptionKey,
        )

        const envKey = `${upperSnake(entitlement.kind)}_${upperSnake(entitlement.provider)}_${upperSnake(entitlement.id)}_SECRET`
        const secretFilePath = join(input.runtimeSecretsDir, `${entitlement.id}.secret`)

        await writeFile(secretFilePath, plainText, {
            encoding: 'utf8',
            mode: 0o600,
        })

        env[envKey] = plainText
        secretRefs.push({
            entitlementId: entitlement.id,
            secretId: secret.id,
            filePath: secretFilePath,
            envKey,
        })
    }

    return {
        env,
        secretRefs,
        mcpServers,
    }
}
