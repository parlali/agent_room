import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import {
    buildInternalStateSummary,
    ensureInternalState,
    internalStatePolicy,
} from './internal-state'
import { createInternalStateTools } from './internal-state-tools'
import { emptyRoomMemory, patchMemory, readMemory, replaceMemory } from './memory'
import { testBudgets, testCapabilities, testImage, testSearch } from './test-runtime-defaults'

function testConfig(root: string): PiRuntimeConfig {
    return {
        runtime: {
            kind: 'pi',
            roomId: 'room-1',
            displayName: 'Room One',
            bindHost: '127.0.0.1',
            port: 32123,
            token: 'token-token-token-token-token',
        },
        paths: {
            roomRootDir: root,
            stateDir: join(root, 'pi-state'),
            workspaceDir: join(root, 'workspace'),
            storeDir: join(root, 'store'),
            sessionsDir: join(root, 'pi-state', 'sessions'),
            internalStateDir: join(root, 'pi-state', 'internal-state'),
            authPath: join(root, 'pi-state', 'auth.json'),
            modelsPath: join(root, 'pi-state', 'models.json'),
            threadIndexPath: join(root, 'pi-state', 'threads.json'),
            runtimeEventsPath: join(root, 'pi-state', 'runtime-events.jsonl'),
            homeDir: join(root, 'pi-state', 'home'),
            tmpDir: join(root, 'pi-state', 'tmp'),
        },
        provider: {
            sourceProvider: 'ollama',
            sourceModel: 'llama',
            piProvider: 'ollama',
            piModel: 'llama',
            api: 'openai-completions',
            authMode: 'api_key',
            baseUrl: 'http://127.0.0.1:11434/v1',
            envKey: null,
            kind: 'local',
            fallbackModels: [],
        },
        tools: {
            profile: 'coding',
        },
        capabilities: testCapabilities,
        search: testSearch,
        image: testImage,
        budgets: testBudgets,
        instructions: '',
        mcpServers: [],
        models: {
            providers: {},
        },
        compaction: {
            enabled: true,
            reserveTokens: 16384,
            keepRecentTokens: 20000,
        },
    }
}

async function withRoom<T>(fn: (config: PiRuntimeConfig) => Promise<T>): Promise<T> {
    const root = await mkdtemp(join(tmpdir(), 'agent-room-internal-state-'))
    const config = testConfig(root)
    await mkdir(config.paths.workspaceDir, {
        recursive: true,
    })
    await mkdir(config.paths.storeDir, {
        recursive: true,
    })
    try {
        return await fn(config)
    } finally {
        await rm(root, {
            recursive: true,
            force: true,
        })
    }
}

async function executeTool(config: PiRuntimeConfig, name: string, input: object) {
    const events: Array<{ event: string; payload: unknown }> = []
    const tools = createInternalStateTools({
        config,
        audit: async (event, payload) => {
            events.push({ event, payload })
        },
    })
    const tool = tools.find((entry) => entry.name === name)
    if (!tool) {
        throw new Error(`Missing tool ${name}`)
    }
    const result = await tool.execute('call-1', input as never, undefined, undefined, {} as never)
    return {
        result,
        events,
    }
}

function resultText(result: Awaited<ReturnType<typeof executeTool>>['result']): string {
    const part = result.content[0]
    return part && 'text' in part && typeof part.text === 'string' ? part.text : ''
}

