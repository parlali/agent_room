import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import {
    buildAgentRoomSystemPrompt,
    contextBudgetForProvider,
    loadInstructionFiles,
} from './system-prompt'

function testConfig(root: string): PiRuntimeConfig {
    return {
        runtime: {
            kind: 'pi',
            roomId: 'room-1',
            displayName: 'Ops',
            bindHost: '127.0.0.1',
            port: 3001,
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
            sourceModel: 'ollama/llama3.2',
            piProvider: 'ollama',
            piModel: 'llama3.2',
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
        instructions: 'Operator-owned instruction',
        mcpServers: [
            {
                id: 'docs',
                provider: 'Docs',
                allowedTools: ['search'],
                transport: 'stdio',
                command: 'docs',
                args: [],
                url: null,
                env: {},
                headers: {},
            },
        ],
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

async function withConfig<T>(fn: (config: PiRuntimeConfig) => Promise<T>): Promise<T> {
    const root = await mkdtemp(join(tmpdir(), 'agent-room-prompt-'))
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

describe('Agent Room Pi system prompt', () => {
    it('builds a bounded prompt with provider, tool, scheduling, artifact, and credential policy', async () => {
        await withConfig(async (config) => {
            await writeFile(
                join(config.paths.workspaceDir, 'AGENTS.md'),
                'Workspace policy',
                'utf8',
            )

            const prompt = await buildAgentRoomSystemPrompt(config)

            expect(prompt).toContain('Room id: room-1')
            expect(prompt).toContain('Provider: ollama')
            expect(prompt).toContain('Model: ollama/llama3.2')
            expect(prompt).toContain('Enabled built-in tools: agent_room_memory_read')
            expect(prompt).toContain('agent_room_memory_read')
            expect(prompt).toContain('Enabled MCP servers: docs: search')
            expect(prompt).toContain('Scheduled jobs enter through the same room session path')
            expect(prompt).toContain('Internal state harness')
            expect(prompt).toContain('memory.md')
            expect(prompt).toContain('Operator-owned instruction')
            expect(prompt).toContain('Workspace policy')
            expect(prompt.length).toBeLessThanOrEqual(
                contextBudgetForProvider(config).systemPromptMaxChars,
            )
        })
    })

    it('loads only explicit workspace instruction files and skips legacy duplicated room instructions', async () => {
        await withConfig(async (config) => {
            await writeFile(
                join(config.paths.workspaceDir, 'AGENTS.md'),
                'Operator-owned instruction',
                'utf8',
            )
            await mkdir(join(config.paths.workspaceDir, '.agents'), {
                recursive: true,
            })
            await writeFile(
                join(config.paths.workspaceDir, '.agents', 'AGENTS.md'),
                'Nested policy',
                'utf8',
            )

            await expect(loadInstructionFiles(config)).resolves.toEqual([
                {
                    path: '.agents/AGENTS.md',
                    text: 'Nested policy',
                    truncated: false,
                },
            ])
        })
    })

    it('does not follow instruction-file symlinks outside the workspace', async () => {
        await withConfig(async (config) => {
            await writeFile(join(config.paths.roomRootDir, 'outside.md'), 'outside policy', 'utf8')
            await symlink(
                join(config.paths.roomRootDir, 'outside.md'),
                join(config.paths.workspaceDir, 'AGENTS.md'),
            )

            await expect(loadInstructionFiles(config)).resolves.toEqual([])
        })
    })
})
