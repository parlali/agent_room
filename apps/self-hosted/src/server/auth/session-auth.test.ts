import { describe, expect, it } from 'vitest'
import { __testing } from './session-auth'

describe('session auth helpers', () => {
    it('detects loopback hosts for cookie secure mode', () => {
        expect(__testing.resolveCookieSecureFlag('http://localhost:3000')).toBe(false)
        expect(__testing.resolveCookieSecureFlag('http://127.0.0.1:3000')).toBe(false)
        expect(__testing.resolveCookieSecureFlag('https://localhost:3000')).toBe(true)
        expect(__testing.resolveCookieSecureFlag('http://agent-room.internal')).toBe(true)
        expect(
            __testing.resolveCookieSecureFlag(
                'http://agent-room.internal',
                'https://agent.example.ts.net',
            ),
        ).toBe(true)
    })

    it('bounds cookie max-age at zero', () => {
        const now = Date.now()
        expect(__testing.resolveCookieMaxAge(new Date(now - 1_000))).toBe(0)
        expect(__testing.resolveCookieMaxAge(new Date(now + 30_000))).toBeGreaterThan(0)
    })

    it('compares origins safely', () => {
        expect(__testing.isSameOrigin('http://localhost:3000', 'http://localhost:3000/path')).toBe(
            true,
        )
        expect(__testing.isSameOrigin('https://localhost:3000', 'http://localhost:3000/path')).toBe(
            false,
        )
        expect(__testing.isSameOrigin('http://localhost:3000', 'http://127.0.0.1:3000/path')).toBe(
            false,
        )
        expect(__testing.isSameOrigin('not-a-url', 'http://localhost:3000/path')).toBe(false)
    })

    it('resolves a configured public origin for reverse-proxied requests', () => {
        expect(
            __testing.resolveEffectiveRequestUrl(
                'http://agent-room.example.test/_server',
                'https://agent-room.example.test',
            ),
        ).toBe('https://agent-room.example.test/_server')
        expect(
            __testing.isSameOrigin(
                'https://agent-room.example.test',
                __testing.resolveEffectiveRequestUrl(
                    'http://agent-room.example.test/_server',
                    'https://agent-room.example.test',
                ),
            ),
        ).toBe(true)
    })
})
