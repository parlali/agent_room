import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RoomSecretRecord, SecretRecord } from '#/domain/domain-types'
import { encryptSecret } from '../security/encryption'
import { __testing } from './operator-configuration'

function buildSecret(input: {
    id: string
    keyName: string
    plainText: string
    encryptionKey: Buffer
}): SecretRecord {
    const encrypted = encryptSecret(input.plainText, input.encryptionKey, 1)
    const now = new Date('2026-04-23T00:00:00.000Z')
    return {
        id: input.id,
        keyName: input.keyName,
        cipherText: encrypted.cipherText,
        nonce: encrypted.nonce,
        authTag: encrypted.authTag,
        keyVersion: encrypted.keyVersion,
        createdAt: now,
        updatedAt: now,
    }
}

function buildRoomSecret(input: {
    id: string
    roomId: string
    secretId: string
    envKey: string
    purpose?: RoomSecretRecord['purpose']
}): RoomSecretRecord {
    const now = new Date('2026-04-23T00:00:00.000Z')
    return {
        id: input.id,
        roomId: input.roomId,
        secretId: input.secretId,
        label: 'Verification Secret',
        envKey: input.envKey,
        purpose: input.purpose ?? 'generic',
        provider: null,
        createdByUserId: 'user-1',
        createdAt: now,
        updatedAt: now,
    }
}

describe('operator configuration materialization', () => {
    it('materializes room-scoped secrets into the room runtime secret directory and env', async () => {
        const tempDir = await mkdtemp(join(tmpdir(), 'agent-room-room-secret-'))
        const encryptionKey = randomBytes(32)
        const secret = buildSecret({
            id: 'secret-1',
            keyName: 'room:room-1:secret:VERIFY_ROOM_SECRET',
            plainText: 'local-test-secret',
            encryptionKey,
        })
        const roomSecret = buildRoomSecret({
            id: 'room-secret-1',
            roomId: 'room-1',
            secretId: secret.id,
            envKey: 'verify_room_secret',
        })

        const result = await __testing.materializeRoomSecrets({
            roomSecrets: [roomSecret],
            runtimeSecretsDir: tempDir,
            secretById: new Map([[secret.id, secret]]),
            encryptionKey,
            reservedEnvKeys: new Set(['ANTHROPIC_API_KEY']),
        })

        expect(result.env).toEqual({
            VERIFY_ROOM_SECRET: 'local-test-secret',
        })
        expect(result.secretRefs).toEqual([
            {
                entitlementId: 'room_secret:room-secret-1',
                secretId: secret.id,
                filePath: join(tempDir, 'verify_room_secret.secret'),
                envKey: 'VERIFY_ROOM_SECRET',
            },
        ])
        await expect(readFile(join(tempDir, 'verify_room_secret.secret'), 'utf8')).resolves.toBe(
            'local-test-secret',
        )
    })

    it('fails closed when a room secret would overwrite another materialized env key', async () => {
        const tempDir = await mkdtemp(join(tmpdir(), 'agent-room-room-secret-'))
        const encryptionKey = randomBytes(32)
        const secret = buildSecret({
            id: 'secret-1',
            keyName: 'room:room-1:secret:ANTHROPIC_API_KEY',
            plainText: 'local-test-secret',
            encryptionKey,
        })
        const roomSecret = buildRoomSecret({
            id: 'room-secret-1',
            roomId: 'room-1',
            secretId: secret.id,
            envKey: 'anthropic_api_key',
        })

        await expect(
            __testing.materializeRoomSecrets({
                roomSecrets: [roomSecret],
                runtimeSecretsDir: tempDir,
                secretById: new Map([[secret.id, secret]]),
                encryptionKey,
                reservedEnvKeys: new Set(['ANTHROPIC_API_KEY']),
            }),
        ).rejects.toThrow(
            'Room secret env key ANTHROPIC_API_KEY conflicts with materialized config',
        )
    })

    it('fails closed when a room secret would override runtime control env', async () => {
        const tempDir = await mkdtemp(join(tmpdir(), 'agent-room-room-secret-'))
        const encryptionKey = randomBytes(32)
        const secret = buildSecret({
            id: 'secret-1',
            keyName: 'room:room-1:secret:DATABASE_URL',
            plainText: 'postgres://room-controlled',
            encryptionKey,
        })
        const roomSecret = buildRoomSecret({
            id: 'room-secret-1',
            roomId: 'room-1',
            secretId: secret.id,
            envKey: 'database_url',
        })

        await expect(
            __testing.materializeRoomSecrets({
                roomSecrets: [roomSecret],
                runtimeSecretsDir: tempDir,
                secretById: new Map([[secret.id, secret]]),
                encryptionKey,
                reservedEnvKeys: new Set(),
            }),
        ).rejects.toThrow(/reserved keys: DATABASE_URL/)
    })

    it('does not materialize provider API key records as generic room secrets', async () => {
        const tempDir = await mkdtemp(join(tmpdir(), 'agent-room-room-secret-'))
        const encryptionKey = randomBytes(32)
        const secret = buildSecret({
            id: 'secret-1',
            keyName: 'room:room-1:secret:OPENAI_API_KEY',
            plainText: 'local-test-secret',
            encryptionKey,
        })
        const roomSecret = buildRoomSecret({
            id: 'room-secret-1',
            roomId: 'room-1',
            secretId: secret.id,
            envKey: 'openai_api_key',
            purpose: 'provider_api_key',
        })

        const result = await __testing.materializeRoomSecrets({
            roomSecrets: [roomSecret],
            runtimeSecretsDir: tempDir,
            secretById: new Map([[secret.id, secret]]),
            encryptionKey,
            reservedEnvKeys: new Set(),
        })

        expect(result.env).toEqual({})
        expect(result.secretRefs).toEqual([])
    })
})
