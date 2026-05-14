import type { RoomAttachment } from '#/lib/room-attachments'
import type {
    ChatTimelineRow,
    RoomExecutionMessage,
    RoomExecutionMessagePart,
    RoomExecutionThread,
    RunTranscriptRow,
    RunTranscriptStatus,
    WorkTranscriptItem,
} from '#/lib/room-execution-types'

import {
    isNonTerminalToolResult,
    isTerminalToolStatus,
    settleToolTaskForDisplay,
    toolTasksFromParts,
    type ToolActivityTask,
    type ToolTaskStatus,
} from './tool-activity'

export type DisplayItem = ChatTimelineRow

export type EditingMessageDraft = {
    id: string
    text: string
    timestamp: number | null
    attachments: RoomAttachment[]
}

export interface TranscriptTextInput {
    id: string
    turnIndex: number
    contentIndex: number | null
    markdown: string
    complete: boolean
    phase: 'thinking' | 'commentary' | 'unknown'
    timestamp: number | null
}

export interface TranscriptToolInput {
    id: string
    turnIndex: number
    contentIndex: number | null
    toolCallId: string
    task: ToolActivityTask
    timestamp: number | null
}

interface RunBuilder {
    runId: string
    startedAt: number | null
    runtimeMs: number | null
    status: RunTranscriptStatus
    collapsed: boolean
    items: WorkTranscriptItem[]
    finalRows: Array<Extract<ChatTimelineRow, { type: 'assistant_final' }>>
    turnIndex: number
    seenToolActivity: boolean
    latestTimestamp: number | null
}

export function buildChatTimelineRows(
    messages: RoomExecutionMessage[],
    isWorking: boolean,
    thread: RoomExecutionThread | null,
): ChatTimelineRow[] {
    const rows: ChatTimelineRow[] = []
    const latestUserId = latestUserMessageId(messages)
    let current: RunBuilder | null = null

    const flushRun = () => {
        if (!current) return
        const transcript = rowFromBuilder(current, rows.length)
        if (shouldRenderTranscript(transcript)) {
            rows.push(transcript)
        }
        for (const finalRow of current.finalRows) {
            rows.push({
                ...finalRow,
                seq: rows.length,
            })
        }
        current = null
    }

    for (const message of messages) {
        if (message.role === 'user') {
            flushRun()
            rows.push({
                type: 'user_message',
                id: message.id,
                seq: rows.length,
                message,
                timestamp: message.timestamp,
            })
            const isLatestRun = message.id === latestUserId
            current = {
                runId: `run-${message.id}`,
                startedAt: isLatestRun
                    ? (thread?.runStartedAt ?? message.timestamp)
                    : message.timestamp,
                runtimeMs: isLatestRun ? (thread?.runtimeMs ?? null) : null,
                status: isLatestRun ? statusFromThread(isWorking, thread) : 'complete',
                collapsed: !isLatestRun || !isWorking,
                items: [],
                finalRows: [],
                turnIndex: 0,
                seenToolActivity: false,
                latestTimestamp: message.timestamp,
            }
            continue
        }

        if (message.role === 'system' || message.role === 'other') {
            flushRun()
            rows.push({
                type: 'system',
                id: message.id,
                seq: rows.length,
                message,
                timestamp: message.timestamp,
            })
            continue
        }

        if (!current) {
            rows.push(rowForDetachedMessage(message, rows.length))
            continue
        }

        if (message.role === 'tool') {
            applyToolParts(current, message)
            current.turnIndex += 1
            continue
        }

        if (message.role === 'assistant') {
            applyAssistantMessage(current, message)
            current.turnIndex += 1
        }
    }

    flushRun()
    return rows
}

export function createRunTranscriptRow(input: {
    id: string
    seq: number
    runId: string
    status: RunTranscriptStatus
    startedAt: number | null
    runtimeMs: number | null
    collapsed: boolean
    timestamp: number | null
    items?: WorkTranscriptItem[]
}): RunTranscriptRow {
    return {
        type: 'run_transcript',
        id: input.id,
        seq: input.seq,
        runId: input.runId,
        status: input.status,
        startedAt: input.startedAt,
        runtimeMs: input.runtimeMs,
        collapsed: input.collapsed,
        items: sortTranscriptItems(input.items ?? []),
        timestamp: input.timestamp,
    }
}

export function upsertModelTextItem(
    row: RunTranscriptRow,
    input: TranscriptTextInput,
): RunTranscriptRow {
    const existingIndex = row.items.findIndex(
        (item) => item.type === 'model_text' && item.id === input.id,
    )
    const item: WorkTranscriptItem = {
        type: 'model_text',
        id: input.id,
        turnIndex: input.turnIndex,
        contentIndex: input.contentIndex,
        markdown: input.markdown,
        complete: input.complete,
        phase: input.phase,
        timestamp: input.timestamp,
    }
    return replaceTranscriptItem(row, existingIndex, item)
}

