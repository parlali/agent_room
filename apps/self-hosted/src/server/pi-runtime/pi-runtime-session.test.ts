import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getModel } from '@mariozechner/pi-ai'
import { createTestPiRuntimeConfig, ensureTestPiRuntimeDirectories } from './test-runtime-defaults'
import {
    createPiRuntimeCustomTools,
    enabledToolNamesForSession,
    type PiRuntimeSessionInput,
} from './pi-runtime-session'
import { codexServiceTierForSpeedMode } from './runtime-speed-mode'
import { BrowserbaseBrowserAutomationManager } from './browserbase-browser'
import type { ThreadRecord } from './thread-records'
import { onboardingPersonalityToolName } from './onboarding-personality-tool'

function threadRecord(input: { key: string; kind?: ThreadRecord['kind'] }): ThreadRecord {
    const now = Date.now()
    return {
        key: input.key,
        sessionFile: join(tmpdir(), `${input.key}.jsonl`),
        sessionId: input.key,
        title: 'Conversation',
        titleSource: 'initial',
        status: 'idle',
        createdAt: now,
        updatedAt: now,
        lastMessagePreview: null,
        modelProvider: 'openrouter',
        model: 'openrouter/auto',
        thinkingLevel: 'medium',
        speedMode: null,
        activeRunId: null,
        activeRunKind: null,
        heartbeatAt: null,
        runStartedAt: null,
        runBudgetExpiresAt: null,
        idleTimeoutExpiresAt: null,
        activeDurationMs: 0,
        idleDurationMs: 0,
        lastError: null,
        kind: input.kind ?? 'main',
        parentThreadKey: null,
        parentRunId: null,
        subagentRunId: null,
        subagentName: null,
        subagentTask: null,
        deepWorkRunId: null,
        deepWorkObjective: null,
        completedAt: null,
    }
}

async function withToolInput<T>(
    roomMode: PiRuntimeSessionInput['config']['roomMode'],
    fn: (input: PiRuntimeSessionInput) => T | Promise<T>,
    kind: ThreadRecord['kind'] = 'main',
    options: {
        audit?: PiRuntimeSessionInput['audit']
    } = {},
): Promise<T> {
    const root = await mkdtemp(join(tmpdir(), 'agent-room-runtime-tools-'))
    const config = createTestPiRuntimeConfig({
        root,
        roomMode,
        capabilities: {
            documents: false,
            spreadsheets: false,
            presentations: false,
            pdf: false,
            images: false,
            mcp: false,
        },
    })
    const previousUnsandboxedShell = process.env.AGENT_ROOM_UNSAFE_ALLOW_UNSANDBOXED_SHELL
    process.env.AGENT_ROOM_UNSAFE_ALLOW_UNSANDBOXED_SHELL = '1'
    await ensureTestPiRuntimeDirectories(config)
    const browserAutomation = new BrowserbaseBrowserAutomationManager({
        config,
        audit: async () => {},
        broadcast: () => {},
    })
    const record = threadRecord({ key: `${roomMode}-thread`, kind })
    try {
        return await fn({
            config,
            record,
            systemPrompt: () => '',
            mcpTools: [],
            browserAutomation,
            audit: options.audit ?? (async () => {}),
            shortText: (value) => value,
            redactString: (value) => value,
            redactCommandOutput: (value) => value,
            maxSubagentTaskChars: 24000,
            maxActiveSubagents: 5,
            activeSubagentCount: () => 0,
            maxDeepWorkObjectiveChars: 48000,
            maxDeepWorkResultChars: 60000,
            maxActiveDeepWork: 2,
            activeDeepWorkCount: () => 0,
            reserveDeepWorkSlot: () => () => {},
            readMemoryBrief: async () => '',
            createThread: async () => ({ key: 'created-thread' }),
            findThread: () => null,
            runPrompt: async () => 'idle',
            readThreadMessages: () => [],
            persistThreadIndex: async () => {},
        })
    } finally {
        if (previousUnsandboxedShell === undefined) {
            delete process.env.AGENT_ROOM_UNSAFE_ALLOW_UNSANDBOXED_SHELL
        } else {
            process.env.AGENT_ROOM_UNSAFE_ALLOW_UNSANDBOXED_SHELL = previousUnsandboxedShell
        }
        await rm(root, {
            recursive: true,
            force: true,
        })
    }
}

