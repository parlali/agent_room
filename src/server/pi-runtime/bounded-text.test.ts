import { describe, expect, it } from 'vitest'
import { boundTextByChars, boundTextByUtf8Bytes } from './bounded-text'

describe('bounded text', () => {
    it('clips by characters without adding marker text', () => {
        expect(boundTextByChars('abcdef', 4)).toEqual({
            text: 'abcd',
            truncated: true,
        })
        expect(boundTextByChars('abc', 4)).toEqual({
            text: 'abc',
            truncated: false,
        })
    })

    it('clips by utf8 bytes without splitting multi-byte characters', () => {
        const result = boundTextByUtf8Bytes('aaébb', 3)

        expect(result).toEqual({
            text: 'aa',
            truncated: true,
        })
        expect(Buffer.byteLength(result.text, 'utf8')).toBeLessThanOrEqual(3)
    })
})