describe('internal agent state', () => {
    it('creates canonical JSON memory under Pi state', async () => {
        await withRoom(async (config) => {
            await ensureInternalState(config)
            const memory = await readMemory(config)

            expect(memory.path.startsWith(config.paths.internalStateDir)).toBe(true)
            expect(memory.path.startsWith(config.paths.workspaceDir)).toBe(false)
            expect(memory.memory.version).toBe(1)
            expect(memory.byteLength).toBeGreaterThan(0)
        })
    })

    it('enforces hard caps and optimistic updates', async () => {
        await withRoom(async (config) => {
            await ensureInternalState(config)
            const previous = await readMemory(config)
            const memory = {
                ...previous.memory,
                currentWork: {
                    ...previous.memory.currentWork,
                    goals: [
                        {
                            id: 'goal-1',
                            text: 'Done',
                            createdAt: new Date().toISOString(),
                        },
                    ],
                },
            }
            await replaceMemory({
                config,
                memory,
                expectedHash: previous.hash,
            })
            const updated = await readMemory(config)

            await expect(
                replaceMemory({
                    config,
                    memory: {
                        ...emptyRoomMemory(),
                        doNotForget: [
                            {
                                id: 'large',
                                text: 'x'.repeat(70000),
                                createdAt: new Date().toISOString(),
                            },
                        ],
                    },
                    expectedHash: updated.hash,
                }),
            ).rejects.toThrow(/hard cap/)
            await expect(
                replaceMemory({
                    config,
                    memory: emptyRoomMemory(),
                    expectedHash: previous.hash,
                }),
            ).rejects.toThrow(/changed before update/)
        })
    })

    it('builds a capped summary without exposing raw workspace files', async () => {
        await withRoom(async (config) => {
            await ensureInternalState(config)
            await mkdir(join(config.paths.workspaceDir, 'notes'), {
                recursive: true,
            })
            await patchMemory({
                config,
                patches: [
                    {
                        op: 'add',
                        section: 'operator.preferences',
                        text: 'Operator prefers short answers.',
                    },
                ],
            })
            const summary = await buildInternalStateSummary(config)

            expect(summary.text).toContain('Room memory brief')
            expect(summary.text).toContain('Operator prefers short answers')
            expect(summary.text.length).toBeLessThanOrEqual(internalStatePolicy.maxInjectedBytes)
            await expect(
                readFile(join(config.paths.workspaceDir, 'memory.md'), 'utf8'),
            ).rejects.toThrow()
        })
    })

    it('exposes internal state only through dedicated tools', async () => {
        await withRoom(async (config) => {
            await ensureInternalState(config)
            const read = await executeTool(config, 'agent_room_memory_read', {})
            const hash = (read.result.details as { hash: string }).hash
            const update = await executeTool(config, 'agent_room_memory_patch', {
                expectedHash: hash,
                patches: [
                    {
                        op: 'add',
                        section: 'currentWork.context',
                        text: 'Current objective: verify internal memory.',
                    },
                ],
            })

            expect(resultText(read.result)).toContain('"memory"')
            expect(resultText(update.result)).toContain('Current objective')
            expect(update.events.map((event) => event.event)).toEqual(['tool.memory.patch'])
        })
    })

    it('rejects unknown memory patch sections instead of writing to a fallback section', async () => {
        await withRoom(async (config) => {
            await ensureInternalState(config)
            const read = await executeTool(config, 'agent_room_memory_read', {})
            const hash = (read.result.details as { hash: string }).hash

            await expect(
                executeTool(config, 'agent_room_memory_patch', {
                    expectedHash: hash,
                    patches: [
                        {
                            op: 'add',
                            section: 'operator.preferencez',
                            text: 'This should not be stored.',
                        },
                    ],
                }),
            ).rejects.toThrow('canonical memory section')

            const after = await readMemory(config)
            expect(after.memory.doNotForget.map((item) => item.text)).not.toContain(
                'This should not be stored.',
            )
        })
    })

    it('marks stale timed memory once without changing the hash on every read', async () => {
        await withRoom(async (config) => {
            await ensureInternalState(config)
            await patchMemory({
                config,
                patches: [
                    {
                        op: 'add',
                        section: 'schedule.reminders',
                        text: 'Expired reminder',
                        dueAt: '2020-01-01T00:00:00.000Z',
                    },
                ],
            })

            const first = await readMemory(config)
            const second = await readMemory(config)

            expect(first.memory.schedule.reminders[0]?.tags).toContain('stale')
            expect(second.hash).toBe(first.hash)
        })
    })
})
