import {
    emptyRuntimePart,
    extractTextFromRuntimeContent,
    runtimeTextPhaseFromSignature,
    toRuntimeSerializable,
} from '#/lib/runtime-message'
import type { RoomExecutionMessagePart, RoomRealtimeEvent } from '#/lib/room-execution-types'
import {
    toolTaskFromRuntimeEvent,
    toolTasksFromParts,
    type ToolActivityTask,
} from '#/lib/tool-activity'

export type StreamTurnStatus =
    | 'idle'
    | 'queued'
    | 'thinking'
    | 'working'
    | 'responding'
    | 'complete'
    | 'error'

export type StreamTurnItem =
    | {
          type: 'assistant'
          id: string
          contentIndex: number | null
          markdown: string
          complete: boolean
          textPhase: RoomExecutionMessagePart['textPhase']
      }
    | {
          type: 'tools'
          id: string
          contentIndex: number | null
          tasks: ToolActivityTask[]
      }

export interface StreamTurnState {
    runId: string | null
    status: StreamTurnStatus
    items: StreamTurnItem[]
    finished: boolean
    updatedAt: number | null
}

type AssistantTextUpdate = {
    contentIndex: number | null
    text: string
    textPhase: RoomExecutionMessagePart['textPhase']
}

export const emptyStreamTurnState: StreamTurnState = {
    runId: null,
    status: 'idle',
    items: [],
    finished: false,
    updatedAt: null,
}

export function streamTurnHasContent(state: StreamTurnState): boolean {
    return state.items.some((item) => {
        if (item.type === 'assistant') return item.markdown.trim().length > 0
        return item.tasks.length > 0
    })
}

export function reduceRoomStreamEvent(
    state: StreamTurnState,
    realtime: RoomRealtimeEvent,
): StreamTurnState {
    if (realtime.event === 'run.accepted') {
        const payload = isRecord(realtime.payload) ? realtime.payload : {}
        return {
            runId: typeof payload.runId === 'string' ? payload.runId : null,
            status: 'queued',
            items: [],
            finished: false,
            updatedAt: realtime.receivedAt,
        }
    }

    if (realtime.event === 'run.finished' || realtime.event === 'agent_end') {
        const payload = isRecord(realtime.payload) ? realtime.payload : {}
        const errored = typeof payload.error === 'string' && payload.error.trim().length > 0
        const settled = settleToolTasks(state, errored ? 'error' : 'complete')
        return {
            ...settled,
            status: errored ? 'error' : 'complete',
            finished: true,
            updatedAt: realtime.receivedAt,
        }
    }

    const event = payloadRuntimeEvent(realtime.payload)
    if (!event) return state

    if (event.type === 'message_update') {
        const assistantEvent = isRecord(event.assistantMessageEvent)
            ? event.assistantMessageEvent
            : null
        if (assistantEvent?.type === 'thinking_delta') {
            return {
                ...state,
                status: state.status === 'idle' ? 'thinking' : state.status,
                updatedAt: realtime.receivedAt,
            }
        }
        if (assistantEvent?.type === 'toolcall_start') {
            const tool = toolTaskFromAssistantToolCall(assistantEvent)
            if (!tool) {
                return {
                    ...state,
                    status:
                        state.status === 'idle' || state.status === 'queued'
                            ? 'thinking'
                            : state.status,
                    updatedAt: realtime.receivedAt,
                }
            }
            return upsertToolTask(state, tool.task, realtime.receivedAt, tool.contentIndex)
        }
        if (
            assistantEvent?.type !== 'text_start' &&
            assistantEvent?.type !== 'text_delta' &&
            assistantEvent?.type !== 'text_end'
        ) {
            return state
        }

        const update = assistantTextFromUpdate(event, assistantEvent)
        if (update.text.trim()) {
            return setAssistantMarkdown(
                state,
                update,
                assistantEvent.type === 'text_end',
                realtime.receivedAt,
            )
        }

        if (assistantEvent.type !== 'text_delta') {
            return {
                ...state,
                status: 'responding',
                updatedAt: realtime.receivedAt,
            }
        }

        const delta = typeof assistantEvent.delta === 'string' ? assistantEvent.delta : ''
        if (!delta) return state
        return appendAssistantDelta(
            state,
            {
                contentIndex: contentIndexFromAssistantEvent(assistantEvent),
                text: delta,
                textPhase: null,
            },
            realtime.receivedAt,
        )
    }

    if (event.type === 'message_end') {
        const message = isRecord(event.message) ? event.message : null
        if (message?.role !== 'assistant') return state
        return setAssistantContentBlocks(state, message.content, true, realtime.receivedAt)
    }

    if (
        event.type === 'tool_execution_start' ||
        event.type === 'tool_execution_update' ||
        event.type === 'tool_execution_end'
    ) {
        const task = toolTaskFromRuntimeEvent(event)
        if (!task) return state
        return upsertToolTask(state, task, realtime.receivedAt)
    }

    if (event.type === 'turn_end') {
        const message = isRecord(event.message) ? event.message : null
        if (message?.role === 'assistant') {
            const withText = setAssistantContentBlocks(
                state,
                message.content,
                true,
                realtime.receivedAt,
            )
            if (streamTurnHasContent(withText)) {
                const settled = settleToolTasks(
                    withText,
                    state.status === 'error' ? 'error' : 'complete',
                )
                return {
                    ...settled,
                    status: state.status === 'error' ? 'error' : 'complete',
                    finished: true,
                    updatedAt: realtime.receivedAt,
                }
            }
        }
        const settled = settleToolTasks(state, state.status === 'error' ? 'error' : 'complete')
        return {
            ...settled,
            status: state.status === 'error' ? 'error' : 'complete',
            finished: true,
            updatedAt: realtime.receivedAt,
        }
    }

    return state
}

