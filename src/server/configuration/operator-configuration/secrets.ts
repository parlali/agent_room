import type { SecretRecord } from '../../domain/types'
import { secretRepository } from '../../db/repositories'
import { getAppEnv } from '../../config/env'
import { decryptSecret, encryptSecret } from '../../security/encryption'

export async function upsertEncryptedSecret(input: {
    keyName: string
    plainText: string
}): Promise<SecretRecord> {
    const env = getAppEnv()
    const existing = await secretRepository.findByKeyName(input.keyName)
    const encrypted = encryptSecret(
        input.plainText,
        env.encryptionKey,
        (existing?.keyVersion ?? 0) + 1,
    )
    return secretRepository.upsertSecret({
        keyName: input.keyName,
        cipherText: encrypted.cipherText,
        nonce: encrypted.nonce,
        authTag: encrypted.authTag,
        keyVersion: encrypted.keyVersion,
    })
}

export async function resolveSecret(secretId: string | null): Promise<SecretRecord | null> {
    if (!secretId) {
        return null
    }
    return secretRepository.findById(secretId)
}

export function decryptSecretRecord(secret: SecretRecord, encryptionKey: Buffer): string {
    return decryptSecret(
        {
            cipherText: secret.cipherText,
            nonce: secret.nonce,
            authTag: secret.authTag,
            keyVersion: secret.keyVersion,
        },
        encryptionKey,
    )
}
