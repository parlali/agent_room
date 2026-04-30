import { describe, expect, it } from 'vitest'
import { assertNoReservedRoomRuntimeEnvKeys, buildBoundedProcessEnv } from './process-env'

describe('bounded process environment', () => {
    it('forwards only non-secret runtime essentials plus explicit overrides', () => {
        const previousDatabaseUrl = process.env.DATABASE_URL
        process.env.DATABASE_URL = 'postgres://secret'
        try {
            const env = buildBoundedProcessEnv({
                HOME: '/room/home',
                OPENROUTER_API_KEY: 'room-secret',
            })

            expect(env.PATH).toBeTruthy()
            expect(env.HOME).toBe('/room/home')
            expect(env.OPENROUTER_API_KEY).toBe('room-secret')
            expect(env.DATABASE_URL).toBeUndefined()
        } finally {
            if (previousDatabaseUrl === undefined) {
                delete process.env.DATABASE_URL
            } else {
                process.env.DATABASE_URL = previousDatabaseUrl
            }
        }
    })

    it('rejects materialized runtime env keys that would shadow app or wrapper state', () => {
        expect(() =>
            assertNoReservedRoomRuntimeEnvKeys({
                database_url: 'postgres://room-controlled',
            }),
        ).toThrow(/DATABASE_URL/)
    })
})
