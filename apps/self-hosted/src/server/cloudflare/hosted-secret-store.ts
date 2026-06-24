import { Buffer } from 'node:buffer'
import type { AgentRoomHostedEnv } from './bindings'
import { resolveHostedConfig } from './hosted-config'
import { nowIso } from './hosted-json'

const authTagBytes = 16

function decodeBase64(input: string): Uint8Array {
    return Uint8Array.from(Buffer.from(input, 'base64'))
}

function encodeBase64(input: Uint8Array): string {
    return Buffer.from(input).toString('base64')
}

function exactArrayBuffer(input: Uint8Array): ArrayBuffer {
    return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer
}

function encryptionKeyBytes(env: AgentRoomHostedEnv): Uint8Array {
    const bytes = decodeBase64(resolveHostedConfig(env).encryptionKeyB64)
    if (bytes.byteLength !== 32) {
        throw new Error('Hosted encryption key must decode to 32 bytes')
    }
    return bytes
}

async function importEncryptionKey(env: AgentRoomHostedEnv): Promise<CryptoKey> {
    return crypto.subtle.importKey(
        'raw',
        exactArrayBuffer(encryptionKeyBytes(env)),
        'AES-GCM',
        false,
        ['encrypt', 'decrypt'],
    )
}

export async function encryptHostedSecret(input: {
    env: AgentRoomHostedEnv
    plainText: string
}): Promise<{
    cipherText: string
    nonce: string
    authTag: string
    keyVersion: number
}> {
    const nonce = crypto.getRandomValues(new Uint8Array(12))
    const encrypted = new Uint8Array(
        await crypto.subtle.encrypt(
            {
                name: 'AES-GCM',
                iv: exactArrayBuffer(nonce),
                tagLength: authTagBytes * 8,
            },
            await importEncryptionKey(input.env),
            new TextEncoder().encode(input.plainText),
        ),
    )
    return {
        cipherText: encodeBase64(encrypted.subarray(0, encrypted.byteLength - authTagBytes)),
        nonce: encodeBase64(nonce),
        authTag: encodeBase64(encrypted.subarray(encrypted.byteLength - authTagBytes)),
        keyVersion: 1,
    }
}

export async function decryptHostedSecret(input: {
    env: AgentRoomHostedEnv
    cipherText: string
    nonce: string
    authTag: string
}): Promise<string> {
    const cipherText = decodeBase64(input.cipherText)
    const authTag = decodeBase64(input.authTag)
    const sealed = new Uint8Array(cipherText.byteLength + authTag.byteLength)
    sealed.set(cipherText, 0)
    sealed.set(authTag, cipherText.byteLength)
    const decrypted = await crypto.subtle.decrypt(
        {
            name: 'AES-GCM',
            iv: exactArrayBuffer(decodeBase64(input.nonce)),
            tagLength: authTagBytes * 8,
        },
        await importEncryptionKey(input.env),
        exactArrayBuffer(sealed),
    )
    return new TextDecoder().decode(decrypted)
}

export async function upsertHostedSecret(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    keyName: string
    plainText: string
    now?: Date
}): Promise<string> {
    const id = crypto.randomUUID()
    const encrypted = await encryptHostedSecret({
        env: input.env,
        plainText: input.plainText,
    })
    const now = nowIso(input.now)
    const existing = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT id
            FROM hosted_secret
            WHERE workspace_id = ?1
              AND key_name = ?2
        `,
    )
        .bind(input.workspaceId, input.keyName)
        .first<{ id: string }>()
    if (existing) {
        await input.env.AGENT_ROOM_DB.prepare(
            `
                UPDATE hosted_secret
                SET cipher_text = ?1,
                    nonce = ?2,
                    auth_tag = ?3,
                    key_version = ?4,
                    updated_at = ?5
                WHERE workspace_id = ?6
                  AND id = ?7
            `,
        )
            .bind(
                encrypted.cipherText,
                encrypted.nonce,
                encrypted.authTag,
                encrypted.keyVersion,
                now,
                input.workspaceId,
                existing.id,
            )
            .run()
        return existing.id
    }
    await input.env.AGENT_ROOM_DB.prepare(
        `
            INSERT INTO hosted_secret (
                id,
                workspace_id,
                key_name,
                cipher_text,
                nonce,
                auth_tag,
                key_version,
                created_at,
                updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
        `,
    )
        .bind(
            id,
            input.workspaceId,
            input.keyName,
            encrypted.cipherText,
            encrypted.nonce,
            encrypted.authTag,
            encrypted.keyVersion,
            now,
        )
        .run()
    return id
}

export async function readHostedSecretPlainText(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    secretId: string | null
}): Promise<string | null> {
    if (!input.secretId) {
        return null
    }
    const row = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT
                cipher_text AS cipherText,
                nonce,
                auth_tag AS authTag
            FROM hosted_secret
            WHERE workspace_id = ?1
              AND id = ?2
        `,
    )
        .bind(input.workspaceId, input.secretId)
        .first<{ cipherText: string; nonce: string; authTag: string }>()
    if (!row) {
        return null
    }
    return decryptHostedSecret({
        env: input.env,
        cipherText: row.cipherText,
        nonce: row.nonce,
        authTag: row.authTag,
    })
}

export async function deleteHostedSecret(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    secretId: string | null
}): Promise<void> {
    if (!input.secretId) {
        return
    }
    await input.env.AGENT_ROOM_DB.prepare(
        `
            DELETE FROM hosted_secret
            WHERE workspace_id = ?1
              AND id = ?2
        `,
    )
        .bind(input.workspaceId, input.secretId)
        .run()
}
