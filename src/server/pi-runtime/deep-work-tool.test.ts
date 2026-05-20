import { describe, expect, it, vi } from 'vitest'
import { createDeepWorkTool } from './deep-work-tool'
import type { ThreadRecord } from './thread-records'

function thread(overrides: Partial<ThreadRecord> = {}): ThreadRecord {
    return {
        key: 'parent-thread',
        sessionFile: '/tmp/session.jsonl',
        sessionId: 'parent-session',
        title: 'Parent',
        titleSource: 'manual',
        status: 'idle',
        createdAt: 1,
        updatedAt: 1,
        lastMessagePreview: null,
        modelProvider: 'openai-codex',
        model: 'gpt-5.4-mini',
        thinkingLevel: 'medium',
        speedMode: null,
        activeRunId: 'parent-run',
        activeRunKind: null,
        heartbeatAt: null,
        runStartedAt: null,
        runBudgetExpiresAt: null,
        idleTimeoutExpiresAt: null,
        activeDurationMs: 0,
        idleDurationMs: 0,
        lastError: null,
        kind: 'main',
        parentThreadKey: null,
        parentRunId: null,
        subagentRunId: null,
        subagentName: null,
        subagentTask: null,
        deepWorkRunId: null,
        deepWorkObjective: null,
        completedAt: null,
        ...overrides,
    }
}

async function executeTool(tool: ReturnType<typeof createDeepWorkTool>, input: object) {
    return tool.execute('call-1', input as never, undefined, undefined, {} as never)
}

