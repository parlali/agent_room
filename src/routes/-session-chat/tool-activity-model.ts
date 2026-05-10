import { extractTextFromRuntimeContent } from '#/lib/runtime-message'
import type { RoomExecutionMessagePart } from '#/server/rooms/execution-types'

export type ToolTaskStatus = 'pending' | 'in_progress' | 'complete' | 'error'

export interface ToolActivityTask {
    id: string
    title: string
    action: string
    status: ToolTaskStatus
    detail: string | null
    result: string | null
}

interface ToolStepParts {
    id: string
    name: string | null
    call: RoomExecutionMessagePart | null
    result: RoomExecutionMessagePart | null
}

interface ToolProjectionInput {
    id: string
    name: string | null
    status: ToolTaskStatus
    input: unknown
    result: unknown
    text: string | null
}

interface ToolCopy {
    title: string
    action: string
    completeResult: string
}

const TOOL_COPY: Array<[RegExp, ToolCopy]> = [
    [
        /^agent_room_memory_read$/,
        {
            title: 'Read memory',
            action: 'read',
            completeResult: 'Room memory was checked',
        },
    ],
    [
        /^agent_room_memory_(patch|replace)$/,
        {
            title: 'Updated memory',
            action: 'edited',
            completeResult: 'Room memory was updated',
        },
    ],
    [
        /^agent_room_(read|workspace_tree|list)$/,
        {
            title: 'Checked files',
            action: 'read',
            completeResult: 'Workspace information was provided to the agent',
        },
    ],
    [
        /^agent_room_search$/,
        {
            title: 'Searched files',
            action: 'searched',
            completeResult: 'Workspace search results were provided to the agent',
        },
    ],
    [
        /^agent_room_(write|edit)$/,
        {
            title: 'Updated files',
            action: 'edited',
            completeResult: 'Workspace files were updated',
        },
    ],
    [
        /^agent_room_(artifact_import|artifact_export)$/,
        {
            title: 'Moved artifact',
            action: 'updated',
            completeResult: 'Artifact files were moved',
        },
    ],
    [
        /^agent_room_(shell|command_start|command_poll|command_status|command_terminate)$/,
        {
            title: 'Ran workspace command',
            action: 'ran',
            completeResult: 'Command state was updated',
        },
    ],
    [
        /^agent_room_web_search$/,
        {
            title: 'Searched the web',
            action: 'searched',
            completeResult: 'Web results were provided to the agent',
        },
    ],
    [
        /^agent_room_fetch_url$/,
        {
            title: 'Fetched a web page',
            action: 'read',
            completeResult: 'Page content was provided to the agent',
        },
    ],
    [
        /^agent_room_docx$/,
        {
            title: 'Worked on a document',
            action: 'edited',
            completeResult: 'Document work completed',
        },
    ],
    [
        /^agent_room_xlsx$/,
        {
            title: 'Worked on a spreadsheet',
            action: 'edited',
            completeResult: 'Spreadsheet work completed',
        },
    ],
    [
        /^agent_room_pptx$/,
        {
            title: 'Worked on a presentation',
            action: 'edited',
            completeResult: 'Presentation work completed',
        },
    ],
    [
        /^agent_room_pdf$/,
        {
            title: 'Prepared a PDF',
            action: 'created',
            completeResult: 'PDF work completed',
        },
    ],
    [
        /^agent_room_image_generate$/,
        {
            title: 'Created an image',
            action: 'created',
            completeResult: 'Image generation completed',
        },
    ],
    [
        /^agent_room_subagent$/,
        {
            title: 'Asked another agent',
            action: 'delegated',
            completeResult: 'The agent returned its work',
        },
    ],
    [
        /^mcp_/,
        {
            title: 'Used a connected tool',
            action: 'used',
            completeResult: 'The connected tool returned a result',
        },
    ],
]

const SENSITIVE_KEY_PATTERN = /(secret|token|password|credential|authorization|api.?key|hash)/i

export function toolTasksFromParts(parts: RoomExecutionMessagePart[]): ToolActivityTask[] {
    return groupToolSteps(parts).map((step, index) =>
        projectToolTask({
            id: step.id,
            name: step.name,
            status: toolStatusFromStep(step),
            input: step.call?.input ?? null,
            result: step.result?.result ?? null,
            text: step.result?.text ?? step.call?.text ?? null,
        }, index),
    )
}

export function toolTaskFromRuntimeEvent(event: Record<string, unknown>): ToolActivityTask | null {
    const toolName = typeof event.toolName === 'string' ? event.toolName : null
    const toolCallId = typeof event.toolCallId === 'string' ? event.toolCallId : null
    if (!toolName && !toolCallId) return null

    const result = event.type === 'tool_execution_end' ? event.result : event.partialResult
    const resultRecord = isRecord(result) ? result : null
    const isError = event.isError === true || resultRecord?.isError === true

    return projectToolTask({
        id: toolCallId ?? `${toolName ?? 'tool'}-${String(event.type ?? 'event')}`,
        name: toolName,
        status:
            event.type === 'tool_execution_end'
                ? isError
                    ? 'error'
                    : 'complete'
                : 'in_progress',
        input: event.args ?? null,
        result: result ?? null,
        text:
            event.type === 'tool_execution_end'
                ? extractTextFromRuntimeContent(resultRecord?.content ?? result)
                : extractTextFromRuntimeContent(
                      isRecord(event.partialResult)
                          ? event.partialResult.content
                          : event.partialResult,
                  ),
    })
}

