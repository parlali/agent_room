import { describe, expect, it } from 'vitest'
import { __testing } from './codex-auth'

describe('Codex auth status helpers', () => {
    it('handles OAuth expiry timestamps expressed in seconds or milliseconds', () => {
        const nowMs = Date.parse('2026-04-30T00:00:00.000Z')
        const futureSeconds = Math.floor(nowMs / 1000) + 3600
        const pastSeconds = Math.floor(nowMs / 1000) - 3600
        const futureMs = nowMs + 3600_000
        const pastMs = nowMs - 3600_000

        expect(
            __testing.profileIsExpired(
                {
                    expires: futureSeconds,
                },
                nowMs,
            ),
        ).toBe(false)
        expect(
            __testing.profileIsExpired(
                {
                    expires: pastSeconds,
                },
                nowMs,
            ),
        ).toBe(true)
        expect(
            __testing.profileIsExpired(
                {
                    expires: futureMs,
                },
                nowMs,
            ),
        ).toBe(false)
        expect(
            __testing.profileIsExpired(
                {
                    expires: pastMs,
                },
                nowMs,
            ),
        ).toBe(true)
    })
})
