import type { SecretRecord } from '../../domain/types'
import { sql } from '../client'
import { mapSecret } from './row-mappers'

export const secretRepository = {
    async upsertSecret(input: {
        keyName: string
        cipherText: Buffer
        nonce: Buffer
        authTag: Buffer
        keyVersion: number
    }): Promise<SecretRecord> {
        const rows = await sql`
            INSERT INTO secrets (key_name, cipher_text, nonce, auth_tag, key_version, created_at, updated_at)
            VALUES (${input.keyName}, ${input.cipherText}, ${input.nonce}, ${input.authTag}, ${input.keyVersion}, now(), now())
            ON CONFLICT (key_name)
            DO UPDATE SET
                cipher_text = excluded.cipher_text,
                nonce = excluded.nonce,
                auth_tag = excluded.auth_tag,
                key_version = excluded.key_version,
                updated_at = now()
            RETURNING *
        `
        return mapSecret(rows[0] as Record<string, unknown>)
    },

    async findById(secretId: string): Promise<SecretRecord | null> {
        const rows = await sql`SELECT * FROM secrets WHERE id = ${secretId} LIMIT 1`
        if (rows.length === 0) {
            return null
        }
        return mapSecret(rows[0] as Record<string, unknown>)
    },

    async findByKeyName(keyName: string): Promise<SecretRecord | null> {
        const rows = await sql`SELECT * FROM secrets WHERE key_name = ${keyName} LIMIT 1`
        if (rows.length === 0) {
            return null
        }
        return mapSecret(rows[0] as Record<string, unknown>)
    },

    async listByIds(secretIds: string[]): Promise<SecretRecord[]> {
        if (secretIds.length === 0) {
            return []
        }
        const rows = await sql`
            SELECT *
            FROM secrets
            WHERE id IN ${sql(secretIds)}
        `
        return rows.map((row) => mapSecret(row as Record<string, unknown>))
    },
}
