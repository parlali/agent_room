import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { withRuntimeStartLock } from './runtime-process-store'

describe('runtime process store', () => {
    it('coalesces concurrent runtime starts for the same room', async () => {
        const roomId = `room-${randomUUID()}`
        let calls = 0
        let resolveStart: () => void = () => {}
        const started = new Promise<void>((resolve) => {
            resolveStart = resolve
        })

        const first = withRuntimeStartLock(roomId, async () => {
            calls += 1
            await started
        })
        const second = withRuntimeStartLock(roomId, async () => {
            calls += 1
        })

        expect(calls).toBe(1)
        resolveStart()

        await Promise.all([first, second])
        expect(calls).toBe(1)
    })

    it('clears failed starts so the room can retry', async () => {
        const roomId = `room-${randomUUID()}`
        let calls = 0

        await expect(
            withRuntimeStartLock(roomId, async () => {
                calls += 1
                throw new Error('startup failed')
            }),
        ).rejects.toThrow('startup failed')

        await withRuntimeStartLock(roomId, async () => {
            calls += 1
        })

        expect(calls).toBe(2)
    })
})
