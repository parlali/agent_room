import { describe, expect, it } from 'vitest'
import { __testing } from './codex-oauth-flow'

describe('codex oauth flow helpers', () => {
    it('accepts full redirect URLs with code and state parameters', () => {
        expect(
            __testing.validateRedirectUrlValue(
                'http://localhost:1455/auth/callback?code=abc&state=expected',
            ),
        ).toBe('http://localhost:1455/auth/callback?code=abc&state=expected')
    })

    it('rejects redirect URLs missing OAuth state', () => {
        expect(() =>
            __testing.validateRedirectUrlValue('http://localhost:1455/auth/callback?code=abc'),
        ).toThrow('Redirect URL must include code and state parameters')
    })
})