describe('Pi runtime session tools', () => {
    it('maps Codex fast mode to the priority service tier', () => {
        const codexModel = getModel('openai-codex', 'gpt-5.5')
        const googleModel = getModel('google', 'gemini-2.5-pro')

        expect(codexServiceTierForSpeedMode(codexModel, 'fast')).toBe('priority')
        expect(codexServiceTierForSpeedMode(codexModel, 'normal')).toBeUndefined()
        expect(codexServiceTierForSpeedMode(googleModel, 'fast')).toBeUndefined()
    })

    it('exposes canonical memory tools to programmer rooms', async () => {
        await withToolInput('programmer', (input) => {
            const names = createPiRuntimeCustomTools(input).map((tool) => tool.name)

            expect(names).toContain('memory_read')
            expect(names).toContain('memory_patch')
            expect(names).toContain('memory_replace')
            expect(names).toContain('read')
            expect(names).toContain('grep')
            expect(names).toContain('find')
            expect(names).toContain('ls')
            expect(names).toContain('edit')
            expect(names).toContain('write')
            expect(names).toContain('shell')
            expect(names).toContain('subagent')
            expect(names).toContain('deep_work')
            expect(names.some((name) => name.startsWith('agent_room_'))).toBe(false)
        })
    })

    it('keeps orchestration tools out of child work threads', async () => {
        await withToolInput(
            'programmer',
            (input) => {
                const names = createPiRuntimeCustomTools(input).map((tool) => tool.name)

                expect(names).not.toContain('subagent')
                expect(names).not.toContain('deep_work')
            },
            'deep_work',
        )
    })

    it('exposes only profile capture and bounded URL fetch to onboarding threads', async () => {
        await withToolInput(
            'coworker',
            (input) => {
                const names = createPiRuntimeCustomTools(input).map((tool) => tool.name)

                expect(names).toEqual([onboardingPersonalityToolName, 'fetch_url'])
            },
            'onboarding',
        )
    })

    it('deduplicates native workspace tools before session registration', async () => {
        await withToolInput('programmer', (input) => {
            const tools = createPiRuntimeCustomTools(input)
            const enabledTools = enabledToolNamesForSession(input.config, tools)

            expect(enabledTools.filter((name) => name === 'read')).toHaveLength(1)
            expect(enabledTools.filter((name) => name === 'write')).toHaveLength(1)
            expect(enabledTools).toHaveLength(new Set(enabledTools).size)
        })
    })

    it('keeps artifact import and export out of programmer mode', async () => {
        await withToolInput('programmer', (input) => {
            const names = createPiRuntimeCustomTools(input).map((tool) => tool.name)

            expect(names).not.toContain('artifact_import')
            expect(names).not.toContain('artifact_export')
        })
    })

    it('audits native workspace write tool execution', async () => {
        const events: Array<{ event: string; payload: unknown }> = []
        let expectedPath = ''
        await withToolInput(
            'programmer',
            async (input) => {
                expectedPath = join(await realpath(input.config.paths.workspaceDir), 'audit.txt')
                const write = createPiRuntimeCustomTools(input).find(
                    (tool) => tool.name === 'write',
                )
                if (!write) {
                    throw new Error('Missing write tool')
                }

                await write.execute(
                    'call-1',
                    {
                        path: 'audit.txt',
                        content: 'hello',
                    },
                    undefined,
                    undefined,
                    {} as never,
                )

                await expect(readFile(expectedPath, 'utf8')).resolves.toBe('hello')
            },
            'main',
            {
                audit: async (event, payload) => {
                    events.push({ event, payload })
                },
            },
        )

        expect(events).toHaveLength(1)
        expect(events[0]).toEqual(
            expect.objectContaining({
                event: 'tool.write',
                payload: expect.objectContaining({
                    path: expectedPath,
                    fileChange: expect.objectContaining({
                        kind: 'write',
                        root: 'workspace',
                        path: expectedPath,
                    }),
                }),
            }),
        )
    })

    it('denies native workspace tool paths outside the workspace before execution', async () => {
        await withToolInput('programmer', async (input) => {
            const outsidePath = join(input.config.paths.roomRootDir, 'outside.txt')
            await writeFile(outsidePath, 'outside', 'utf8')
            const tools = createPiRuntimeCustomTools(input)
            const read = tools.find((tool) => tool.name === 'read')
            const write = tools.find((tool) => tool.name === 'write')
            if (!read || !write) {
                throw new Error('Missing native workspace tools')
            }

            await expect(
                read.execute(
                    'call-read',
                    {
                        path: outsidePath,
                    },
                    undefined,
                    undefined,
                    {} as never,
                ),
            ).rejects.toThrow(/escapes workspace/)
            await expect(
                write.execute(
                    'call-write',
                    {
                        path: outsidePath,
                        content: 'overwritten',
                    },
                    undefined,
                    undefined,
                    {} as never,
                ),
            ).rejects.toThrow(/escapes workspace/)
            await expect(readFile(outsidePath, 'utf8')).resolves.toBe('outside')
        })
    })
})
