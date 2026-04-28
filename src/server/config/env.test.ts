import { Buffer } from 'node:buffer'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { __testing } from './env'

describe('bootstrap credential autogeneration', () => {
    it('creates a bootstrap file with generated root credentials in a fresh data directory', async () => {
        const dataDir = await mkdtemp(join(tmpdir(), 'agent-room-bootstrap-'))

        const result = __testing.resolveBootstrapPayload({
            dataDir,
            providedSessionTtlHours: 24,
        })

        expect(result.generatedNewPayload).toBe(true)
        expect(result.generatedNewPassword).toBe(true)
        expect(result.generatedNewEncryptionKey).toBe(true)
        expect(result.payload.rootEmail).toBe('root@agent-room.local')
        expect(result.payload.rootPassword).toHaveLength(32)
        expect(Buffer.from(result.payload.encryptionKeyB64, 'base64')).toHaveLength(32)

        const bootstrapPath = join(dataDir, 'system', 'bootstrap.json')
        const file = JSON.parse(await readFile(bootstrapPath, 'utf8')) as typeof result.payload
        const fileMode = (await stat(bootstrapPath)).mode & 0o777

        expect(file).toEqual(result.payload)
        expect(fileMode).toBe(0o600)
    })

    it('reuses existing generated credentials instead of rotating them silently', async () => {
        const dataDir = await mkdtemp(join(tmpdir(), 'agent-room-bootstrap-'))
        const first = __testing.resolveBootstrapPayload({
            dataDir,
            providedSessionTtlHours: 24,
        })

        const second = __testing.resolveBootstrapPayload({
            dataDir,
            providedSessionTtlHours: 24,
        })

        expect(second.generatedNewPayload).toBe(false)
        expect(second.generatedNewPassword).toBe(false)
        expect(second.generatedNewEncryptionKey).toBe(false)
        expect(second.payload.rootEmail).toBe(first.payload.rootEmail)
        expect(second.payload.rootPassword).toBe(first.payload.rootPassword)
        expect(second.payload.encryptionKeyB64).toBe(first.payload.encryptionKeyB64)
    })
})
