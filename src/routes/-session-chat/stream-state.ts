import { extractTextFromRuntimeContent } from '#/lib/runtime-message'
import type { RoomRealtimeEvent } from '#/server/rooms/execution-types'

import { toolTaskFromRuntimeEvent, type ToolActivityTask } from './tool-activity-model'

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
          markdown: string
          complete: boolean
      }
    | {
          type: 'tools'
          id: string
          tasks: ToolActivityTask[]
      }

export interface StreamTurnState {
    runId: string | null
    status: StreamTurnStatus
    items: StreamTurnItem[]
    finished: boolean
    updatedAt: number | null
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
        if (
            assistantEvent?.type !== 'text_start' &&
            assistantEvent?.type !== 'text_delta' &&
            assistantEvent?.type !== 'text_end'
        ) {
            return state
        }

        const canonicalText = assistantTextFromUpdate(event, assistantEvent)
        if (canonicalText.trim()) {
            return setAssistantMarkdown(
                state,
                canonicalText,
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
        return appendAssistantDelta(state, delta, realtime.receivedAt)
    }

    if (event.type === 'message_end') {
        const message = isRecord(event.message) ? event.message : null
        if (message?.role !== 'assistant') return state
        const text = extractTextFromRuntimeContent(message.content)
        if (!text.trim()) return state
        return setAssistantMarkdown(state, text, true, realtime.receivedAt)
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

    if (event.type === 'toolcall_start') {
        return {
            ...state,
            status:
                state.status === 'idle' || state.status === 'queued' ? 'thinking' : state.status,
            updatedAt: realtime.receivedAt,
        }
    }

    if (event.type === 'turn_end') {
        const message = isRecord(event.message) ? event.message : null
        if (message?.role === 'assistant') {
            const text = extractTextFromRuntimeContent(message.content)
            if (text.trim()) {
                const withText = setAssistantMarkdown(state, text, true, realtime.receivedAt)
                const settled = settleToolTasks(
                    withText,
                    state.status === 'error' ? 'error' : 'complete',
                )
                return {
                    ...settled,
                    status: state.status === 'error' ? 'error' : 'complete',
                    finished: true,
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
        event.type === 'turn_end' || event.type === 'compaction_end' || event.type === 'agent_end'
    )
}

function appendAssistantDelta(
    state: StreamTurnState,
    delta: string,
    updatedAt: number,
): StreamTurnState {
    const items = [...state.items]
    const last = items[items.length - 1]

    if (last?.type === 'assistant' && !last.complete) {
        items[items.length - 1] = {
            ...last,
            markdown: `${last.markdown}${delta}`,
        }
    } else {
        items.push({
            type: 'assistant',
            id: `assistant-${items.length + 1}`,
            markdown: delta,
            complete: false,
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
    markdown: string,
    complete: boolean,
    updatedAt: number,
): StreamTurnState {
    const items = [...state.items]

    for (let index = items.length - 1; index >= 0; index -= 1) {
        const item = items[index]!
        if (item.type !== 'assistant') continue
        items[index] = {
            ...item,
            markdown,
            complete,
        }
        return {
            ...state,
            status: assistantStatusAfterTextUpdate(state),
            items,
            updatedAt,
        }
    }

    items.push({
        type: 'assistant',
        id: `assistant-${items.length + 1}`,
        markdown,
        complete,
    })

    return {
        ...state,
        status: assistantStatusAfterTextUpdate(state),
        items,
        updatedAt,
    }
}

function upsertToolTask(
    state: StreamTurnState,
    task: ToolActivityTask,
    updatedAt: number,
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
        }
        return {
            ...state,
            status: task.status === 'error' ? 'error' : 'working',
            items,
            updatedAt,
        }
    }

    const last = items[items.length - 1]
    if (last?.type === 'tools') {
        items[items.length - 1] = {
            ...last,
            tasks: [...last.tasks, task],
        }
    } else {
        items.push({
            type: 'tools',
            id: `tools-${items.length + 1}`,
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

function assistantTextFromUpdate(
    event: Record<string, unknown>,
    assistantEvent: Record<string, unknown>,
): string {
    if (typeof assistantEvent.content === 'string') {
        return assistantEvent.content
    }
    const partial = isRecord(assistantEvent.partial) ? assistantEvent.partial : null
    if (partial?.role === 'assistant') {
        return extractTextFromRuntimeContent(partial.content)
    }
    const message = isRecord(event.message) ? event.message : null
    if (message?.role === 'assistant') {
        return extractTextFromRuntimeContent(message.content)
    }
    return ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