export function shouldRefetchForRoomEvent(realtime: RoomRealtimeEvent): boolean {
    if (
        realtime.event === 'run.finished' ||
        realtime.event === 'agent_end' ||
        realtime.event === 'thread.renamed' ||
        realtime.event === 'thread.title_generated' ||
        realtime.event === 'thread.forked'
    ) {
        return true
    }

    const event = payloadRuntimeEvent(realtime.payload)
    if (!event) return false
    if (event.type === 'message_end') {
        const message = isRecord(event.message) ? event.message : null
        return message?.role === 'assistant'
    }
    return (
        event.type === 'tool_execution_end' ||
        event.type === 'turn_end' ||
        event.type === 'compaction_end' ||
        event.type === 'agent_end'
    )
}

function appendAssistantDelta(
    state: StreamTurnState,
    update: AssistantTextUpdate,
    updatedAt: number,
): StreamTurnState {
    const items = [...state.items]
    const existingIndex = findAssistantItemIndex(items, update.contentIndex)

    if (existingIndex !== null) {
        const item = items[existingIndex]!
        if (item.type === 'assistant' && !item.complete) {
            items[existingIndex] = {
                ...item,
                markdown: `${item.markdown}${update.text}`,
                textPhase: update.textPhase ?? item.textPhase,
            }
        }
    } else {
        insertStreamItem(items, {
            type: 'assistant',
            id: assistantItemId(items.length, update.contentIndex),
            contentIndex: update.contentIndex,
            markdown: update.text,
            complete: false,
            textPhase: update.textPhase,
        })
    }

    return {
        ...state,
        status: 'responding',
        items,
        updatedAt,
    }
}

function setAssistantMarkdown(
    state: StreamTurnState,
    update: AssistantTextUpdate,
    complete: boolean,
    updatedAt: number,
): StreamTurnState {
    const items = [...state.items]
    const existingIndex = findAssistantItemIndex(items, update.contentIndex)

    if (existingIndex !== null) {
        const item = items[existingIndex]!
        if (item.type === 'assistant') {
            items[existingIndex] = {
                ...item,
                markdown: update.text,
                complete,
                textPhase: update.textPhase ?? item.textPhase,
            }
        }
    } else {
        insertStreamItem(items, {
            type: 'assistant',
            id: assistantItemId(items.length, update.contentIndex),
            contentIndex: update.contentIndex,
            markdown: update.text,
            complete,
            textPhase: update.textPhase,
        })
    }

    return {
        ...state,
        status: assistantStatusAfterTextUpdate(state),
        items,
        updatedAt,
    }
}

