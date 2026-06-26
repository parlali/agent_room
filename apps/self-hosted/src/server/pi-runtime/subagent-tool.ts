import { randomUUID } from 'node:crypto'
import { defineTool, type ToolDefinition } from '@mariozechner/pi-coding-agent'
import { Type } from '@mariozechner/pi-ai'
import type { RoomExecutionMessage } from '../rooms/execution-types'
import type { ThreadKind, ThreadRecord } from './thread-records'
import type { RunKind } from './run-budget'
import { finalAssistantText } from './thread-results'
import { assertHostedRuntimeQuota } from './hosted-runtime-quota'

export interface CreateSubagentToolInput {
    parentRecord: ThreadRecord
    maxTaskChars: number
    activeCount: () => number
    maxActive: number
    shortText: (value: string, length?: number) => string
    redactString: (value: string) => string
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
    audit: (event: string, payload: unknown) => Promise<void>
}

export function createSubagentTool(input: CreateSubagentToolInput): ToolDefinition {
    return defineTool({
        name: 'subagent',
        label: 'Subagent',
        description: 'Run a bounded child agent session and return its final text.',
        parameters: Type.Object({
            task: Type.String(),
            name: Type.Optional(Type.String()),
            writeScope: Type.Optional(Type.String()),
        }),
        execute: async (_toolCallId, params) => {
            const task = String(params.task ?? '').trim()
            if (!task) {
                throw new Error('Subagent task cannot be empty')
            }
            if (task.length > input.maxTaskChars) {
                throw new Error('Subagent task is too large')
            }
            if (input.activeCount() >= input.maxActive) {
                throw new Error('Subagent concurrency limit reached')
            }

            const runId = randomUUID()
            await assertHostedRuntimeQuota({
                action: 'run_start',
                amount: {
                    count: 1,
                },
                runId,
            })
            const name =
                typeof params.name === 'string' && params.name.trim()
                    ? input.shortText(params.name, 80)
                    : null
            const child = await input.createThread({
                title: name ? `Subagent: ${name}` : 'Subagent',
                kind: 'subagent',
                parentThreadKey: input.parentRecord.key,
                parentRunId: input.parentRecord.activeRunId,
                subagentRunId: runId,
                subagentName: name,
                subagentTask: input.shortText(task, 600),
            })
            const record = input.findThread(child.key)
            if (!record) {
                throw new Error('Subagent thread was not created')
            }

            await input.audit('subagent.started', {
                parentThreadKey: input.parentRecord.key,
                threadKey: record.key,
                runId,
                name,
            })

            const writeScope =
                typeof params.writeScope === 'string' && params.writeScope.trim()
                    ? `\n\nWrite scope: ${input.shortText(params.writeScope, 1200)}`
                    : ''
            await input.runPrompt({
                record,
                message: [
                    'You are a bounded subagent for this workspace.',
                    'Do the assigned task only, do not spawn child agents, and return a concise final result with changed files or findings.',
                    `Task: ${task}${writeScope}`,
                ].join('\n\n'),
                runId,
                awaitCompletion: true,
                runKind: 'subagent',
            })

            record.completedAt = Date.now()
            const text = input.redactString(
                finalAssistantText(input.readThreadMessages(record, 200)),
            )
            await input.audit('subagent.finished', {
                parentThreadKey: input.parentRecord.key,
                threadKey: record.key,
                runId,
                status: record.status,
            })

            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            threadKey: record.key,
                            runId,
                            status: record.status,
                            text,
                        }),
                    },
                ],
                details: {
                    threadKey: record.key,
                    runId,
                    status: record.status,
                    parentThreadKey: input.parentRecord.key,
                },
            }
        },
    })
}
