import { describe, expect, it, vi } from 'vitest'
import { createSubagentTool } from './subagent-tool'
import type { ThreadRecord } from './thread-records'

function thread(overrides: Partial<ThreadRecord> = {}): ThreadRecord {
    return {
        key: 'parent-thread',
        sessionFile: '/tmp/session.jsonl',
        sessionId: 'parent-session',
        title: 'Parent',
        status: 'idle',
        createdAt: 1,
        updatedAt: 1,
        lastMessagePreview: null,
        modelProvider: 'openai-codex',
        model: 'gpt-5.4-mini',
        activeRunId: 'parent-run',
        lastError: null,
        kind: 'main',
        parentThreadKey: null,
        parentRunId: null,
        subagentRunId: null,
        subagentName: null,
        subagentTask: null,
        completedAt: null,
        ...overrides,
    }
}

async function executeTool(tool: ReturnType<typeof createSubagentTool>, input: object) {
    return tool.execute('call-1', input as never, undefined, undefined, {} as never)
}

describe('subagent tool', () => {
    it('persists parent links and audit events for child runs', async () => {
        const child = thread({
            key: 'child-thread',
            sessionId: 'child-session',
            kind: 'subagent',
            parentThreadKey: 'parent-thread',
        })
        const audit = vi.fn()
        const createThread = vi.fn(async (input) => {
            child.parentThreadKey = input.parentThreadKey ?? null
            child.parentRunId = input.parentRunId ?? null
            child.subagentRunId = input.subagentRunId ?? null
            child.subagentName = input.subagentName ?? null
            child.subagentTask = input.subagentTask ?? null
            return { key: child.key }
        })
        const runPrompt = vi.fn(async () => {
            child.status = 'idle'
            return 'idle'
        })

        const tool = createSubagentTool({
            parentRecord: thread(),
            maxTaskChars: 200,
            activeCount: () => 0,
            maxActive: 2,
            shortText: (value, length = 120) => value.slice(0, length),
            redactString: (value) => value.replaceAll('secret', '[redacted]'),
            createThread,
            findThread: () => child,
            runPrompt,
            readThreadMessages: () => [
                {
                    id: 'message-1',
                    role: 'assistant',
                    text: 'done with secret',
                    parts: [],
                    timestamp: null,
                },
            ],
            audit,
        })

        const result = await executeTool(tool, {
            name: 'Worker',
            task: 'Do a bounded task',
        })

        expect(createThread).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: 'subagent',
                parentThreadKey: 'parent-thread',
                parentRunId: 'parent-run',
                subagentName: 'Worker',
                subagentTask: 'Do a bounded task',
            }),
        )
        expect(runPrompt).toHaveBeenCalledWith(
            expect.objectContaining({
                record: child,
                message: 'Do a bounded task',
                awaitCompletion: true,
            }),
        )
        expect(audit).toHaveBeenCalledWith(
            'subagent.started',
            expect.objectContaining({
                parentThreadKey: 'parent-thread',
                threadKey: 'child-thread',
            }),
        )
        expect(audit).toHaveBeenCalledWith(
            'subagent.finished',
            expect.objectContaining({
                status: 'idle',
            }),
        )
        const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
        expect(text).toContain('[redacted]')
        expect(result.details).toMatchObject({
            threadKey: 'child-thread',
            status: 'idle',
            parentThreadKey: 'parent-thread',
        })
        expect(child.completedAt).not.toBeNull()
    })

    it('fails closed for oversized or concurrent subagent work', async () => {
        const base = {
            parentRecord: thread(),
            maxTaskChars: 5,
            activeCount: () => 0,
            maxActive: 2,
            shortText: (value: string) => value,
            redactString: (value: string) => value,
            createThread: async () => ({ key: 'child' }),
            findThread: () => thread({ key: 'child' }),
            runPrompt: async () => 'idle',
            readThreadMessages: () => [],
            audit: async () => {},
        }

        await expect(
            executeTool(createSubagentTool(base), {
                task: 'too long',
            }),
        ).rejects.toThrow('too large')

        await expect(
            executeTool(
                createSubagentTool({
                    ...base,
                    maxTaskChars: 100,
                    activeCount: () => 2,
                }),
                {
                    task: 'ok',
                },
            ),
        ).rejects.toThrow('concurrency limit')
    })

    it('collects failed child status without losing parent continuation details', async () => {
        const child = thread({
            key: 'child-thread',
            kind: 'subagent',
            parentThreadKey: 'parent-thread',
        })
        const audit = vi.fn()
        const tool = createSubagentTool({
            parentRecord: thread(),
            maxTaskChars: 200,
            activeCount: () => 0,
            maxActive: 2,
            shortText: (value, length = 120) => value.slice(0, length),
            redactString: (value) => value,
            createThread: async () => ({ key: child.key }),
            findThread: () => child,
            runPrompt: async () => {
                child.status = 'error'
                child.lastError = 'child failed'
                return 'error'
            },
            readThreadMessages: () => [],
            audit,
        })

        const result = await executeTool(tool, {
            name: 'Failing worker',
            task: 'Fail deliberately',
        })
        const text = result.content[0]?.type === 'text' ? result.content[0].text : ''

        expect(text).toContain('"status":"error"')
        expect(result.details).toMatchObject({
            threadKey: 'child-thread',
            status: 'error',
            parentThreadKey: 'parent-thread',
        })
        expect(audit).toHaveBeenCalledWith(
            'subagent.finished',
            expect.objectContaining({
                status: 'error',
            }),
        )
        expect(child.completedAt).not.toBeNull()
    })
})