function setAssistantContentBlocks(
    state: StreamTurnState,
    content: unknown,
    complete: boolean,
    updatedAt: number,
): StreamTurnState {
    const updates = assistantTextBlocks(content)
    if (updates.length === 0) return state

    let next = state
    for (const update of updates) {
        next = setAssistantMarkdown(next, update, complete, updatedAt)
    }
    return next
}

function upsertToolTask(
    state: StreamTurnState,
    task: ToolActivityTask,
    updatedAt: number,
    contentIndex: number | null = null,
): StreamTurnState {
    const items = [...state.items]

    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
        const item = items[itemIndex]!
        if (item.type !== 'tools') continue
        const taskIndex = item.tasks.findIndex((candidate) => candidate.id === task.id)
        if (taskIndex < 0) continue
        const tasks = [...item.tasks]
        tasks[taskIndex] = mergeToolTask(tasks[taskIndex]!, task)
        items[itemIndex] = {
            ...item,
            tasks,
            contentIndex: item.contentIndex ?? contentIndex,
        }
        return {
            ...state,
            status: task.status === 'error' ? 'error' : 'working',
            items,
            updatedAt,
        }
    }

    const last = items[items.length - 1]
    if (last?.type === 'tools' && (contentIndex === null || last.contentIndex === contentIndex)) {
        items[items.length - 1] = {
            ...last,
            contentIndex: last.contentIndex ?? contentIndex,
            tasks: [...last.tasks, task],
        }
    } else {
        insertStreamItem(items, {
            type: 'tools',
            id: `tools-${items.length + 1}`,
            contentIndex,
            tasks: [task],
        })
    }

    return {
        ...state,
        status: task.status === 'error' ? 'error' : 'working',
        items,
        updatedAt,
    }
}

function settleToolTasks(state: StreamTurnState, status: 'complete' | 'error'): StreamTurnState {
    return {
        ...state,
        items: state.items.map((item) => {
            if (item.type !== 'tools') return item
            return {
                ...item,
                tasks: item.tasks.map((task) => {
                    if (isTerminalToolStatus(task.status)) return task
                    return {
                        ...task,
                        status,
                        result:
                            task.result ??
                            (status === 'error' ? 'The tool did not finish' : 'The tool finished'),
                    }
                }),
            }
        }),
    }
}

function mergeToolTask(existing: ToolActivityTask, incoming: ToolActivityTask): ToolActivityTask {
    if (isTerminalToolStatus(existing.status) && !isTerminalToolStatus(incoming.status)) {
        return {
            ...existing,
            detail: existing.detail ?? incoming.detail,
        }
    }

    if (existing.status === 'error' && incoming.status === 'complete') {
        return existing
    }

    return {
        ...incoming,
        detail: incoming.detail ?? existing.detail,
        result: incoming.result ?? existing.result,
    }
}

function insertStreamItem(items: StreamTurnItem[], item: StreamTurnItem): void {
    if (item.contentIndex === null) {
        items.push(item)
        return
    }

    const index = items.findIndex(
        (existing) => existing.contentIndex !== null && existing.contentIndex > item.contentIndex!,
    )
    if (index < 0) {
        items.push(item)
        return
    }
    items.splice(index, 0, item)
}

function findAssistantItemIndex(
    items: StreamTurnItem[],
    contentIndex: number | null,
): number | null {
    if (contentIndex !== null) {
        const index = items.findIndex(
            (item) => item.type === 'assistant' && item.contentIndex === contentIndex,
        )
        return index >= 0 ? index : null
    }

    for (let index = items.length - 1; index >= 0; index -= 1) {
        const item = items[index]!
        if (item.type === 'assistant' && !item.complete && item.contentIndex === null) {
            return index
        }
    }

    return null
}

function assistantItemId(position: number, contentIndex: number | null): string {
    return contentIndex === null ? `assistant-${position + 1}` : `assistant-content-${contentIndex}`
}

