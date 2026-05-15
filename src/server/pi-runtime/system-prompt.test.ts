import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import { buildAgentRoomSystemPrompt, contextBudgetForProvider } from './system-prompt'
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
            expect(prompt).toContain('reads the request, investigates what matters')
            expect(prompt).toContain('comes back with useful work done')
            expect(prompt).toContain('Mode: coworker')
            expect(prompt).toContain('Provider: ollama')
            expect(prompt).toContain('Model: ollama/llama3.2')
            expect(prompt).toContain('Enabled built-in tools: agent_room_memory_read')
            expect(prompt).toContain('agent_room_memory_read')
            expect(prompt).toContain(
                'Main-thread orchestration tools: agent_room_subagent, agent_room_deep_work',
            )
            expect(prompt).toContain('Enabled MCP servers: docs: search')
            expect(prompt).toContain('Lead final responses with the conclusion')
            expect(prompt).toContain('Final chat answers are usually 300-500 words')
            expect(prompt).toContain('For broad multi-part questions, answer the decision first')
            expect(prompt).toContain('1-3 grounded findings')
            expect(prompt).toContain('avoid headings, taxonomies, primers, inventories, and menus')
            expect(prompt).toContain('Execution protocol')
            expect(prompt).toContain('Current-world, source-dependent, provider, runtime')
            expect(prompt).toContain('agent_room_deep_work from main threads')
            expect(prompt).toContain('If a required tool or source fails')
            expect(prompt).not.toContain('Execution bias')
            expect(prompt).not.toContain('Work contract')
            expect(prompt).not.toContain('Work-shaped requests are tasks, not prompts')
            expect(prompt).toContain(
                'Room instructions and canonical room memory are standing context',
            )
            expect(prompt).toContain('Scheduled work is autonomous')
            expect(prompt).toContain('Keep the workspace reviewable for non-developers')
            expect(prompt).toContain('omitted previews are temporary internal verification only')
            expect(prompt).toContain('Attached images are provided as direct visual input')
            expect(prompt).toContain(
                'Attached non-image, non-PDF files are room-local file references',
            )
            expect(prompt).not.toContain('Do not use shell commands, document tools')
            expect(prompt).toContain('Room memory harness')
            expect(prompt).not.toContain('memory.md')
            expect(prompt).not.toContain('Room id')
            expect(prompt).toContain('Operator-owned instruction')
            expect(prompt).not.toContain('Workspace policy')
            expect(prompt).not.toContain('Instruction file AGENTS.md')
            expect(prompt.length).toBeLessThan(9000)
            expect(prompt.length).toBeLessThanOrEqual(
                contextBudgetForProvider(config).systemPromptMaxChars,
            )
        })
    })

    it('builds a programmer prompt with memory and without coworker artifact policy', async () => {
        await withConfig(async (config) => {
            config.roomMode = 'programmer'
            config.capabilities.documents = false
            config.capabilities.spreadsheets = false
            config.capabilities.presentations = false
            config.capabilities.pdf = false
            config.capabilities.images = false

            const prompt = await buildAgentRoomSystemPrompt(config)

            expect(prompt).toContain('programmer coworker in a room-local workspace')
            expect(prompt).toContain('Mode: programmer')
            expect(prompt).toContain('Use shell, git, package managers, test runners')
            expect(prompt).toContain('Lead final responses with the conclusion')
            expect(prompt).toContain(
                'Room instructions and canonical room memory are standing context',
            )
            expect(prompt).toContain('Room memory harness')
            expect(prompt).toContain('agent_room_memory_read')
            expect(prompt).toContain('agent_room_memory_patch')
            expect(prompt).toContain('agent_room_deep_work')
            expect(prompt).not.toContain('explicitly asks you to remember')
            expect(prompt).toContain('Use memory as an internal habit after substantive work')
            expect(prompt).toContain('used multiple web search or URL fetch calls')
            expect(prompt).toContain('write 1-3 concise memory items')
            expect(prompt).toContain('durable coding preferences')
            expect(prompt).toContain('workspace notes file')
            expect(prompt).not.toContain('persistent room-local coworker')
            expect(prompt).not.toContain('Scheduled work is autonomous')
            expect(prompt).not.toContain('Keep the workspace reviewable for non-developers')
            expect(prompt.length).toBeLessThan(9000)
        })
    })

    it('includes explicit GitHub status in programmer mode', async () => {
        await withConfig(async (config) => {
            config.roomMode = 'programmer'
            config.github = {
                enabled: true,
                installationId: '123',
                accountLogin: 'agent-room',
                repositories: ['agent-room/example'],
                tokenEnvKey: 'AGENT_ROOM_GITHUB_INSTALLATION_TOKEN',
                tokenExpiresAt: '2026-05-11T12:00:00.000Z',
                ghHostsPath: '/tmp/home/.config/gh/hosts.yml',
                gitCredentialsPath: '/tmp/home/.git-credentials',
                gitConfigPath: '/tmp/home/.gitconfig',
            }

            const prompt = await buildAgentRoomSystemPrompt(config)

            expect(prompt).toContain('GitHub repository access')
            expect(prompt).toContain('GitHub is connected for agent-room/example')
            expect(prompt).toContain(
                'Available HTTPS remotes: https://github.com/agent-room/example.git',
            )
            expect(prompt).toContain(
                'The workspace may be empty until you clone a selected repository',
            )
            expect(prompt).toContain(
                'Do not treat an empty workspace or "fatal: not a git repository" as missing GitHub access',
            )
            expect(prompt).toContain('To verify access, run git ls-remote')
            expect(prompt).toContain(
                'Use git with the room HOME credentials; use gh only if it is installed',
            )
        })
    })

    it('does not inject workspace AGENTS files into room prompts', async () => {
        await withConfig(async (config) => {
            await writeFile(
                join(config.paths.workspaceDir, 'AGENTS.md'),
                'Workspace policy',
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

            const coworkerPrompt = await buildAgentRoomSystemPrompt(config)
            config.roomMode = 'programmer'
            const programmerPrompt = await buildAgentRoomSystemPrompt(config)

            for (const prompt of [coworkerPrompt, programmerPrompt]) {
                expect(prompt).not.toContain('Workspace policy')
                expect(prompt).not.toContain('Nested policy')
                expect(prompt).not.toContain('Instruction file AGENTS.md')
                expect(prompt).not.toContain('Instruction file .agents/AGENTS.md')
            }
        })
    })
})
