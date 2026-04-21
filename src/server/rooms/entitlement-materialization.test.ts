import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { RoomEntitlementRecord, SecretRecord } from '../domain/types'
import { encryptSecret } from '../security/encryption'
import { materializeEntitlements } from './entitlement-materialization'

function buildSecret(
    secretId: string,
    keyName: string,
    plainText: string,
    encryptionKey: Buffer,
): SecretRecord {
    const encrypted = encryptSecret(plainText, encryptionKey, 1)
    const now = new Date()
    return {
        id: secretId,
        keyName,
        cipherText: encrypted.cipherText,
        nonce: encrypted.nonce,
        authTag: encrypted.authTag,
        keyVersion: encrypted.keyVersion,
        createdAt: now,
        updatedAt: now,
    }
}

describe('entitlement materialization', () => {
    it('writes provider secret and binds env key', async () => {
        const tempDir = await mkdtemp(join(tmpdir(), 'agent-room-entitlement-'))
        const encryptionKey = randomBytes(32)
        const secret = buildSecret('secret-1', 'github-api', 'ghp_secret', encryptionKey)
        const entitlement: RoomEntitlementRecord = {
            id: 'ent-1',
            roomId: 'room-1',
            kind: 'github',
            provider: 'github',
            accountId: 'acct-1',
            serverId: null,
            scope: {},
            secretId: secret.id,
            status: 'active',
            version: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
        }

        const result = await materializeEntitlements({
            runtimeSecretsDir: tempDir,
            entitlements: [entitlement],
            secretById: new Map([[secret.id, secret]]),
            encryptionKey,
        })

        expect(Object.keys(result.env).length).toBe(1)
        const content = await readFile(join(tempDir, `${entitlement.id}.secret`), 'utf8')
        expect(content).toBe('ghp_secret')
    })

    it('fails closed for invalid mcp scope', async () => {
        const tempDir = await mkdtemp(join(tmpdir(), 'agent-room-entitlement-'))
        const result = materializeEntitlements({
            runtimeSecretsDir: tempDir,
            entitlements: [
                {
                    id: 'ent-mcp',
                    roomId: 'room-1',
                    kind: 'mcp',
                    provider: 'demo',
                    accountId: null,
                    serverId: 'mcp-demo',
                    scope: { transport: 'stdio', allowedTools: ['search'] },
                    secretId: null,
                    status: 'active',
                    version: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ],
            secretById: new Map(),
            encryptionKey: randomBytes(32),
        })

        await expect(result).rejects.toThrow('requires command')
    })
})
