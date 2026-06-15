import { describe, expect, it } from 'vitest'
import {
    assertNoReservedRoomRuntimeEnvKeys,
    buildBoundedProcessEnv,
    disableImplicitEnvFileForCommand,
} from './process-env'

describe('bounded process environment', () => {
    it('forwards only non-secret runtime essentials plus explicit overrides', () => {
        const previousDatabaseUrl = process.env.DATABASE_URL
        process.env.DATABASE_URL = 'postgres://secret'
        try {
            const env = buildBoundedProcessEnv({
                HOME: '/room/home',
                ROOM_TEST_SECRET: 'room-secret',
            })

            expect(env.PATH).toBeTruthy()
            expect(env.HOME).toBe('/room/home')
            expect(env.ROOM_TEST_SECRET).toBe('room-secret')
            expect(env.DATABASE_URL).toBeUndefined()
        } finally {
            if (previousDatabaseUrl === undefined) {
                delete process.env.DATABASE_URL
            } else {
                process.env.DATABASE_URL = previousDatabaseUrl
            }
        }
    })

    it('never forwards operator secrets that are added to the parent environment later', () => {
        const operatorSecrets = {
            SUPABASE_SERVICE_ROLE_KEY: 'supabase-service-role',
            SUPABASE_DB_URL: 'postgres://supabase-secret',
            STRIPE_SECRET_KEY: 'sk_live_secret',
            AGENT_ROOM_ENCRYPTION_KEY_B64: 'encryption-key',
            OPENAI_API_KEY: 'operator-openai-key',
        }
        const previous = new Map<string, string | undefined>()
        for (const [key, value] of Object.entries(operatorSecrets)) {
            previous.set(key, process.env[key])
            process.env[key] = value
        }
        try {
            const env = buildBoundedProcessEnv({
                HOME: '/room/home',
            })
            for (const key of Object.keys(operatorSecrets)) {
                expect(env[key]).toBeUndefined()
            }
        } finally {
            for (const [key, value] of previous) {
                if (value === undefined) {
                    delete process.env[key]
                } else {
                    process.env[key] = value
                }
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

    it('disables Bun implicit env file loading for child commands', () => {
        expect(disableImplicitEnvFileForCommand('bun', ['server.ts'])).toEqual([
            '--no-env-file',
            'server.ts',
        ])
        expect(
            disableImplicitEnvFileForCommand('/usr/bin/bun', ['--no-env-file', 'server.ts']),
        ).toEqual(['--no-env-file', 'server.ts'])
        expect(disableImplicitEnvFileForCommand('sh', ['-c', 'echo ok'])).toEqual(['-c', 'echo ok'])
    })
})
