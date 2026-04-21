import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret } from './encryption'

describe('secret encryption', () => {
    it('round-trips encrypted payload', () => {
        const key = randomBytes(32)
        const payload = encryptSecret('provider-api-key', key, 1)
        const plainText = decryptSecret(payload, key)
        expect(plainText).toBe('provider-api-key')
    })
})
