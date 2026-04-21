import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import type { EncryptedSecretPayload } from '../domain/types'

const AES_ALGO = 'aes-256-gcm'

export function encryptSecret(
    plainText: string,
    encryptionKey: Buffer,
    keyVersion: number,
): EncryptedSecretPayload {
    if (encryptionKey.length !== 32) {
        throw new Error('Encryption key must be 32 bytes')
    }
    const nonce = randomBytes(12)
    const cipher = createCipheriv(AES_ALGO, encryptionKey, nonce)
    const cipherText = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()])
    const authTag = cipher.getAuthTag()
    return {
        cipherText,
        nonce,
        authTag,
        keyVersion,
    }
}

export function decryptSecret(payload: EncryptedSecretPayload, encryptionKey: Buffer): string {
    if (encryptionKey.length !== 32) {
        throw new Error('Encryption key must be 32 bytes')
    }
    const decipher = createDecipheriv(AES_ALGO, encryptionKey, payload.nonce)
    decipher.setAuthTag(payload.authTag)
    const plainText = Buffer.concat([decipher.update(payload.cipherText), decipher.final()])
    return plainText.toString('utf8')
}