function toolTaskFromAssistantToolCall(
    assistantEvent: Record<string, unknown>,
): { task: ToolActivityTask; contentIndex: number | null } | null {
    const contentIndex = contentIndexFromAssistantEvent(assistantEvent)
    const block = assistantBlockFromEvent(assistantEvent, contentIndex)
    if (!block || block.type !== 'toolCall') return null

    const tasks = toolTasksFromParts([
        emptyRuntimePart({
            type: 'tool_call',
            text: typeof block.name === 'string' ? block.name : '',
            toolName: typeof block.name === 'string' ? block.name : null,
            toolCallId: typeof block.id === 'string' ? block.id : null,
            status: 'running',
            input: toRuntimeSerializable(block.arguments ?? {}),
            rawType: 'toolCall',
            contentIndex,
        }),
    ])
    const task = tasks[0] ?? null
    return task ? { task, contentIndex } : null
}

function assistantTextFromUpdate(
    event: Record<string, unknown>,
    assistantEvent: Record<string, unknown>,
): AssistantTextUpdate {
    const contentIndex = contentIndexFromAssistantEvent(assistantEvent)

    if (typeof assistantEvent.content === 'string') {
        return {
            contentIndex,
            text: assistantEvent.content,
            textPhase: null,
        }
    }

    const block = assistantBlockFromEvent(assistantEvent, contentIndex)
    if (block) {
        return textUpdateFromBlock(block, contentIndex)
    }

    const message = isRecord(event.message) ? event.message : null
    const fallbackBlock =
        message?.role === 'assistant' ? contentBlockAt(message.content, contentIndex) : null
    if (fallbackBlock) {
        return textUpdateFromBlock(fallbackBlock, contentIndex)
    }

    return {
        contentIndex,
        text: '',
        textPhase: null,
    }
}

function assistantTextBlocks(content: unknown): AssistantTextUpdate[] {
    if (Array.isArray(content)) {
        const updates: AssistantTextUpdate[] = []
        for (const [contentIndex, block] of content.entries()) {
            if (!isRecord(block)) continue
            const update = textUpdateFromBlock(block, contentIndex)
            if (update.text.trim()) {
                updates.push(update)
            }
        }
        return updates
    }

    const text = extractTextFromRuntimeContent(content)
    return text.trim()
        ? [
              {
                  contentIndex: null,
                  text,
                  textPhase: null,
              },
          ]
        : []
}

function textUpdateFromBlock(
    block: Record<string, unknown>,
    contentIndex: number | null,
): AssistantTextUpdate {
    return {
        contentIndex,
        text: extractTextFromRuntimeContent(block),
        textPhase: runtimeTextPhaseFromSignature(block.textSignature),
    }
}

function assistantBlockFromEvent(
    assistantEvent: Record<string, unknown>,
    contentIndex: number | null,
): Record<string, unknown> | null {
    const partial = isRecord(assistantEvent.partial) ? assistantEvent.partial : null
    if (partial?.role !== 'assistant') return null
    return contentBlockAt(partial.content, contentIndex)
}

function contentBlockAt(
    content: unknown,
    contentIndex: number | null,
): Record<string, unknown> | null {
    if (!Array.isArray(content)) return null
    if (contentIndex === null) return null
    const block = content[contentIndex]
    return isRecord(block) ? block : null
}

function contentIndexFromAssistantEvent(assistantEvent: Record<string, unknown>): number | null {
    return typeof assistantEvent.contentIndex === 'number' &&
        Number.isInteger(assistantEvent.contentIndex) &&
        assistantEvent.contentIndex >= 0
        ? assistantEvent.contentIndex
        : null
}

function isTerminalToolStatus(status: ToolActivityTask['status']): boolean {
    return status === 'complete' || status === 'error'
}

function payloadRuntimeEvent(payload: unknown): Record<string, unknown> | null {
    if (!isRecord(payload)) return null
    return isRecord(payload.event) ? payload.event : null
}

function assistantStatusAfterTextUpdate(state: StreamTurnState): StreamTurnStatus {
    if (!state.finished) return 'responding'
    return state.status === 'error' ? 'error' : 'complete'
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
