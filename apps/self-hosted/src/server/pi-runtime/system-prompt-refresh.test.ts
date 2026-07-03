import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import { ensureMemory, patchMemory, readMemory } from './memory'
import { buildAgentRoomSystemPrompt, systemPromptInputSignature } from './system-prompt'
import { createSystemPromptRefresher, type RefreshableActiveThread } from './system-prompt-refresh'
import { createTestPiRuntimeConfig, ensureTestPiRuntimeDirectories } from './test-runtime-defaults'

interface SpyActiveThread extends RefreshableActiveThread {
    reloads: number
}

function fakeActive(): SpyActiveThread {
    const active: SpyActiveThread = {
        promptVersion: 0,
        reloads: 0,
        session: {
            reload: async () => {
                active.reloads += 1
            },
        },
    }
    return active
}

async function withRoom<T>(fn: (config: PiRuntimeConfig) => Promise<T>): Promise<T> {
    const root = await mkdtemp(join(tmpdir(), 'agent-room-system-prompt-refresh-'))
    const config = createTestPiRuntimeConfig({ root })
    await ensureTestPiRuntimeDirectories(config)
    try {
        return await fn(config)
    } finally {
        await rm(root, {
            recursive: true,
            force: true,
        })
    }
}

describe('createSystemPromptRefresher', () => {
    it('rebuilds and reloads only when the input signature changes', async () => {
        let builds = 0
        let signature = 'sig-1'
        const refresher = createSystemPromptRefresher({
            build: async () => {
                builds += 1
                return `prompt-${builds}`
            },
            inputSignature: async () => signature,
        })
        await refresher.initialize()
        expect(builds).toBe(1)
        expect(refresher.current()).toBe('prompt-1')

        const active = fakeActive()
        active.promptVersion = refresher.currentVersion()

        await refresher.refresh(active)
        expect(builds).toBe(1)
        expect(active.reloads).toBe(0)

        signature = 'sig-2'
        await refresher.refresh(active)
        expect(builds).toBe(2)
        expect(refresher.current()).toBe('prompt-2')
        expect(active.reloads).toBe(1)

        await refresher.refresh(active)
        expect(builds).toBe(2)
        expect(active.reloads).toBe(1)
    })

    it('rebuilds once but reloads every session still holding a stale prompt version', async () => {
        let builds = 0
        let signature = 'sig-1'
        const refresher = createSystemPromptRefresher({
            build: async () => {
                builds += 1
                return `prompt-${builds}`
            },
            inputSignature: async () => signature,
        })
        await refresher.initialize()

        const first = fakeActive()
        const second = fakeActive()
        first.promptVersion = refresher.currentVersion()
        second.promptVersion = refresher.currentVersion()

        signature = 'sig-2'
        await refresher.refresh(first)
        expect(builds).toBe(2)
        expect(first.reloads).toBe(1)
        expect(second.reloads).toBe(0)

        await refresher.refresh(second)
        expect(builds).toBe(2)
        expect(second.reloads).toBe(1)
    })

    it('rebuilds and reloads when the signature cannot be computed', async () => {
        let builds = 0
        const refresher = createSystemPromptRefresher({
            build: async () => {
                builds += 1
                return `prompt-${builds}`
            },
            inputSignature: async () => {
                throw new Error('stat failed')
            },
        })
        await refresher.initialize()
        expect(builds).toBe(1)

        const active = fakeActive()
        active.promptVersion = refresher.currentVersion()
        await refresher.refresh(active)
        expect(builds).toBe(2)
        expect(active.reloads).toBe(1)
    })
})

describe('system prompt invalidation against real memory', () => {
    it('rebuilds the prompt after a memory write and skips when memory is unchanged', async () => {
        await withRoom(async (config) => {
            await ensureMemory(config)
            const refresher = createSystemPromptRefresher({
                build: () => buildAgentRoomSystemPrompt(config),
                inputSignature: () => systemPromptInputSignature(config),
            })
            await refresher.initialize()
            const initialPrompt = refresher.current()

            const active = fakeActive()
            active.promptVersion = refresher.currentVersion()

            await refresher.refresh(active)
            expect(refresher.current()).toBe(initialPrompt)
            expect(active.reloads).toBe(0)

            const before = await readMemory(config)
            await patchMemory({
                config,
                patches: [
                    {
                        op: 'add',
                        section: 'doNotForget',
                        text: 'Remember the launch checklist marker',
                    },
                ],
                expectedHash: before.hash,
            })

            await refresher.refresh(active)
            const updatedPrompt = refresher.current()
            expect(updatedPrompt).not.toBe(initialPrompt)
            expect(updatedPrompt).toContain('Remember the launch checklist marker')
            expect(active.reloads).toBe(1)

            await refresher.refresh(active)
            expect(refresher.current()).toBe(updatedPrompt)
            expect(active.reloads).toBe(1)
        })
    })
})