export function appendModelTextDelta(
    row: RunTranscriptRow,
    input: TranscriptTextInput,
): RunTranscriptRow {
    const existing = row.items.find(
        (item): item is Extract<WorkTranscriptItem, { type: 'model_text' }> =>
            item.type === 'model_text' && item.id === input.id,
    )
    return upsertModelTextItem(row, {
        ...input,
        markdown: existing ? `${existing.markdown}${input.markdown}` : input.markdown,
        phase:
            input.phase === 'thinking' || input.phase === 'commentary'
                ? input.phase
                : (existing?.phase ?? input.phase),
    })
}

export function completeModelTextItem(
    row: RunTranscriptRow,
    input: Pick<TranscriptTextInput, 'id' | 'timestamp'>,
): RunTranscriptRow {
    const existingIndex = row.items.findIndex(
        (item) => item.type === 'model_text' && item.id === input.id,
    )
    const existing = row.items[existingIndex]
    if (existingIndex < 0 || existing?.type !== 'model_text') {
        return row
    }
    return replaceTranscriptItem(row, existingIndex, {
        ...existing,
        complete: true,
        timestamp: input.timestamp,
    })
}

export function upsertToolActivityItem(
    row: RunTranscriptRow,
    input: TranscriptToolInput,
): RunTranscriptRow {
    const existingIndex = row.items.findIndex(
        (item) => item.type === 'tool_activity' && item.toolCallId === input.toolCallId,
    )
    const existing =
        existingIndex >= 0 ? (row.items[existingIndex] as WorkTranscriptItem | undefined) : null
    const task =
        existing?.type === 'tool_activity'
            ? mergeToolTaskForDisplay(existing.task, input.task)
            : input.task
    const item: WorkTranscriptItem = {
        type: 'tool_activity',
        id: input.id,
        turnIndex:
            existing?.type === 'tool_activity'
                ? Math.min(existing.turnIndex, input.turnIndex)
                : input.turnIndex,
        contentIndex:
            existing?.type === 'tool_activity'
                ? (existing.contentIndex ?? input.contentIndex)
                : input.contentIndex,
        toolCallId: input.toolCallId,
        task,
        timestamp: input.timestamp,
    }
    return replaceTranscriptItem(row, existingIndex, item)
}

export function settleTranscriptItems(
    row: RunTranscriptRow,
    status: 'stopped' | 'complete' | 'error',
): RunTranscriptRow {
    return {
        ...row,
        items: row.items.map((item) => {
            if (item.type === 'model_text') {
                return {
                    ...item,
                    complete: true,
                }
            }
            if (item.type !== 'tool_activity') return item
            const taskStatus = isTerminalToolStatus(item.task.status) ? item.task.status : status
            return {
                ...item,
                task: settleToolTaskForDisplay(item.task, taskStatus),
            }
        }),
    }
}

export function transcriptHasVisibleContent(row: RunTranscriptRow): boolean {
    return row.items.some(workTranscriptItemHasVisibleContent)
}

export function transcriptHasExpandableContent(row: RunTranscriptRow): boolean {
    return row.items.some(workTranscriptItemHasVisibleContent)
}

export function workTranscriptItemHasVisibleContent(item: WorkTranscriptItem): boolean {
    if (item.type === 'model_text') return item.markdown.trim().length > 0
    return true
}

export function rowContainsMessage(
    row: ChatTimelineRow,
): row is Extract<ChatTimelineRow, { type: 'user_message' | 'assistant_final' | 'system' }> {
    return row.type === 'user_message' || row.type === 'assistant_final' || row.type === 'system'
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
    const task = {
        ...existing,
        status,
        detail: incoming.detail ?? existing.detail,
        result: mergedToolResult(existing, incoming, status),
    }
    return isTerminalToolStatus(status) ? settleToolTaskForDisplay(task, status) : task
}

export function combinedToolStatus(left: ToolTaskStatus, right: ToolTaskStatus): ToolTaskStatus {
    if (left === 'error' || right === 'error') return 'error'
    if (left === 'complete' || right === 'complete') return 'complete'
    if (left === 'stopped' || right === 'stopped') return 'stopped'
    if (left === 'in_progress' || right === 'in_progress') return 'in_progress'
    return 'pending'
}

