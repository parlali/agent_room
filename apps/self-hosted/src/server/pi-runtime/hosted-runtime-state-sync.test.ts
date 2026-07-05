import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import {
    hostedRuntimeStateCallbackUrlEnvKey,
    hostedRuntimeUsageCallbackTokenEnvKey,
    hostedRuntimeWorkspaceIdEnvKey,
} from '../rooms/pi-runtime-contract'
import { createHostedRuntimeStateSync } from './hosted-runtime-state-sync'

const control = vi.hoisted(() => ({
    active: 0,
    maxActive: 0,
    total: 0,
    gate: null as Promise<void> | null,
    bodies: [] as unknown[],
}))

vi.mock('./hosted-runtime-callback', () => ({
    postHostedRuntimeCallback: async (input: { body: unknown }) => {
        control.total += 1
        control.bodies.push(input.body)
        control.active += 1
        control.maxActive = Math.max(control.maxActive, control.active)
        try {
            if (control.gate) {
                await control.gate
            }
        } finally {
            control.active -= 1
        }
    },
}))

function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void
    const promise = new Promise<void>((res) => {
        resolve = res
    })
    return { promise, resolve }
}

function delay(ms: number): Promise<void> {
    return new Promise((done) => {
        setTimeout(done, ms)
    })
}

function makeConfig(stateDir: string): PiRuntimeConfig {
    return {
        paths: { stateDir },
        runtime: { roomId: 'room-test' },
    } as unknown as PiRuntimeConfig
}

describe('createHostedRuntimeStateSync', () => {
    let stateDir: string

    beforeEach(async () => {
        control.active = 0
        control.maxActive = 0
        control.total = 0
        control.gate = null
        control.bodies = []
        process.env[hostedRuntimeStateCallbackUrlEnvKey] = 'https://example.test/state'
        process.env[hostedRuntimeUsageCallbackTokenEnvKey] = 'token'
        process.env[hostedRuntimeWorkspaceIdEnvKey] = 'workspace'
        stateDir = await mkdtemp(join(tmpdir(), 'state-sync-'))
    })

    afterEach(async () => {
        delete process.env[hostedRuntimeStateCallbackUrlEnvKey]
        delete process.env[hostedRuntimeUsageCallbackTokenEnvKey]
        delete process.env[hostedRuntimeWorkspaceIdEnvKey]
        await rm(stateDir, { recursive: true, force: true })
    })

    it('coalesces rapid same-path upserts into a first and a single trailing write', async () => {
        const sync = createHostedRuntimeStateSync(makeConfig(stateDir))
        const path = join(stateDir, 'threads.json')
        await writeFile(path, 'first')

        const gate = deferred()
        control.gate = gate.promise
        const first = sync.upsert(path)
        await delay(5)
        expect(control.total).toBe(1)

        await writeFile(path, 'second')
        const trailing = [sync.upsert(path), sync.upsert(path), sync.upsert(path)]
        gate.resolve()
        await Promise.all([first, ...trailing])

        expect(control.total).toBe(2)
    })

    it('bounds concurrency across distinct paths to the configured pool size', async () => {
        const sync = createHostedRuntimeStateSync(makeConfig(stateDir))
        const gate = deferred()
        control.gate = gate.promise

        await mkdir(join(stateDir, 'sessions'), { recursive: true })
        const promises: Array<Promise<void>> = []
        for (let index = 0; index < 12; index += 1) {
            const path = join(stateDir, 'sessions', `file-${index}.jsonl`)
            await writeFile(path, `content-${index}`)
            promises.push(sync.upsert(path))
        }

        await delay(20)
        expect(control.maxActive).toBe(4)

        gate.resolve()
        await Promise.all(promises)
        expect(control.total).toBe(12)
    })
})