describe('deep work tool', () => {
    it('creates an audited deep work thread with memory and a deep work budget', async () => {
        const child = thread({
            key: 'deep-thread',
            sessionId: 'deep-session',
            kind: 'deep_work',
            parentThreadKey: 'parent-thread',
        })
        const audit = vi.fn()
        const createThread = vi.fn(async (input) => {
            child.parentThreadKey = input.parentThreadKey ?? null
            child.parentRunId = input.parentRunId ?? null
            child.deepWorkRunId = input.deepWorkRunId ?? null
            child.deepWorkObjective = input.deepWorkObjective ?? null
            return { key: child.key }
        })
        const runPrompt = vi.fn(async () => {
            child.status = 'idle'
            return 'idle'
        })
        const persistThreadIndex = vi.fn(async () => {})
        let reservations = 0

        const tool = createDeepWorkTool({
            parentRecord: thread(),
            maxObjectiveChars: 200,
            maxResultChars: 1000,
            activeCount: () => 0,
            maxActive: 2,
            shortText: (value, length = 120) => value.slice(0, length),
            redactString: (value) => value.replaceAll('secret', '[redacted]'),
            readMemoryBrief: async () => 'Memory brief',
            reserveActive: () => {
                reservations += 1
                return () => {
                    reservations -= 1
                }
            },
            createThread,
            findThread: () => child,
            runPrompt,
            readThreadMessages: () => [
                {
                    id: 'message-1',
                    role: 'assistant',
                    text: 'final with secret',
                    parts: [],
                    timestamp: null,
                },
            ],
            persistThreadIndex,
            audit,
        })

        const result = await executeTool(tool, {
            objective: 'Investigate the runtime path',
            scope: 'Use logs and tests',
        })

        expect(createThread).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: 'deep_work',
                parentThreadKey: 'parent-thread',
                parentRunId: 'parent-run',
                deepWorkObjective: 'Investigate the runtime path',
            }),
        )
        expect(runPrompt).toHaveBeenCalledWith(
            expect.objectContaining({
                record: child,
                message: expect.stringContaining('Room memory brief at dispatch'),
                runId: child.deepWorkRunId,
                runKind: 'deep_work',
                awaitCompletion: true,
            }),
        )
        expect(audit).toHaveBeenCalledWith(
            'deep_work.called',
            expect.objectContaining({
                parentThreadKey: 'parent-thread',
                parentRunId: 'parent-run',
            }),
        )
        expect(audit).toHaveBeenCalledWith(
            'deep_work.completed',
            expect.objectContaining({
                status: 'idle',
            }),
        )
        const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
        expect(text).toContain('[redacted]')
        expect(result.details).toMatchObject({
            threadKey: 'deep-thread',
            status: 'idle',
            parentThreadKey: 'parent-thread',
        })
        expect(persistThreadIndex).toHaveBeenCalled()
        expect(child.completedAt).not.toBeNull()
        expect(reservations).toBe(0)
    })

    it('fails closed for child threads, oversized objectives, and concurrency limits', async () => {
        const base = {
            parentRecord: thread(),
            maxObjectiveChars: 5,
            maxResultChars: 1000,
            activeCount: () => 0,
            maxActive: 2,
            shortText: (value: string) => value,
            redactString: (value: string) => value,
            readMemoryBrief: async () => '',
            reserveActive: () => () => {},
            createThread: async () => ({ key: 'child' }),
            findThread: () => thread({ key: 'child', kind: 'deep_work' }),
            runPrompt: async () => 'idle',
            readThreadMessages: () => [],
            persistThreadIndex: async () => {},
            audit: vi.fn(),
        }

        await expect(
            executeTool(createDeepWorkTool(base), {
                objective: 'too long',
            }),
        ).rejects.toThrow('too large')
        await expect(
            executeTool(
                createDeepWorkTool({
                    ...base,
                    maxObjectiveChars: 100,
                    activeCount: () => 2,
                }),
                {
                    objective: 'ok',
                },
            ),
        ).rejects.toThrow('concurrency limit')
        await expect(
            executeTool(
                createDeepWorkTool({
                    ...base,
                    parentRecord: thread({ kind: 'deep_work' }),
                    maxObjectiveChars: 100,
                }),
                {
                    objective: 'ok',
                },
            ),
        ).rejects.toThrow('main thread')
    })

    it('returns failed child status and timeout telemetry without hiding the evidence thread', async () => {
        const child = thread({
            key: 'deep-thread',
            kind: 'deep_work',
            parentThreadKey: 'parent-thread',
        })
        const audit = vi.fn()
        const tool = createDeepWorkTool({
            parentRecord: thread(),
            maxObjectiveChars: 200,
            maxResultChars: 1000,
            activeCount: () => 0,
            maxActive: 2,
            shortText: (value, length = 120) => value.slice(0, length),
            redactString: (value) => value,
            readMemoryBrief: async () => '',
            reserveActive: () => () => {},
            createThread: async (input) => {
                child.deepWorkRunId = input.deepWorkRunId ?? null
                return { key: child.key }
            },
            findThread: () => child,
            runPrompt: async () => {
                child.status = 'error'
                child.lastError = 'Run stopped because its total run budget expired'
                return 'error'
            },
            readThreadMessages: () => [],
            persistThreadIndex: async () => {},
            audit,
        })

        const result = await executeTool(tool, {
            objective: 'Investigate failure',
        })
        const text = result.content[0]?.type === 'text' ? result.content[0].text : ''

        expect(text).toContain('"status":"error"')
        expect(result.details).toMatchObject({
            threadKey: 'deep-thread',
            status: 'error',
            parentThreadKey: 'parent-thread',
        })
        expect(audit).toHaveBeenCalledWith(
            'deep_work.timed_out',
            expect.objectContaining({
                status: 'error',
            }),
        )
        expect(child.completedAt).not.toBeNull()
    })

    it('audits and persists failures that happen before the child run starts', async () => {
        const child = thread({
            key: 'deep-thread',
            kind: 'deep_work',
            parentThreadKey: 'parent-thread',
        })
        const audit = vi.fn()
        const persistThreadIndex = vi.fn(async () => {})
        const tool = createDeepWorkTool({
            parentRecord: thread(),
            maxObjectiveChars: 200,
            maxResultChars: 1000,
            activeCount: () => 0,
            maxActive: 2,
            shortText: (value, length = 120) => value.slice(0, length),
            redactString: (value) => value.replaceAll('secret', '[redacted]'),
            readMemoryBrief: async () => {
                throw new Error('secret memory failed')
            },
            reserveActive: () => () => {},
            createThread: async (input) => {
                child.deepWorkRunId = input.deepWorkRunId ?? null
                return { key: child.key }
            },
            findThread: () => child,
            runPrompt: async () => 'idle',
            readThreadMessages: () => [],
            persistThreadIndex,
            audit,
        })

        await expect(
            executeTool(tool, {
                objective: 'Investigate setup failure',
            }),
        ).rejects.toThrow('secret memory failed')

        expect(child.status).toBe('error')
        expect(child.lastError).toBe('[redacted] memory failed')
        expect(child.completedAt).not.toBeNull()
        expect(persistThreadIndex).toHaveBeenCalled()
        expect(audit).toHaveBeenCalledWith(
            'deep_work.failed',
            expect.objectContaining({
                threadKey: 'deep-thread',
                status: 'error',
                message: '[redacted] memory failed',
            }),
        )
    })

    it('reserves an active slot while dispatch is still creating the child thread', async () => {
        const child = thread({
            key: 'deep-thread',
            kind: 'deep_work',
            parentThreadKey: 'parent-thread',
        })
        let reservations = 0
        const createThreadGate: { release: (() => void) | null } = {
            release: null,
        }
        let createThreadStarted: (() => void) | null = null
        const createThreadStartedPromise = new Promise<void>((resolve) => {
            createThreadStarted = resolve
        })
        const tool = createDeepWorkTool({
            parentRecord: thread(),
            maxObjectiveChars: 200,
            maxResultChars: 1000,
            activeCount: () => reservations,
            maxActive: 1,
            shortText: (value, length = 120) => value.slice(0, length),
            redactString: (value) => value,
            readMemoryBrief: async () => '',
            reserveActive: () => {
                reservations += 1
                return () => {
                    reservations -= 1
                }
            },
            createThread: async (input) => {
                child.deepWorkRunId = input.deepWorkRunId ?? null
                createThreadStarted?.()
                await new Promise<void>((resolve) => {
                    createThreadGate.release = resolve
                })
                return { key: child.key }
            },
            findThread: () => child,
            runPrompt: async () => {
                child.status = 'idle'
                return 'idle'
            },
            readThreadMessages: () => [],
            persistThreadIndex: async () => {},
            audit: vi.fn(),
        })

        const first = executeTool(tool, {
            objective: 'First investigation',
        })
        await createThreadStartedPromise

        await expect(
            executeTool(tool, {
                objective: 'Second investigation',
            }),
        ).rejects.toThrow('concurrency limit')

        expect(reservations).toBe(1)
        if (!createThreadGate.release) {
            throw new Error('Create thread gate was not initialized')
        }
        createThreadGate.release()
        await first
        expect(reservations).toBe(0)
    })
})
