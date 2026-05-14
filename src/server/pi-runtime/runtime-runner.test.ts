import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { AgentSession, SessionEntry } from '@mariozechner/pi-coding-agent'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import { createRuntimeRunPrompt, type ActiveThread } from './runtime-runner'
import { memoryCaptureExpectationReasons, summarizeRunToolActivity } from './runtime-tool-activity'
import { patchMemory, readMemory } from './memory'
import { createTestPiRuntimeConfig, ensureTestPiRuntimeDirectories } from './test-runtime-defaults'
import { normalizeThreadRecord, type ThreadRecord } from './thread-records'

function messageEntry(message: Record<string, unknown>): SessionEntry {
    return {
        id: randomUUID(),
        parentId: null,
        type: 'message',
        timestamp: new Date().toISOString(),
        message,
    } as unknown as SessionEntry
}

function assistantToolEntry(toolNames: string[]): SessionEntry {
    return messageEntry({
        role: 'assistant',
        content: toolNames.map((name, index) => ({
            type: 'toolCall',
            id: `call-${index}`,
            name,
            arguments: {},
        })),
    })
}

function textAssistantEntry(text: string): SessionEntry {
    return messageEntry({
        role: 'assistant',
        content: [
            {
                type: 'text',
                text,
            },
        ],
    })
}

function threadRecord(root: string): ThreadRecord {
    return normalizeThreadRecord({
        key: 'thread-1',
        sessionFile: join(root, 'session.jsonl'),
        sessionId: 'session-1',
        title: 'Thread',
        status: 'idle',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        kind: 'main',
    })
}

function fakeActiveThread(input: {
    entries: SessionEntry[]
    prompt: () => Promise<void>
}): ActiveThread {
    const sessionManager = {
        getBranch: () => input.entries,
        getEntries: () => input.entries,
        getEntry: () => null,
        appendCustomEntry: () => {},
    }
    return {
        session: {
            model: {
                provider: 'test',
                id: 'model',
            },
            modelRegistry: {
                hasConfiguredAuth: () => true,
            },
            state: {
                model: null,
            },
            messages: [],
            isStreaming: false,
            sessionManager,
            prompt: input.prompt,
            abort: async () => {},
            navigateTree: async () => ({
                cancelled: false,
            }),
        } as unknown as AgentSession,
        unsubscribe: null,
        queue: Promise.resolve(),
        abortController: null,
        touchRunHeartbeat: null,
    }
}

async function withConfig<T>(fn: (input: { config: PiRuntimeConfig; root: string }) => Promise<T>) {
    const root = await mkdtemp(join(tmpdir(), 'agent-room-runner-'))
    const config = createTestPiRuntimeConfig({ root })
    await ensureTestPiRuntimeDirectories(config)
    try {
        return await fn({ config, root })
    } finally {
        await rm(root, {
            recursive: true,
            force: true,
        })
    }
}

function createRunner(input: {
    config: PiRuntimeConfig
    record: ThreadRecord
    active: ActiveThread
    events: Array<{ event: string; payload: unknown }>
}) {
    const activeThreads = new Map<string, ActiveThread>([[input.record.key, input.active]])
    return createRuntimeRunPrompt({
        config: input.config,
        activeThreads,
        refreshSystemPrompt: async () => {},
        getActiveThread: async () => input.active,
        compactOversizedThreadContext: async () => {},
        updateThreadFromMessages: () => {},
        persistThreadIndex: async () => {},
        broadcast: () => {},
        appendRuntimeEvent: async (event, payload) => {
            input.events.push({
                event,
                payload,
            })
        },
        latestAssistantErrorMessage: () => null,
        maybeGenerateThreadTitle: async () => {},
        errorMessage: (error) => (error instanceof Error ? error.message : String(error)),
    })
}

describe('runtime runner memory capture audit', () => {
    it('classifies substantive tool activity without storing tool arguments', () => {
        const counts = summarizeRunToolActivity([
            assistantToolEntry([
                'agent_room_memory_read',
                'agent_room_web_search',
                'agent_room_fetch_url',
                'agent_room_read',
            ]),
        ])

        expect(counts).toMatchObject({
            totalToolCalls: 4,
            nonMemoryToolCalls: 3,
            researchCalls: 2,
            workspaceReadCalls: 1,
            memoryReadCalls: 1,
            memoryWriteCalls: 0,
        })
        expect(memoryCaptureExpectationReasons(counts)).toEqual([
            'multiple_research_calls',
            'multi_tool_run',
        ])
    })

    it('audits completed substantive runs that did not update memory', async () => {
        await withConfig(async ({ config, root }) => {
            const record = threadRecord(root)
            const entries: SessionEntry[] = []
            const active = fakeActiveThread({
                entries,
                prompt: async () => {
                    entries.push(
                        assistantToolEntry(['agent_room_web_search', 'agent_room_fetch_url']),
                        textAssistantEntry('Done'),
                    )
                },
            })
            const events: Array<{ event: string; payload: unknown }> = []
            const runPrompt = createRunner({
                config,
                record,
                active,
                events,
            })

            await runPrompt({
                record,
                message: 'Research this',
                runId: 'run-1',
                awaitCompletion: true,
            })

            const audit = events.find(
                (event) => event.event === 'memory.capture_expected_but_missing',
            )
            expect(audit?.payload).toMatchObject({
                sessionKey: record.key,
                runId: 'run-1',
                runKind: 'manual',
                status: 'idle',
                reasons: ['multiple_research_calls'],
                toolCounts: {
                    totalToolCalls: 2,
                    nonMemoryToolCalls: 2,
                    researchCalls: 2,
                    memoryWriteCalls: 0,
                },
            })
        })
    })

    it('does not audit missing capture when substantive work updates memory', async () => {
        await withConfig(async ({ config, root }) => {
            const record = threadRecord(root)
            const entries: SessionEntry[] = []
            const active = fakeActiveThread({
                entries,
                prompt: async () => {
                    const memory = await readMemory(config)
                    await patchMemory({
                        config,
                        expectedHash: memory.hash,
                        patches: [
                            {
                                op: 'add',
                                section: 'currentWork.context',
                                text: 'Reusable finding from a substantive test run.',
                            },
                        ],
                    })
                    entries.push(
                        assistantToolEntry([
                            'agent_room_web_search',
                            'agent_room_fetch_url',
                            'agent_room_memory_patch',
                        ]),
                        textAssistantEntry('Done'),
                    )
                },
            })
            const events: Array<{ event: string; payload: unknown }> = []
            const runPrompt = createRunner({
                config,
                record,
                active,
                events,
            })

            await runPrompt({
                record,
                message: 'Research this',
                runId: 'run-2',
                awaitCompletion: true,
            })

            expect(events.map((event) => event.event)).not.toContain(
                'memory.capture_expected_but_missing',
            )
        })
    })
})
