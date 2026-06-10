import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto'

const PBKDF2_ITERATIONS = 210_000
const PBKDF2_KEYLEN = 32
const PBKDF2_DIGEST = 'sha512'

export function hashSessionToken(token: string): string {
    return createHash('sha256').update(token).digest('hex')
}

export function hashPassword(password: string): string {
    if (password.length < 12) {
        throw new Error('Password must be at least 12 characters')
    }
    const salt = randomBytes(16)
    const derived = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST)
    return [
        'pbkdf2',
        PBKDF2_DIGEST,
        String(PBKDF2_ITERATIONS),
        salt.toString('base64'),
        derived.toString('base64'),
    ].join('$')
}

export function verifyPassword(password: string, encoded: string): boolean {
    const [scheme, digest, rawIterations, rawSalt, rawHash] = encoded.split('$')
    if (!scheme || !digest || !rawIterations || !rawSalt || !rawHash) {
        return false
    }
    if (scheme !== 'pbkdf2' || digest !== PBKDF2_DIGEST) {
        return false
    }
    const iterations = Number(rawIterations)
    if (!Number.isInteger(iterations) || iterations <= 0) {
        return false
    }
    const salt = Buffer.from(rawSalt, 'base64')
    const expectedHash = Buffer.from(rawHash, 'base64')
    const derived = pbkdf2Sync(password, salt, iterations, expectedHash.length, PBKDF2_DIGEST)
    if (derived.length !== expectedHash.length) {
        return false
    }
    return timingSafeEqual(derived, expectedHash)
}
