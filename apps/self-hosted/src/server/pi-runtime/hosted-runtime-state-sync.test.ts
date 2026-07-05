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
    calls: [] as CallbackCall[],
    waiters: [] as Array<{ count: number; resolve: () => void }>,
}))

interface CallbackCall {
    body: unknown
    release: () => void
    released: boolean
}

vi.mock('./hosted-runtime-callback', () => ({
    postHostedRuntimeCallback: async (input: { body: unknown }) => {
        let release!: () => void
        const gate = new Promise<void>((resolve) => {
            release = resolve
        })
        const call: CallbackCall = {
            body: input.body,
            release: () => {
                if (call.released) {
                    return
                }
                call.released = true
                release()
            },
            released: false,
        }
        control.calls.push(call)
        control.active += 1
        control.maxActive = Math.max(control.maxActive, control.active)
        const ready = control.waiters.filter((waiter) => control.calls.length >= waiter.count)
        control.waiters = control.waiters.filter((waiter) => control.calls.length < waiter.count)
        for (const waiter of ready) {
            waiter.resolve()
        }
        try {
            await gate
        } finally {
            control.active -= 1
        }
    },
}))

function waitForCallbackCalls(count: number): Promise<void> {
    if (control.calls.length >= count) {
        return Promise.resolve()
    }
    return new Promise((resolve) => {
        control.waiters.push({ count, resolve })
    })
}

function releaseStartedCalls(): void {
    for (const call of control.calls) {
        call.release()
    }
}

async function releaseCallsUntilStarted(count: number): Promise<void> {
    while (control.calls.length < count) {
        const started = waitForCallbackCalls(control.calls.length + 1)
        releaseStartedCalls()
        await started
    }
}

function callbackState(call: CallbackCall): {
    operation?: string
    relativePath?: string
    contentBase64?: string
} {
    const body = call.body as {
        state?: {
            operation?: string
            relativePath?: string
            contentBase64?: string
        }
    }
    expect(body.state).toBeTruthy()
    return body.state!
}

function callbackContentText(call: CallbackCall): string {
    const state = callbackState(call)
    expect(state.contentBase64).toBeTruthy()
    return Buffer.from(state.contentBase64!, 'base64url').toString('utf8')
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
        control.calls = []
        control.waiters = []
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

        const first = sync.upsert(path)
        await waitForCallbackCalls(1)
        expect(control.calls).toHaveLength(1)
        expect(callbackState(control.calls[0]!).relativePath).toBe('threads.json')
        expect(callbackContentText(control.calls[0]!)).toBe('first')

        await writeFile(path, 'second')
        const trailing = [sync.upsert(path), sync.upsert(path), sync.upsert(path)]
        expect(control.calls).toHaveLength(1)

        control.calls[0]!.release()
        await first
        await waitForCallbackCalls(2)
        expect(control.calls).toHaveLength(2)
        expect(callbackState(control.calls[1]!).relativePath).toBe('threads.json')
        expect(callbackContentText(control.calls[1]!)).toBe('second')

        control.calls[1]!.release()
        await Promise.all(trailing)
        expect(control.calls).toHaveLength(2)
    })

    it('bounds concurrency across distinct paths to the configured pool size', async () => {
        const sync = createHostedRuntimeStateSync(makeConfig(stateDir))

        await mkdir(join(stateDir, 'sessions'), { recursive: true })
        const promises: Array<Promise<void>> = []
        for (let index = 0; index < 12; index += 1) {
            const path = join(stateDir, 'sessions', `file-${index}.jsonl`)
            await writeFile(path, `content-${index}`)
            promises.push(sync.upsert(path))
        }

        await waitForCallbackCalls(4)
        expect(control.calls).toHaveLength(4)
        expect(control.active).toBe(4)
        expect(control.maxActive).toBe(4)

        control.calls[0]!.release()
        await waitForCallbackCalls(5)
        expect(control.calls).toHaveLength(5)
        expect(control.active).toBe(4)
        expect(control.maxActive).toBe(4)

        await releaseCallsUntilStarted(12)
        releaseStartedCalls()
        await Promise.all(promises)
        expect(control.calls).toHaveLength(12)
        expect(control.active).toBe(0)
        expect(control.maxActive).toBe(4)
    })
})
