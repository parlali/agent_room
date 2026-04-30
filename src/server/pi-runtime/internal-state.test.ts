import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import {
    buildInternalStateSummary,
    ensureInternalState,
    internalStatePolicy,
    readInternalStateDocument,
    writeInternalStateDocument,
} from './internal-state'
import { createInternalStateTools } from './internal-state-tools'

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
    it('creates hidden bounded markdown documents under Pi state', async () => {
        await withRoom(async (config) => {
            await ensureInternalState(config)
            const memory = await readInternalStateDocument(config, 'memory')

            expect(memory.path.startsWith(config.paths.internalStateDir)).toBe(true)
            expect(memory.path.startsWith(config.paths.workspaceDir)).toBe(false)
            expect(memory.content).toContain('# Memory')
            expect(memory.maxBytes).toBe(12000)
        })
    })

    it('enforces hard caps and optimistic updates', async () => {
        await withRoom(async (config) => {
            const previous = await readInternalStateDocument(config, 'tasks')
            await writeInternalStateDocument({
                config,
                kind: 'tasks',
                content: '# Tasks\n\n- [x] Done\n',
                expectedSha256: previous.sha256,
            })

            await expect(
                writeInternalStateDocument({
                    config,
                    kind: 'tasks',
                    content: 'x'.repeat(previous.maxBytes + 1),
                    expectedSha256: previous.sha256,
                }),
            ).rejects.toThrow(/hard cap/)
            await expect(
                writeInternalStateDocument({
                    config,
                    kind: 'tasks',
                    content: '# Tasks\n',
                    expectedSha256: previous.sha256,
                }),
            ).rejects.toThrow(/changed before update/)
        })
    })

    it('builds a capped summary without exposing raw workspace files', async () => {
        await withRoom(async (config) => {
            await mkdir(join(config.paths.workspaceDir, 'notes'), {
                recursive: true,
            })
            await writeInternalStateDocument({
                config,
                kind: 'memory',
                content: '# Memory\n\nOperator prefers short answers.\n',
            })
            const summary = await buildInternalStateSummary(config)

            expect(summary.text).toContain('memory.md')
            expect(summary.text).toContain('Operator prefers short answers')
            expect(summary.text.length).toBeLessThanOrEqual(internalStatePolicy.maxInjectedBytes)
            await expect(
                readFile(join(config.paths.workspaceDir, 'memory.md'), 'utf8'),
            ).rejects.toThrow()
        })
    })

    it('exposes internal state only through dedicated tools', async () => {
        await withRoom(async (config) => {
            const read = await executeTool(config, 'agent_room_memory_read', {
                document: 'plan.md',
            })
            const sha = (read.result.details as { sha256: string }).sha256
            const update = await executeTool(config, 'agent_room_memory_update', {
                document: 'plan',
                expectedSha256: sha,
                content: '# Plan\n\nCurrent objective: verify internal memory.\n',
            })

            expect(resultText(read.result)).toContain('# Plan')
            expect(resultText(update.result)).toBe('Updated plan.md')
            expect(update.events.map((event) => event.event)).toEqual([
                'tool.internal_state.update',
            ])
        })
    })
})