export function summarizeToolTasks(tasks: ToolActivityTask[]): string {
    if (tasks.length === 0) return 'Working'
    if (tasks.length === 1) return tasks[0]!.title

    const counts = new Map<string, number>()
    for (const task of tasks) {
        counts.set(task.action, (counts.get(task.action) ?? 0) + 1)
    }

    return [...counts.entries()]
        .map(([action, count]) => `${action} ${count} ${count === 1 ? 'step' : 'steps'}`)
        .join(', ')
}

function groupToolSteps(parts: RoomExecutionMessagePart[]): ToolStepParts[] {
    const byId = new Map<string, ToolStepParts>()
    const ordered: ToolStepParts[] = []

    parts.forEach((part, index) => {
        if (part.type !== 'tool_call' && part.type !== 'tool_result') return
        const id = part.toolCallId ?? `${part.toolName ?? 'tool'}-${index}`
        const existing =
            byId.get(id) ??
            ({
                id,
                name: part.toolName,
                call: null,
                result: null,
            } satisfies ToolStepParts)
        existing.name = existing.name ?? part.toolName
        if (part.type === 'tool_call') {
            existing.call = part
        } else {
            existing.result = part
        }
        if (!byId.has(id)) {
            byId.set(id, existing)
            ordered.push(existing)
        }
    })

    return ordered
}

function toolStatusFromStep(step: ToolStepParts): ToolTaskStatus {
    const status = `${step.call?.status ?? ''} ${step.result?.status ?? ''}`.toLowerCase()
    if (status.includes('error') || status.includes('fail')) return 'error'
    if (step.result) return 'complete'
    if (status.includes('pending')) return 'pending'
    return 'in_progress'
}

function projectToolTask(input: ToolProjectionInput, index = 0): ToolActivityTask {
    const copy = toolCopy(input.name)
    const errorText = input.status === 'error' ? safeErrorText(input.text, input.result) : null
    return {
        id: input.id || `${input.name ?? 'tool'}-${index}`,
        title: copy.title,
        action: copy.action,
        status: input.status,
        detail: safeInputDetail(input.name, input.input),
        result: errorText ?? safeResultText(input.status, copy),
    }
}

function toolCopy(name: string | null): ToolCopy {
    if (name) {
        for (const [pattern, copy] of TOOL_COPY) {
            if (pattern.test(name)) return copy
        }
    }
    return {
        title: 'Used a tool',
        action: 'used',
        completeResult: 'The tool returned a result',
    }
}

function safeResultText(status: ToolTaskStatus, copy: ToolCopy): string | null {
    if (status === 'complete') return copy.completeResult
    if (status === 'in_progress') return 'Working'
    if (status === 'pending') return 'Waiting'
    return null
}

function safeInputDetail(name: string | null, input: unknown): string | null {
    if (!isRecord(input)) return null

    if (name === 'agent_room_web_search') {
        return safeNamedValue(input, ['query', 'q'], 'Query')
    }

    if (name === 'agent_room_fetch_url') {
        return safeUrlValue(input, ['url'], 'Site')
    }

    if (name?.startsWith('agent_room_')) {
        return (
            safePathValue(input, ['path', 'filePath', 'inputPath', 'outputPath'], 'File') ??
            safePathValue(input, ['directory', 'dir'], 'Folder') ??
            safeNamedValue(input, ['pattern', 'oldText', 'query'], 'Reference')
        )
    }

    return null
}

function safeNamedValue(
    input: Record<string, unknown>,
    keys: string[],
    label: string,
): string | null {
    const value = firstSafeString(input, keys)
    return value ? `${label}: ${truncateDisplay(value, 90)}` : null
}

function safePathValue(
    input: Record<string, unknown>,
    keys: string[],
    label: string,
): string | null {
    const value = firstSafeString(input, keys)
    if (!value) return null
    return `${label}: ${safePathLabel(value)}`
}

function safeUrlValue(
    input: Record<string, unknown>,
    keys: string[],
    label: string,
): string | null {
    const value = firstSafeString(input, keys)
    if (!value) return null
    try {
        const url = new URL(value)
        return `${label}: ${url.hostname}`
    } catch {
        return `${label}: ${truncateDisplay(value, 90)}`
    }
}

function firstSafeString(input: Record<string, unknown>, keys: string[]): string | null {
    for (const key of keys) {
        if (SENSITIVE_KEY_PATTERN.test(key)) continue
        const value = input[key]
        if (typeof value === 'string' && value.trim()) return value.trim()
        if (Array.isArray(value)) {
            const first = value.find((entry) => typeof entry === 'string' && entry.trim())
            if (typeof first === 'string') return first.trim()
        }
    }
    return null
}

function safeErrorText(text: string | null, result: unknown): string {
    const message =
        (text?.trim() ? text : null) ??
        (isRecord(result) && typeof result.error === 'string' ? result.error : null) ??
        (isRecord(result) && typeof result.message === 'string' ? result.message : null) ??
        'The tool reported a problem'

    return truncateDisplay(message.replace(/\s+/g, ' '), 180)
}

function safePathLabel(value: string): string {
    const parts = value.split(/[\\/]+/).filter(Boolean)
    if (parts.length === 0) return truncateDisplay(value, 90)
    return parts.slice(-2).join('/')
}

function truncateDisplay(value: string, length: number): string {
    const trimmed = value.trim()
    return trimmed.length > length ? `${trimmed.slice(0, length - 3).trimEnd()}...` : trimmed
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
