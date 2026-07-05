import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { AgentSession, SessionEntry } from '@mariozechner/pi-coding-agent'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import {
    hostedRuntimeManagedOpenRouterEnvKey,
    hostedRuntimeUsageCallbackUrlEnvKey,
} from '../rooms/pi-runtime-contract'
import {
    createRuntimeRunPrompt,
    providerFailureDisplayMessage,
    type ActiveThread,
} from './runtime-runner'
import { memoryCaptureExpectationReasons, summarizeRunToolActivity } from './runtime-tool-activity'
import { createTestPiRuntimeConfig, ensureTestPiRuntimeDirectories } from './test-runtime-defaults'
import { normalizeThreadRecord, type ThreadRecord } from './thread-records'
import { hiddenProjectionEntryType } from './hidden-projection'

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
        appendMessage: (message: Record<string, unknown>) => {
            input.entries.push(messageEntry(message))
            return input.entries[input.entries.length - 1]!.id
        },
        appendCustomEntry: (customType: string, data: unknown) => {
            input.entries.push({
                id: randomUUID(),
                parentId: null,
                type: 'custom',
                customType,
                data,
                timestamp: new Date().toISOString(),
            } as unknown as SessionEntry)
        },
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
        promptVersion: 0,
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
    compactOversizedThreadContext?: (input: {
        record: ThreadRecord
        active: ActiveThread
    }) => Promise<void>
    refreshSystemPrompt?: (active?: ActiveThread) => Promise<void>
    broadcast?: (sessionKey: string, event: string, payload: unknown) => void
}) {
    const activeThreads = new Map<string, ActiveThread>([[input.record.key, input.active]])
    return createRuntimeRunPrompt({
        config: input.config,
        activeThreads,
        refreshSystemPrompt: input.refreshSystemPrompt ?? (async () => {}),
        getActiveThread: async () => input.active,
        compactOversizedThreadContext: input.compactOversizedThreadContext ?? (async () => {}),
        updateThreadFromMessages: () => {},
        persistThreadIndex: async () => {},
        broadcast: input.broadcast ?? (() => {}),
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

function createRunnerWithProviderError(input: {
    config: PiRuntimeConfig
    record: ThreadRecord
    active: ActiveThread
    events: Array<{ event: string; payload: unknown }>
    broadcasts: Array<{ event: string; payload: unknown }>
    latestError: string
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
        broadcast: (_sessionKey, event, payload) => {
            input.broadcasts.push({ event, payload })
        },
        appendRuntimeEvent: async (event, payload) => {
            input.events.push({ event, payload })
        },
        latestAssistantErrorMessage: () => input.latestError,
        maybeGenerateThreadTitle: async () => {},
        errorMessage: (error) => (error instanceof Error ? error.message : String(error)),
    })
}

async function collectOpenRouterRunFinishedPayload(input: {
    hostedUsageCallbackUrl: string | null
    managedOpenRouter: boolean
}): Promise<unknown> {
    const previousHostedUsageCallbackUrl = process.env[hostedRuntimeUsageCallbackUrlEnvKey]
    const previousManagedOpenRouter = process.env[hostedRuntimeManagedOpenRouterEnvKey]
    if (input.hostedUsageCallbackUrl) {
        process.env[hostedRuntimeUsageCallbackUrlEnvKey] = input.hostedUsageCallbackUrl
    } else {
        delete process.env[hostedRuntimeUsageCallbackUrlEnvKey]
    }
    if (input.managedOpenRouter) {
        process.env[hostedRuntimeManagedOpenRouterEnvKey] = '1'
    } else {
        delete process.env[hostedRuntimeManagedOpenRouterEnvKey]
    }
    try {
        return await withConfig(async ({ config, root }) => {
            const record = threadRecord(root)
            const entries: SessionEntry[] = []
            const active = fakeActiveThread({
                entries,
                prompt: async () => {
                    entries.push(
                        messageEntry({
                            role: 'assistant',
                            content: [{ type: 'text', text: 'Done' }],
                            usage: {
                                input: 100,
                                output: 50,
                                totalTokens: 150,
                                cost: {
                                    total: 0.0123,
                                },
                            },
                        }),
                    )
                },
            })
            active.session.state.model = {
                cost: {
                    input: 1,
                    output: 1,
                    cacheRead: 1,
                    cacheWrite: 1,
                },
            } as never
            const events: Array<{ event: string; payload: unknown }> = []
            const runPrompt = createRunner({
                config: {
                    ...config,
                    provider: {
                        ...config.provider,
                        sourceProvider: 'openrouter',
                    },
                },
                record,
                active,
                events,
            })

            await runPrompt({
                record,
                message: 'Track cost',
                runId: 'run-cost',
                awaitCompletion: true,
            })

            return events.find((entry) => entry.event === 'run.finished')?.payload
        })
    } finally {
        if (previousHostedUsageCallbackUrl === undefined) {
            delete process.env[hostedRuntimeUsageCallbackUrlEnvKey]
        } else {
            process.env[hostedRuntimeUsageCallbackUrlEnvKey] = previousHostedUsageCallbackUrl
        }
        if (previousManagedOpenRouter === undefined) {
            delete process.env[hostedRuntimeManagedOpenRouterEnvKey]
        } else {
            process.env[hostedRuntimeManagedOpenRouterEnvKey] = previousManagedOpenRouter
        }
    }
}

describe('runtime runner memory capture audit', () => {
    it('keeps BYOK OpenRouter session cost known outside managed hosted reservation billing', async () => {
        await expect(
            collectOpenRouterRunFinishedPayload({
                hostedUsageCallbackUrl: 'https://rooms.example.test/api/usage',
                managedOpenRouter: false,
            }),
        ).resolves.toMatchObject({
            usage: {
                estimatedCostUsd: 0.0123,
                costKnown: true,
            },
        })
    })

    it('suppresses managed hosted OpenRouter estimates until actual provider charges arrive', async () => {
        await expect(
            collectOpenRouterRunFinishedPayload({
                hostedUsageCallbackUrl: 'https://rooms.example.test/api/usage',
                managedOpenRouter: true,
            }),
        ).resolves.toMatchObject({
            usage: {
                estimatedCostUsd: null,
                costKnown: false,
            },
        })
    })

    it('persists a visible assistant error when the provider rejects a run', async () => {
        await withConfig(async ({ config, root }) => {
            const record = threadRecord(root)
            const entries: SessionEntry[] = []
            const active = fakeActiveThread({
                entries,
                prompt: async () => {
                    throw new Error('Codex error: cyber_policy rejected the request')
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
                message: 'Review this defensive finding',
                runId: 'run-rejected',
                awaitCompletion: true,
            })

            const assistant = entries
                .map((entry) => (entry.type === 'message' ? entry.message : null))
                .find((message) => message?.role === 'assistant') as
                | Record<string, unknown>
                | undefined

            expect(record.status).toBe('error')
            expect(record.pendingUserMessages).toEqual([])
            expect(assistant).toMatchObject({
                role: 'assistant',
                stopReason: 'error',
                errorMessage: 'Codex error: cyber_policy rejected the request',
            })
            expect(JSON.stringify(assistant?.content)).toContain('safety policy')
        })
    })

    it('emits run.error and persists the user message when startup fails before the run begins', async () => {
        await withConfig(async ({ config, root }) => {
            const record = threadRecord(root)
            const entries: SessionEntry[] = []
            const active = fakeActiveThread({
                entries,
                prompt: async () => {
                    throw new Error('prompt should never run after a startup failure')
                },
            })
            const events: Array<{ event: string; payload: unknown }> = []
            const broadcasts: Array<{ event: string; payload: unknown }> = []
            const runPrompt = createRunner({
                config,
                record,
                active,
                events,
                refreshSystemPrompt: async () => {
                    throw new Error('session reload failed on resume')
                },
                broadcast: (_sessionKey, event, payload) => {
                    broadcasts.push({ event, payload })
                },
            })

            await runPrompt({
                record,
                message: 'Hello after resume',
                runId: 'run-resume',
                awaitCompletion: true,
            })

            const runError = broadcasts.find((entry) => entry.event === 'run.error')
            expect(runError).toBeDefined()
            expect((runError?.payload as { message?: string }).message).toContain(
                'session reload failed on resume',
            )

            const userMessage = entries
                .map((entry) => (entry.type === 'message' ? entry.message : null))
                .find((message) => message?.role === 'user') as Record<string, unknown> | undefined
            expect(JSON.stringify(userMessage?.content)).toContain('Hello after resume')

            expect(record.status).toBe('error')
            expect(record.lastError).toContain('session reload failed on resume')
            expect(record.pendingUserMessages ?? []).toEqual([])
        })
    })

    it('does not expose hidden internal prompts as pending user messages', async () => {
        await withConfig(async ({ config, root }) => {
            const record = threadRecord(root)
            const entries: SessionEntry[] = []
            const active = fakeActiveThread({
                entries,
                prompt: async () => {},
            })
            active.queue = new Promise(() => {})
            const events: Array<{ event: string; payload: unknown }> = []
            const runPrompt = createRunner({
                config,
                record,
                active,
                events,
            })

            await runPrompt({
                record,
                message: 'internal onboarding instruction',
                runId: 'run-hidden',
                awaitCompletion: false,
                hideUserMessage: true,
            })

            expect(record.pendingUserMessages ?? []).toEqual([])
        })
    })

    it('marks hidden internal prompts before persisting provider errors', async () => {
        await withConfig(async ({ config, root }) => {
            const record = threadRecord(root)
            const entries: SessionEntry[] = []
            const active = fakeActiveThread({
                entries,
                prompt: async () => {
                    entries.push(
                        messageEntry({
                            role: 'user',
                            content: 'internal onboarding instruction',
                        }),
                    )
                    throw new Error('Provider rejected the onboarding opener')
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
                message: 'internal onboarding instruction',
                runId: 'run-hidden-error',
                awaitCompletion: true,
                hideUserMessage: true,
            })

            const hiddenMarker = entries.find(
                (entry) =>
                    entry.type === 'custom' &&
                    entry.customType === hiddenProjectionEntryType &&
                    typeof entry.data === 'object' &&
                    entry.data !== null &&
                    'hiddenEntryId' in entry.data,
            )
            const userMessages = entries.filter(
                (entry) => entry.type === 'message' && entry.message.role === 'user',
            )

            expect(hiddenMarker).toMatchObject({
                data: {
                    hiddenEntryId: userMessages[0]?.id,
                },
            })
            expect(record.pendingUserMessages ?? []).toEqual([])
            expect(record.status).toBe('error')
        })
    })

    it('persists a new provider rejection after an older assistant error', async () => {
        await withConfig(async ({ config, root }) => {
            const record = threadRecord(root)
            const entries: SessionEntry[] = [
                messageEntry({
                    role: 'assistant',
                    content: [
                        {
                            type: 'text',
                            text: 'Previous provider error',
                        },
                    ],
                    stopReason: 'error',
                    errorMessage: 'Previous provider error',
                }),
            ]
            const active = fakeActiveThread({
                entries,
                prompt: async () => {
                    throw new Error('Codex error: cyber_policy rejected the follow-up')
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
                message: 'Continue with the authorized review',
                runId: 'run-rejected-again',
                awaitCompletion: true,
            })

            const assistantErrors = entries
                .map((entry) => (entry.type === 'message' ? entry.message : null))
                .filter(
                    (message) => message?.role === 'assistant' && message.stopReason === 'error',
                )

            expect(assistantErrors).toHaveLength(2)
            expect(assistantErrors.at(-1)).toMatchObject({
                errorMessage: 'Codex error: cyber_policy rejected the follow-up',
            })
        })
    })

    it('emits run.error when the provider rejects with a non-2xx status mid-run', async () => {
        await withConfig(async ({ config, root }) => {
            const record = threadRecord(root)
            const entries: SessionEntry[] = []
            const providerError = 'openrouter returned 402: insufficient credits'
            const active = fakeActiveThread({
                entries,
                prompt: async () => {
                    entries.push(
                        messageEntry({
                            role: 'assistant',
                            content: [{ type: 'text', text: '' }],
                            stopReason: 'error',
                            errorMessage: providerError,
                        }),
                    )
                },
            })
            const events: Array<{ event: string; payload: unknown }> = []
            const broadcasts: Array<{ event: string; payload: unknown }> = []
            const runPrompt = createRunnerWithProviderError({
                config,
                record,
                active,
                events,
                broadcasts,
                latestError: providerError,
            })

            await runPrompt({
                record,
                message: 'Do the work',
                runId: 'run-402',
                awaitCompletion: true,
            })

            const runError = broadcasts.find((entry) => entry.event === 'run.error')
            expect(runError).toBeDefined()
            expect((runError?.payload as { message?: string }).message).toContain(providerError)
            expect((runError?.payload as { reason?: string }).reason).toBe('provider_error')
            expect(record.status).toBe('error')
            expect(record.lastError).toBe(providerError)
            expect(record.pendingUserMessages ?? []).toEqual([])
        })
    })

    it('uses coded provider error messages in assistant error display text', () => {
        const codedMessage =
            'This conversation uses a model that is not available. Start a new conversation or switch the model.'
        const display = providerFailureDisplayMessage(
            `OpenRouter failed with 403 ${JSON.stringify({
                ok: false,
                code: 'model_not_allowed',
                message: codedMessage,
            })}`,
        )

        expect(display).toContain(`Provider detail: ${codedMessage}`)
        expect(display).not.toContain('OpenRouter failed with 403')
    })

    it('emits run.error when the provider stream dies mid-body', async () => {
        await withConfig(async ({ config, root }) => {
            const record = threadRecord(root)
            const entries: SessionEntry[] = []
            const providerError =
                'The model provider closed the response stream before it finished.'
            const active = fakeActiveThread({
                entries,
                prompt: async () => {
                    entries.push(
                        messageEntry({
                            role: 'assistant',
                            content: [{ type: 'text', text: 'partial' }],
                            stopReason: 'error',
                            errorMessage: providerError,
                        }),
                    )
                },
            })
            const events: Array<{ event: string; payload: unknown }> = []
            const broadcasts: Array<{ event: string; payload: unknown }> = []
            const runPrompt = createRunnerWithProviderError({
                config,
                record,
                active,
                events,
                broadcasts,
                latestError: providerError,
            })

            await runPrompt({
                record,
                message: 'Do the work',
                runId: 'run-stream-death',
                awaitCompletion: true,
            })

            const runError = broadcasts.find((entry) => entry.event === 'run.error')
            expect(runError).toBeDefined()
            expect((runError?.payload as { message?: string }).message).toContain(providerError)
            expect(record.status).toBe('error')

            const runFinished = events.find((entry) => entry.event === 'run.finished')?.payload as
                | { status?: string }
                | undefined
            expect(runFinished?.status).toBe('error')

            const assistantError = entries
                .map((entry) => (entry.type === 'message' ? entry.message : null))
                .find(
                    (message) => message?.role === 'assistant' && message.stopReason === 'error',
                ) as Record<string, unknown> | undefined
            expect(assistantError?.errorMessage).toBe(providerError)
        })
    })

    it('classifies substantive tool activity without storing tool arguments', () => {
        const counts = summarizeRunToolActivity([
            assistantToolEntry(['memory_read', 'web_search', 'fetch_url', 'read']),
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
})
