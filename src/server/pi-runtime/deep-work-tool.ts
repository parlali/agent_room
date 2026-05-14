import { randomUUID } from 'node:crypto'
import { defineTool, type ToolDefinition } from '@mariozechner/pi-coding-agent'
import { Type } from '@mariozechner/pi-ai'
import type { RoomExecutionMessage } from '../rooms/execution-types'
import type { RunKind } from './run-budget'
import type { ThreadKind, ThreadRecord } from './thread-records'
import { finalAssistantText } from './thread-results'

export interface CreateDeepWorkToolInput {
    parentRecord: ThreadRecord
    maxObjectiveChars: number
    maxResultChars: number
    activeCount: () => number
    maxActive: number
    shortText: (value: string, length?: number) => string
    redactString: (value: string) => string
    readMemoryBrief: () => Promise<string>
    reserveActive: () => () => void
    createThread: (input: {
        title?: string | null
        kind?: ThreadKind
        parentThreadKey?: string | null
        parentRunId?: string | null
        subagentRunId?: string | null
        subagentName?: string | null
        subagentTask?: string | null
        deepWorkRunId?: string | null
        deepWorkObjective?: string | null
    }) => Promise<{ key: string }>
    findThread: (key: string) => ThreadRecord | null
    runPrompt: (input: {
        record: ThreadRecord
        message: string
        runId: string
        awaitCompletion: boolean
        runKind?: RunKind
    }) => Promise<string>
    readThreadMessages: (record: ThreadRecord, limit: number) => RoomExecutionMessage[]
    persistThreadIndex: () => Promise<void>
    audit: (event: string, payload: unknown) => Promise<void>
}

function deepWorkMessage(input: {
    objective: string
    scope: string
    memoryBrief: string
    parentThreadKey: string
}): string {
    const scope = input.scope ? `\n\nScope or constraints from parent:\n${input.scope}` : ''
    return [
        'You are running dedicated deep work for this Agent Room.',
        `Parent thread: ${input.parentThreadKey}`,
        `Objective:\n${input.objective}${scope}`,
        ['Room memory brief at dispatch:', input.memoryBrief || '[empty]'].join('\n'),
        [
            'Protocol:',
            '1. Restate the intended outcome in one sentence.',
            '2. Inspect the files, logs, sources, commands, artifacts, or runtime state needed for evidence.',
            '3. Execute the work directly when it is safe and available.',
            '4. Verify direct behavior or clearly name unrun checks and blockers.',
            '5. Return a concise final report for the parent with conclusion, evidence, changed files or artifacts, verification, and blockers.',
        ].join('\n'),
        'Do not call agent_room_deep_work. Keep source names, paths, command names, artifacts, or important URLs visible so the parent can cite them.',
    ].join('\n\n')
}