function mergedToolResult(
    existing: ToolActivityTask,
    incoming: ToolActivityTask,
    status: ToolTaskStatus,
): string | null {
    if (status === 'error') {
        return (
            terminalResultFrom([incoming, existing], 'error') ?? incoming.result ?? existing.result
        )
    }
    if (status === 'complete') {
        return (
            terminalResultFrom([incoming, existing], 'complete') ??
            incoming.result ??
            existing.result
        )
    }
    return incoming.result ?? existing.result
}

function terminalResultFrom(
    tasks: ToolActivityTask[],
    status: 'complete' | 'error',
): string | null {
    const task = tasks.find(
        (candidate) =>
            candidate.status === status &&
            candidate.result !== null &&
            !isNonTerminalToolResult(candidate.result),
    )
    return task?.result ?? null
}

function applyAssistantMessage(builder: RunBuilder, message: RoomExecutionMessage): void {
    const parts = message.parts.filter(
        (part) =>
            (part.type === 'text' && part.text.trim()) ||
            part.type === 'thinking' ||
            part.type === 'tool_call' ||
            part.type === 'tool_result',
    )
    if (parts.length === 0) {
        if (message.text.trim()) {
            appendFinalRow(builder, message, message.text, null, null)
        }
        return
    }

    const messageHasToolCall = parts.some((part) => part.type === 'tool_call')
    for (const [index, part] of parts.entries()) {
        if (part.type === 'text') {
            const phase = classifyPersistedTextPart(builder, part, messageHasToolCall)
            if (phase === 'final_answer') {
                appendFinalRow(builder, message, part.text, part, index)
            } else {
                builder.items = upsertModelTextItem(rowFromBuilder(builder, 0), {
                    id: transcriptTextId(message.id, index, part.contentIndex),
                    turnIndex: builder.turnIndex,
                    contentIndex: part.contentIndex,
                    markdown: part.text,
                    complete: true,
                    phase: part.textPhase === 'commentary' ? 'commentary' : 'unknown',
                    timestamp: message.timestamp,
                }).items
            }
            builder.latestTimestamp = message.timestamp ?? builder.latestTimestamp
            continue
        }

        if (part.type === 'thinking') {
            if (!part.text.trim()) {
                continue
            }
            builder.items = upsertModelTextItem(rowFromBuilder(builder, 0), {
                id: transcriptTextId(message.id, index, part.contentIndex),
                turnIndex: builder.turnIndex,
                contentIndex: part.contentIndex,
                markdown: part.text,
                complete: true,
                phase: 'thinking',
                timestamp: message.timestamp,
            }).items
            builder.latestTimestamp = message.timestamp ?? builder.latestTimestamp
            continue
        }

        applyToolPart(builder, message, part, index)
    }
}

function applyToolParts(builder: RunBuilder, message: RoomExecutionMessage): void {
    const toolParts = message.parts.filter(
        (part) => part.type === 'tool_call' || part.type === 'tool_result',
    )
    for (const [index, part] of toolParts.entries()) {
        applyToolPart(builder, message, part, index)
    }
}

function applyToolPart(
    builder: RunBuilder,
    message: RoomExecutionMessage,
    part: RoomExecutionMessagePart,
    index: number,
): void {
    const task = toolTasksFromParts([part])[0] ?? null
    const toolCallId = part.toolCallId ?? task?.id ?? `${message.id}:tool:${index}`
    if (!task) return
    moveUnknownFinalRowsToTranscript(builder)
    builder.items = upsertToolActivityItem(rowFromBuilder(builder, 0), {
        id: `tool-${toolCallId}`,
        turnIndex: builder.turnIndex,
        contentIndex: part.contentIndex,
        toolCallId,
        task,
        timestamp: message.timestamp,
    }).items
    builder.seenToolActivity = true
    builder.latestTimestamp = message.timestamp ?? builder.latestTimestamp
}

function moveUnknownFinalRowsToTranscript(builder: RunBuilder): void {
    const remaining: Array<Extract<ChatTimelineRow, { type: 'assistant_final' }>> = []
    let moved = false
    for (const finalRow of builder.finalRows) {
        const part = finalRow.message.parts[0] ?? null
        if (part?.type !== 'text' || part.textPhase !== null) {
            remaining.push(finalRow)
            continue
        }
        moved = true
        builder.items = upsertModelTextItem(rowFromBuilder(builder, 0), {
            id: transcriptTextId(finalRow.message.id, 0, part.contentIndex),
            turnIndex: builder.turnIndex,
            contentIndex: part.contentIndex,
            markdown: finalRow.message.text,
            complete: true,
            phase: 'unknown',
            timestamp: finalRow.timestamp,
        }).items
        builder.latestTimestamp = finalRow.timestamp ?? builder.latestTimestamp
    }
    builder.finalRows = remaining
    if (moved && remaining.length === 0 && isActiveTranscriptStatus(builder.status)) {
        builder.collapsed = false
    }
}

