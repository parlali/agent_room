import { eq, inArray } from 'drizzle-orm'
import type { SecretRecord } from '#/domain/domain-types'
import { secrets } from '../schema'
import { mapSecret } from './row-mappers'
import { createDatabaseId, excluded, nowDate, repositoryDatabase } from './repository-utils'

export const secretRepository = {
    async upsertSecret(input: {
        keyName: string
        cipherText: Buffer
        nonce: Buffer
        authTag: Buffer
        keyVersion: number
    }): Promise<SecretRecord> {
        const db = await repositoryDatabase()
        const now = nowDate()
        const [row] = await db
            .insert(secrets)
            .values({
                id: createDatabaseId(),
                keyName: input.keyName,
                cipherText: input.cipherText,
                nonce: input.nonce,
                authTag: input.authTag,
                keyVersion: input.keyVersion,
                createdAt: now,
                updatedAt: now,
            })
            .onConflictDoUpdate({
                target: secrets.keyName,
                set: {
                    cipherText: excluded('cipher_text'),
                    nonce: excluded('nonce'),
                    authTag: excluded('auth_tag'),
                    keyVersion: excluded('key_version'),
                    updatedAt: now,
                },
            })
            .returning()
        return mapSecret(row)
    },

    async findById(secretId: string): Promise<SecretRecord | null> {
        const db = await repositoryDatabase()
        const [row] = await db.select().from(secrets).where(eq(secrets.id, secretId)).limit(1)
        return row ? mapSecret(row) : null
    },

    async findByKeyName(keyName: string): Promise<SecretRecord | null> {
        const db = await repositoryDatabase()
        const [row] = await db.select().from(secrets).where(eq(secrets.keyName, keyName)).limit(1)
        return row ? mapSecret(row) : null
    },

    async deleteById(secretId: string): Promise<boolean> {
        const db = await repositoryDatabase()
        const rows = await db.delete(secrets).where(eq(secrets.id, secretId)).returning({
            id: secrets.id,
        })
        return rows.length > 0
    },

    async listByIds(secretIds: string[]): Promise<SecretRecord[]> {
        if (secretIds.length === 0) {
            return []
        }

        const db = await repositoryDatabase()
        const rows = await db.select().from(secrets).where(inArray(secrets.id, secretIds))
        return rows.map(mapSecret)
    },
}