function resultEvent(
    record: ThreadRecord,
): 'deep_work.completed' | 'deep_work.failed' | 'deep_work.timed_out' {
    if (record.status !== 'error') {
        return 'deep_work.completed'
    }
    const error = record.lastError ?? ''
    return error.includes('timeout') || error.includes('budget expired')
        ? 'deep_work.timed_out'
        : 'deep_work.failed'
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

export function createDeepWorkTool(input: CreateDeepWorkToolInput): ToolDefinition {
    return defineTool({
        name: 'agent_room_deep_work',
        label: 'Deep Work',
        description:
            'Dispatch a complex task to a dedicated Agent Room work thread for structured investigation with planning, tool use, verification, and synthesis. Use when a task needs multi-step research, sustained analysis, coding work, artifact work, or auditably focused execution.',
        promptSnippet:
            'agent_room_deep_work is available from main threads for complex tasks that need a dedicated work thread. It is bounded, audited, and returns the child thread result.',
        parameters: Type.Object({
            objective: Type.String(),
            scope: Type.Optional(Type.String()),
        }),
        execute: async (_toolCallId, params) => {
            const objective = String(params.objective ?? '').trim()
            const scope =
                typeof params.scope === 'string' && params.scope.trim()
                    ? input.shortText(params.scope, 2400)
                    : ''
            if (!objective) {
                await input.audit('deep_work.skipped', {
                    parentThreadKey: input.parentRecord.key,
                    reason: 'empty_objective',
                })
                throw new Error('Deep work objective cannot be empty')
            }
            if (input.parentRecord.kind !== 'main') {
                await input.audit('deep_work.skipped', {
                    parentThreadKey: input.parentRecord.key,
                    reason: 'child_thread',
                })
                throw new Error('Deep work can only be dispatched from a main thread')
            }
            if (objective.length > input.maxObjectiveChars) {
                await input.audit('deep_work.skipped', {
                    parentThreadKey: input.parentRecord.key,
                    reason: 'objective_too_large',
                    objectiveChars: objective.length,
                    maxObjectiveChars: input.maxObjectiveChars,
                })
                throw new Error('Deep work objective is too large')
            }
            if (input.activeCount() >= input.maxActive) {
                await input.audit('deep_work.skipped', {
                    parentThreadKey: input.parentRecord.key,
                    reason: 'concurrency_limit',
                    maxActive: input.maxActive,
                })
                throw new Error('Deep work concurrency limit reached')
            }

            const runId = randomUUID()
            const releaseActive = input.reserveActive()
            let activeReserved = true
            let record: ThreadRecord | null = null
            const release = () => {
                if (!activeReserved) {
                    return
                }
                activeReserved = false
                releaseActive()
            }
            try {
                await input.audit('deep_work.called', {
                    parentThreadKey: input.parentRecord.key,
                    parentRunId: input.parentRecord.activeRunId,
                    runId,
                    objective: input.shortText(objective, 600),
                })

                const child = await input.createThread({
                    title: `Deep work: ${input.shortText(objective, 70)}`,
                    kind: 'deep_work',
                    parentThreadKey: input.parentRecord.key,
                    parentRunId: input.parentRecord.activeRunId,
                    deepWorkRunId: runId,
                    deepWorkObjective: input.shortText(objective, 600),
                })
                record = input.findThread(child.key)
                if (!record) {
                    throw new Error('Deep work thread was not created')
                }

                record.status = 'running'
                await input.persistThreadIndex()
                release()

                const memoryBrief = await input.readMemoryBrief()
                await input.runPrompt({
                    record,
                    message: deepWorkMessage({
                        objective,
                        scope,
                        memoryBrief,
                        parentThreadKey: input.parentRecord.key,
                    }),
                    runId,
                    awaitCompletion: true,
                    runKind: 'deep_work',
                })

                record.completedAt = Date.now()
                await input.persistThreadIndex()
                const fullText = input.redactString(
                    finalAssistantText(input.readThreadMessages(record, 300)),
                )
                const text = input.shortText(fullText, input.maxResultChars)
                const event = resultEvent(record)
                await input.audit(event, {
                    parentThreadKey: input.parentRecord.key,
                    threadKey: record.key,
                    runId,
                    status: record.status,
                    resultChars: fullText.length,
                    truncated: fullText.length > text.length,
                })

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                threadKey: record.key,
                                runId,
                                status: record.status,
                                error: record.lastError,
                                text,
                            }),
                        },
                    ],
                    details: {
                        threadKey: record.key,
                        runId,
                        status: record.status,
                        parentThreadKey: input.parentRecord.key,
                        truncated: fullText.length > text.length,
                    },
                }
            } catch (error) {
                release()
                const message = input.redactString(errorText(error))
                let persistError: string | null = null
                if (record) {
                    record.status = 'error'
                    record.lastError = message
                    record.completedAt = Date.now()
                    try {
                        await input.persistThreadIndex()
                    } catch (caught) {
                        persistError = input.redactString(errorText(caught))
                    }
                }
                await input.audit('deep_work.failed', {
                    parentThreadKey: input.parentRecord.key,
                    threadKey: record?.key ?? null,
                    runId,
                    status: record?.status ?? 'error',
                    message,
                    persistError,
                })
                throw error
            } finally {
                release()
            }
        },
    })
}