function appendFinalRow(
    builder: RunBuilder,
    message: RoomExecutionMessage,
    text: string,
    part: RoomExecutionMessagePart | null,
    partIndex: number | null,
): void {
    if (!text.trim()) return
    const split = part !== null || builder.finalRows.length > 0 || message.parts.length > 1
    builder.finalRows.push({
        type: 'assistant_final',
        id: split ? `${message.id}:final:${partIndex ?? builder.finalRows.length}` : message.id,
        seq: 0,
        message: {
            ...message,
            id: split ? `${message.id}:final:${partIndex ?? builder.finalRows.length}` : message.id,
            text,
            parts: part ? [part] : message.parts,
        },
        streaming: false,
        timestamp: message.timestamp,
    })
    builder.collapsed = true
    if (isActiveTranscriptStatus(builder.status)) {
        builder.status = 'complete'
    }
    builder.latestTimestamp = message.timestamp ?? builder.latestTimestamp
}

function classifyPersistedTextPart(
    builder: RunBuilder,
    part: RoomExecutionMessagePart,
    messageHasToolCall: boolean,
): RoomExecutionMessagePart['textPhase'] | 'unknown' {
    if (part.textPhase === 'commentary' || part.textPhase === 'final_answer') {
        return part.textPhase
    }
    if (messageHasToolCall) return 'commentary'
    if (builder.seenToolActivity) return 'final_answer'
    return 'final_answer'
}

function rowFromBuilder(builder: RunBuilder, seq: number): RunTranscriptRow {
    const runtimeMs =
        builder.runtimeMs ??
        (!isActiveTranscriptStatus(builder.status) &&
        builder.startedAt !== null &&
        builder.latestTimestamp !== null
            ? Math.max(0, builder.latestTimestamp - builder.startedAt)
            : null)
    return createRunTranscriptRow({
        id: `run-transcript-${builder.runId}`,
        seq,
        runId: builder.runId,
        status: builder.status,
        startedAt: builder.startedAt,
        runtimeMs,
        collapsed: builder.collapsed,
        timestamp: builder.latestTimestamp,
        items: builder.items,
    })
}

function rowForDetachedMessage(message: RoomExecutionMessage, seq: number): ChatTimelineRow {
    if (message.role === 'assistant') {
        return {
            type: 'assistant_final',
            id: message.id,
            seq,
            message,
            streaming: false,
            timestamp: message.timestamp,
        }
    }
    if (message.role === 'user') {
        return {
            type: 'user_message',
            id: message.id,
            seq,
            message,
            timestamp: message.timestamp,
        }
    }
    return {
        type: 'system',
        id: message.id,
        seq,
        message,
        timestamp: message.timestamp,
    }
}

function shouldRenderTranscript(row: RunTranscriptRow): boolean {
    return transcriptHasVisibleContent(row) || isActiveTranscriptStatus(row.status)
}

function statusFromThread(
    isWorking: boolean,
    thread: RoomExecutionThread | null,
): RunTranscriptStatus {
    if (!isWorking) return thread?.status === 'error' ? 'error' : 'complete'
    const status = thread?.status?.toLowerCase() ?? ''
    if (status.includes('queue')) return 'queued'
    if (status.includes('compact')) return 'working'
    return 'working'
}

function replaceTranscriptItem(
    row: RunTranscriptRow,
    existingIndex: number,
    item: WorkTranscriptItem,
): RunTranscriptRow {
    const items = [...row.items]
    if (existingIndex >= 0) {
        items[existingIndex] = item
    } else {
        items.push(item)
    }
    return {
        ...row,
        items: sortTranscriptItems(items),
        timestamp: item.timestamp ?? row.timestamp,
    }
}

function sortTranscriptItems(items: WorkTranscriptItem[]): WorkTranscriptItem[] {
    return [...items].sort((left, right) => {
        const turnDelta = left.turnIndex - right.turnIndex
        if (turnDelta !== 0) return turnDelta
        const leftContent = left.contentIndex ?? Number.MAX_SAFE_INTEGER
        const rightContent = right.contentIndex ?? Number.MAX_SAFE_INTEGER
        if (leftContent !== rightContent) return leftContent - rightContent
        return left.id.localeCompare(right.id)
    })
}

function isActiveTranscriptStatus(status: RunTranscriptStatus): boolean {
    return (
        status === 'queued' ||
        status === 'thinking' ||
        status === 'working' ||
        status === 'responding'
    )
}

function transcriptTextId(messageId: string, index: number, contentIndex: number | null): string {
    return contentIndex === null
        ? `model-text-${messageId}-${index}`
        : `model-text-${messageId}-${contentIndex}`
}
