import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from './password'

describe('password hashing', () => {
    it('hashes and verifies password', () => {
        const hash = hashPassword('a-very-strong-root-password')
        expect(verifyPassword('a-very-strong-root-password', hash)).toBe(true)
        expect(verifyPassword('wrong-password', hash)).toBe(false)
    })
})
