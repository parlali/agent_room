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
import { createTestPiRuntimeConfig, ensureTestPiRuntimeDirectories } from './test-runtime-defaults'

function testConfig(root: string): PiRuntimeConfig {
    return createTestPiRuntimeConfig({
        root,
        runtime: {
            displayName: 'Ops',
            port: 3001,
        },
        provider: {
            sourceModel: 'ollama/llama3.2',
            piModel: 'llama3.2',
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
    })
}

async function withConfig<T>(fn: (config: PiRuntimeConfig) => Promise<T>): Promise<T> {
    const root = await mkdtemp(join(tmpdir(), 'agent-room-prompt-'))
    const config = testConfig(root)
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

describe('Agent Room Pi system prompt', () => {
    it('builds a bounded prompt with provider, tool, scheduling, artifact, and credential policy', async () => {
        await withConfig(async (config) => {
            await writeFile(
                join(config.paths.workspaceDir, 'AGENTS.md'),
                'Workspace policy',
                'utf8',
            )

            const prompt = await buildAgentRoomSystemPrompt(config)

            expect(prompt).toContain('persistent room-local coworker')
            expect(prompt).toContain('Provider: ollama')
            expect(prompt).toContain('Model: ollama/llama3.2')
            expect(prompt).toContain('Enabled built-in tools: agent_room_memory_read')
            expect(prompt).toContain('agent_room_memory_read')
            expect(prompt).toContain('Enabled MCP servers: docs: search')
            expect(prompt).toContain('Scheduled work is autonomous')
            expect(prompt).toContain('Room memory harness')
            expect(prompt).not.toContain('memory.md')
            expect(prompt).not.toContain('Room id')
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
