import type { RoomAttachment } from '#/lib/room-attachments'
import type {
    RoomExecutionMessage,
    RoomExecutionMessagePart,
    RoomExecutionThread,
} from '#/lib/room-execution-types'

import { toolTasksFromParts, type ToolActivityTask, type ToolTaskStatus } from './tool-activity'

export type DisplayItem =
    | { type: 'message'; message: RoomExecutionMessage }
    | { type: 'tools'; id: string; tasks: ToolActivityTask[]; timestamp: number | null }
    | { type: 'run-status'; id: string; thread: RoomExecutionThread | null }

export type EditingMessageDraft = {
    id: string
    text: string
    timestamp: number | null
    attachments: RoomAttachment[]
}

export function buildDisplayItems(
    messages: RoomExecutionMessage[],
    isWorking: boolean,
    thread: RoomExecutionThread | null,
): DisplayItem[] {
    const items: DisplayItem[] = []
    let pendingTools: Extract<DisplayItem, { type: 'tools' }> | null = null
    const runStatusAfterMessageId = latestUserMessageId(messages)

    const flushTools = (settleAs?: 'complete' | 'error') => {
        if (!pendingTools) return
        if (settleAs) {
            pendingTools = {
                ...pendingTools,
                tasks: pendingTools.tasks.map((task) =>
                    task.status === 'pending' || task.status === 'in_progress'
                        ? {
                              ...task,
                              status: settleAs,
                              result:
                                  task.result ??
                                  (settleAs === 'error'
                                      ? 'The tool did not finish'
                                      : 'The tool finished'),
                          }
                        : task,
                ),
            }
        }
        items.push(pendingTools)
        pendingTools = null
    }

    const appendTools = (message: RoomExecutionMessage, parts: RoomExecutionMessagePart[]) => {
        const tasks = toolTasksFromParts(parts)
        if (tasks.length === 0) return
        if (!pendingTools) {
            pendingTools = {
                type: 'tools',
                id: `tools-${message.id}`,
                tasks: [],
                timestamp: message.timestamp,
            }
        }
        for (const task of tasks) {
            const existingIndex = pendingTools.tasks.findIndex((entry) => entry.id === task.id)
            if (existingIndex < 0) {
                pendingTools.tasks.push(task)
            } else {
                pendingTools.tasks[existingIndex] = mergeToolTaskForDisplay(
                    pendingTools.tasks[existingIndex]!,
                    task,
                )
            }
        }
        pendingTools.timestamp = pendingTools.timestamp ?? message.timestamp
    }

    const appendAssistantText = (
        message: RoomExecutionMessage,
        part: RoomExecutionMessagePart,
        index: number,
        split: boolean,
    ) => {
        if (!part.text.trim()) return
        flushTools('complete')
        items.push({
            type: 'message',
            message: {
                ...message,
                id: split ? `${message.id}:part:${index}` : message.id,
                text: part.text,
                parts: [part],
            },
        })
    }

    for (const message of messages) {
        if (message.role === 'tool') {
            appendTools(
                message,
                message.parts.filter((part) => part.type === 'tool_result'),
            )
            continue
        }

        if (message.role === 'assistant') {
            const displayParts = message.parts.filter(
                (part) =>
                    (part.type === 'text' && part.text.trim()) ||
                    part.type === 'tool_call' ||
                    part.type === 'tool_result',
            )
            const shouldSplit =
                displayParts.length > 1 ||
                displayParts.some(
                    (part) => part.type === 'tool_call' || part.type === 'tool_result',
                )

            if (displayParts.length === 0) {
                flushTools('complete')
                items.push({ type: 'message', message })
                continue
            }

            for (const [index, part] of displayParts.entries()) {
                if (part.type === 'text') {
                    appendAssistantText(message, part, index, shouldSplit)
                } else {
                    appendTools(message, [part])
                }
            }
            continue
        }

        flushTools('complete')
        items.push({ type: 'message', message })
        if (message.id === runStatusAfterMessageId && shouldIncludeRunStatus(thread)) {
            items.push({
                type: 'run-status',
                id: `run-status-${message.id}`,
                thread,
            })
        }
    }

    flushTools(isWorking ? undefined : 'complete')
    return items
}

function shouldIncludeRunStatus(thread: RoomExecutionThread | null): boolean {
    return Boolean(thread && (thread.runStartedAt !== null || thread.runtimeMs !== null))
}

export function latestUserMessageId(messages: RoomExecutionMessage[]): string | null {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index]!
        if (message.role === 'user') return message.id
    }
    return null
}

export function mergeToolTaskForDisplay(
    existing: ToolActivityTask,
    incoming: ToolActivityTask,
): ToolActivityTask {
    const status = combinedToolStatus(existing.status, incoming.status)
    return {
        ...existing,
        status,
        detail: existing.detail ?? incoming.detail,
        result: incoming.result ?? existing.result,
    }
}

export function combinedToolStatus(left: ToolTaskStatus, right: ToolTaskStatus): ToolTaskStatus {
    if (left === 'error' || right === 'error') return 'error'
    if (left === 'complete' || right === 'complete') return 'complete'
    if (left === 'in_progress' || right === 'in_progress') return 'in_progress'
    return 'pending'
}
