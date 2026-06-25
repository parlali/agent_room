import { describe, expect, it } from 'vitest'
import { timingSafeEqualHex, timingSafeEqualString } from './timing-safe'

describe('timing-safe comparisons', () => {
    it('rejects mismatched webhook signatures without requiring equal input lengths', () => {
        expect(timingSafeEqualString('short', 'longer')).toBe(false)
        expect(timingSafeEqualHex('abcd', 'abce')).toBe(false)
    })
})
