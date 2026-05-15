import {
    emptyRuntimePart,
    extractTextFromRuntimeContent,
    runtimeTextPhaseFromSignature,
    toRuntimeSerializable,
} from '#/lib/runtime-message'
import type {
    ChatTimelineRow,
    RoomExecutionMessage,
    RoomExecutionMessagePart,
    RoomRealtimeEvent,
    RunTranscriptRow,
    RunTranscriptStatus,
} from '#/lib/room-execution-types'
import {
    appendModelTextDelta,
    completeModelTextItem,
    createRunTranscriptRow,
    settleTranscriptItems,
    transcriptHasVisibleContent,
    upsertModelTextItem,
    upsertToolActivityItem,
} from '#/lib/message-list-model'
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
    | 'stopped'
    | 'complete'
    | 'error'

export interface StreamTurnState {
    runId: string | null
    status: StreamTurnStatus
    rows: ChatTimelineRow[]
    finished: boolean
    updatedAt: number | null
    startedAt: number | null
    turnIndex: number
    hasToolActivity: boolean
    currentTurnHasToolCall: boolean
}

type AssistantTextUpdate = {
    contentIndex: number | null
    text: string
    textPhase: RoomExecutionMessagePart['textPhase']
}

type TranscriptTextPhase = 'thinking' | 'commentary' | 'unknown'

export const emptyStreamTurnState: StreamTurnState = {
    runId: null,
    status: 'idle',
    rows: [],
    finished: false,
    updatedAt: null,
    startedAt: null,
    turnIndex: 0,
    hasToolActivity: false,
    currentTurnHasToolCall: false,
}

export function streamTurnHasContent(state: StreamTurnState): boolean {
    return state.rows.some((row) => {
        if (row.type === 'run_transcript') return transcriptHasVisibleContent(row)
        if (row.type === 'assistant_final') return row.message.text.trim().length > 0
        return false
    })
}

export function reduceRoomStreamEvent(
    state: StreamTurnState,
    realtime: RoomRealtimeEvent,
): StreamTurnState {
    if (realtime.event === 'run.accepted') {
        const payload = isRecord(realtime.payload) ? realtime.payload : {}
        const runId =
            typeof payload.runId === 'string' && payload.runId.trim()
                ? payload.runId
                : `live-${realtime.receivedAt}`
        const startedAt = runStartedAtFromPayload(payload, realtime.receivedAt)
        return {
            runId,
            status: 'queued',
            rows: [
                createRunTranscriptRow({
                    id: `run-transcript-${runId}`,
                    seq: 0,
                    runId,
                    status: 'queued',
                    startedAt,
                    runtimeMs: null,
                    collapsed: false,
                    timestamp: startedAt,
                }),
            ],
            finished: false,
            updatedAt: realtime.receivedAt,
            startedAt,
            turnIndex: 0,
            hasToolActivity: false,
            currentTurnHasToolCall: false,
        }
    }

    if (state.finished) {
        return state
    }

    if (realtime.event === 'run.finished' || realtime.event === 'agent_end') {
        const payload = isRecord(realtime.payload) ? realtime.payload : {}
        const errored = typeof payload.error === 'string' && payload.error.trim().length > 0
        const status = errored ? 'error' : 'complete'
        const runtimeMs =
            typeof payload.durationMs === 'number' && Number.isFinite(payload.durationMs)
                ? payload.durationMs
                : state.startedAt
                  ? Math.max(0, realtime.receivedAt - state.startedAt)
                  : null
        return finishStreamTurn(state, status, runtimeMs, realtime.receivedAt)
    }

    if (realtime.event === 'run.error') {
        return reduceRunError(state, realtime)
    }

    const event = payloadRuntimeEvent(realtime.payload)
    if (!event) return state

    if (event.type === 'agent_start' || event.type === 'turn_start') {
        return ensureTranscript(state, realtime.receivedAt, 'thinking')
    }

    if (event.type === 'message_update') {
        return reduceMessageUpdate(state, event, realtime.receivedAt)
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
        return upsertLiveToolTask(state, task, realtime.receivedAt)
    }

    if (event.type === 'turn_end') {
        const message = isRecord(event.message) ? event.message : null
        const withMessage =
            message?.role === 'assistant'
                ? setAssistantContentBlocks(state, message.content, true, realtime.receivedAt)
                : state
        return {
            ...withMessage,
            turnIndex: withMessage.turnIndex + 1,
            currentTurnHasToolCall: false,
            updatedAt: realtime.receivedAt,
        }
    }

    return state
}

export function shouldRefetchForRoomEvent(realtime: RoomRealtimeEvent): boolean {
    if (
        realtime.event === 'run.finished' ||
        realtime.event === 'run.accepted' ||
        realtime.event === 'run.error' ||
        realtime.event === 'agent_end' ||
        realtime.event === 'thread.message_edited' ||
        realtime.event === 'thread.renamed' ||
        realtime.event === 'thread.title_generated' ||
        realtime.event === 'thread.forked' ||
        realtime.event === 'thread.deleted' ||
        realtime.event === 'thread.model_changed' ||
        realtime.event === 'thread.pending_messages_changed' ||
        realtime.event === 'room.files.changed'
    ) {
        return true
    }
    return false
}

export function stopStreamTurn(state: StreamTurnState, stoppedAt: number): StreamTurnState {
    if (state.finished) return state
    if (state.rows.length === 0) return emptyStreamTurnState
    const runtimeMs = state.startedAt ? Math.max(0, stoppedAt - state.startedAt) : null
    return finishStreamTurn(state, 'stopped', runtimeMs, stoppedAt)
}

function reduceRunError(state: StreamTurnState, realtime: RoomRealtimeEvent): StreamTurnState {
    const payload = isRecord(realtime.payload) ? realtime.payload : {}
    const runId =
        typeof payload.runId === 'string' && payload.runId.trim()
            ? payload.runId
            : (state.runId ?? `live-${realtime.receivedAt}`)
    const startedAt = state.startedAt ?? runStartedAtFromPayload(payload, realtime.receivedAt)
    const message = runErrorMessageFromPayload(payload)
    const runtimeMs =
        typeof payload.durationMs === 'number' && Number.isFinite(payload.durationMs)
            ? payload.durationMs
            : Math.max(0, realtime.receivedAt - startedAt)
    const transcript = currentTranscript(
        ensureTranscript(
            {
                ...state,
                runId,
                startedAt,
                finished: false,
            },
            realtime.receivedAt,
            'error',
        ),
    )
    if (!transcript) {
        return finishStreamTurn(
            {
                ...state,
                runId,
                startedAt,
            },
            'error',
            runtimeMs,
            realtime.receivedAt,
        )
    }
    const withError = writeTranscriptText(
        transcript,
        {
            id: `run-error-${runId}`,
            contentIndex: null,
            text: message,
            complete: true,
            phase: 'commentary',
            timestamp: realtime.receivedAt,
            append: false,
        },
        'error',
    )
    return finishStreamTurn(withError, 'error', runtimeMs, realtime.receivedAt)
}

function reduceMessageUpdate(
    state: StreamTurnState,
    event: Record<string, unknown>,
    updatedAt: number,
): StreamTurnState {
    const assistantEvent = isRecord(event.assistantMessageEvent)
        ? event.assistantMessageEvent
        : null
    if (!assistantEvent) return state

    if (
        assistantEvent.type === 'thinking_start' ||
        assistantEvent.type === 'thinking_delta' ||
        assistantEvent.type === 'thinking_end'
    ) {
        return reduceThinkingUpdate(state, assistantEvent, updatedAt)
    }

    if (
        assistantEvent.type === 'toolcall_start' ||
        assistantEvent.type === 'toolcall_delta' ||
        assistantEvent.type === 'toolcall_end'
    ) {
        const tool = toolTaskFromAssistantToolCall(assistantEvent)
        const withToolTurn = moveCurrentTurnUnknownFinalTextToTranscript({
            ...state,
            currentTurnHasToolCall: true,
            hasToolActivity: true,
        })
        if (!tool) {
            return updateTranscriptStatus(withToolTurn, 'working', updatedAt)
        }
        return upsertLiveToolTask(withToolTurn, tool.task, updatedAt, tool.contentIndex)
    }

    if (
        assistantEvent.type !== 'text_start' &&
        assistantEvent.type !== 'text_delta' &&
        assistantEvent.type !== 'text_end'
    ) {
        return state
    }

    const update = assistantTextFromUpdate(event, assistantEvent)
    if (update.text.trim()) {
        return setAssistantText(state, update, assistantEvent.type === 'text_end', updatedAt)
    }

    if (assistantEvent.type === 'text_delta') {
        const delta = typeof assistantEvent.delta === 'string' ? assistantEvent.delta : ''
        if (!delta) return updateTranscriptStatus(state, 'responding', updatedAt)
        return appendAssistantText(
            state,
            {
                contentIndex: contentIndexFromAssistantEvent(assistantEvent),
                text: delta,
                textPhase: update.textPhase,
            },
            updatedAt,
        )
    }

    return updateTranscriptStatus(state, 'responding', updatedAt)
}

function setAssistantText(
    state: StreamTurnState,
    update: AssistantTextUpdate,
    complete: boolean,
    updatedAt: number,
): StreamTurnState {
    const phase = classifyLiveText(state, update)
    if (phase === 'final_answer') {
        return upsertFinalText(state, update, complete, updatedAt)
    }
    const transcript = currentTranscript(ensureTranscript(state, updatedAt, 'responding'))
    if (!transcript) return state
    return writeTranscriptText(
        transcript,
        {
            id: liveTextItemId(transcript.state.turnIndex, 'text', update.contentIndex),
            contentIndex: update.contentIndex,
            text: update.text,
            complete,
            phase: update.textPhase === 'commentary' ? 'commentary' : 'unknown',
            timestamp: updatedAt,
            append: false,
        },
        'responding',
    )
}

function appendAssistantText(
    state: StreamTurnState,
    update: AssistantTextUpdate,
    updatedAt: number,
): StreamTurnState {
    const phase = classifyLiveText(state, update)
    if (phase === 'final_answer') {
        return appendFinalText(state, update, updatedAt)
    }
    const transcript = currentTranscript(ensureTranscript(state, updatedAt, 'responding'))
    if (!transcript) return state
    return writeTranscriptText(
        transcript,
        {
            id: liveTextItemId(transcript.state.turnIndex, 'text', update.contentIndex),
            contentIndex: update.contentIndex,
            text: update.text,
            complete: false,
            phase: update.textPhase === 'commentary' ? 'commentary' : 'unknown',
            timestamp: updatedAt,
            append: true,
        },
        'responding',
    )
}

function upsertFinalText(
    state: StreamTurnState,
    update: AssistantTextUpdate,
    complete: boolean,
    updatedAt: number,
): StreamTurnState {
    return writeFinalText(state, update, update.text, complete, updatedAt, false)
}

function appendFinalText(
    state: StreamTurnState,
    update: AssistantTextUpdate,
    updatedAt: number,
): StreamTurnState {
    return writeFinalText(state, update, update.text, false, updatedAt, true)
}

function writeFinalText(
    state: StreamTurnState,
    update: AssistantTextUpdate,
    text: string,
    complete: boolean,
    updatedAt: number,
    append: boolean,
): StreamTurnState {
    const ensured = ensureTranscript(state, updatedAt, 'responding')
    const transcript = currentTranscript(ensured)
    const finalId = liveFinalRowId(ensured.turnIndex, update.contentIndex)
    const rows = ensured.rows.map((row): ChatTimelineRow => {
        if (row.type !== 'assistant_final' || row.id !== finalId) return row
        const nextText = append ? `${row.message.text}${text}` : text
        return {
            ...row,
            message: finalMessage(finalId, nextText, update, updatedAt),
            streaming: !complete,
            timestamp: updatedAt,
        }
    })
    if (!rows.some((row) => row.type === 'assistant_final' && row.id === finalId)) {
        rows.push({
            type: 'assistant_final',
            id: finalId,
            seq: rows.length,
            message: finalMessage(finalId, text, update, updatedAt),
            streaming: !complete,
            timestamp: updatedAt,
        })
    }
    const collapsedRows = rows.map((row, seq): ChatTimelineRow => {
        if (row.type === 'run_transcript' && transcript?.row.id === row.id) {
            return {
                ...row,
                seq,
                collapsed: true,
            }
        }
        return {
            ...row,
            seq,
        }
    })
    return {
        ...ensured,
        status: 'responding',
        rows: collapsedRows,
        updatedAt,
    }
}

function reduceThinkingUpdate(
    state: StreamTurnState,
    assistantEvent: Record<string, unknown>,
    updatedAt: number,
): StreamTurnState {
    const ensured = ensureTranscript(state, updatedAt, 'responding')
    const transcript = currentTranscript(ensured)
    if (!transcript) return ensured
    const contentIndex = contentIndexFromAssistantEvent(assistantEvent)
    const id = liveTextItemId(transcript.state.turnIndex, 'thinking', contentIndex)
    const text = thinkingTextFromUpdate(assistantEvent, contentIndex)

    if (assistantEvent.type === 'thinking_end' && text.length === 0) {
        return replaceTranscript(
            transcript.state,
            completeModelTextItem(transcript.row, {
                id,
                timestamp: updatedAt,
            }),
            'responding',
            updatedAt,
        )
    }

    if (text.length === 0) {
        return updateTranscriptStatus(ensured, 'responding', updatedAt)
    }

    return writeTranscriptText(
        transcript,
        {
            id,
            contentIndex,
            text,
            complete: assistantEvent.type === 'thinking_end',
            phase: 'thinking',
            timestamp: updatedAt,
            append: assistantEvent.type === 'thinking_delta',
        },
        'responding',
    )
}

function writeTranscriptText(
    transcript: { state: StreamTurnState; row: RunTranscriptRow },
    input: {
        id: string
        contentIndex: number | null
        text: string
        complete: boolean
        phase: TranscriptTextPhase
        timestamp: number
        append: boolean
    },
    status: RunTranscriptStatus,
): StreamTurnState {
    const nextRow = input.append
        ? appendModelTextDelta(transcript.row, {
              id: input.id,
              turnIndex: transcript.state.turnIndex,
              contentIndex: input.contentIndex,
              markdown: input.text,
              complete: input.complete,
              phase: input.phase,
              timestamp: input.timestamp,
          })
        : upsertModelTextItem(transcript.row, {
              id: input.id,
              turnIndex: transcript.state.turnIndex,
              contentIndex: input.contentIndex,
              markdown: input.text,
              complete: input.complete,
              phase: input.phase,
              timestamp: input.timestamp,
          })
    return replaceTranscript(transcript.state, nextRow, status, input.timestamp)
}

function upsertLiveToolTask(
    state: StreamTurnState,
    task: ToolActivityTask,
    updatedAt: number,
    contentIndex: number | null = null,
): StreamTurnState {
    const ensured = ensureTranscript(state, updatedAt, 'working')
    const transcript = currentTranscript(ensured)
    if (!transcript) return ensured
    const toolCallId = task.id
    return {
        ...replaceTranscript(
            transcript.state,
            upsertToolActivityItem(transcript.row, {
                id: `tool-${toolCallId}`,
                turnIndex: transcript.state.turnIndex,
                contentIndex,
                toolCallId,
                task,
                timestamp: updatedAt,
            }),
            task.status === 'error' ? 'error' : 'working',
            updatedAt,
        ),
        hasToolActivity: true,
    }
}

function setAssistantContentBlocks(
    state: StreamTurnState,
    content: unknown,
    complete: boolean,
    updatedAt: number,
): StreamTurnState {
    const updates = assistantBlocks(content)
    if (updates.length === 0) return state

    let next = state
    const hasToolCall = updates.some((update) => update.part?.type === 'tool_call')
    if (hasToolCall) {
        next = moveCurrentTurnUnknownFinalTextToTranscript({
            ...next,
            hasToolActivity: true,
            currentTurnHasToolCall: true,
        })
    }
    for (const update of updates) {
        if (update.part?.type === 'thinking') {
            if (update.text.length > 0) {
                const transcript = currentTranscript(
                    ensureTranscript(next, updatedAt, 'responding'),
                )
                if (transcript) {
                    next = writeTranscriptText(
                        transcript,
                        {
                            id: liveTextItemId(
                                transcript.state.turnIndex,
                                'thinking',
                                update.contentIndex,
                            ),
                            contentIndex: update.contentIndex,
                            text: update.text,
                            complete: true,
                            phase: 'thinking',
                            timestamp: updatedAt,
                            append: false,
                        },
                        'responding',
                    )
                }
            }
            continue
        }
        if (update.part?.type === 'tool_call') {
            const tasks = toolTasksFromParts([update.part])
            const task = tasks[0] ?? null
            if (task) next = upsertLiveToolTask(next, task, updatedAt, update.contentIndex)
            continue
        }
        if (update.text.trim()) {
            next = setAssistantText(next, update, complete, updatedAt)
        }
    }
    return next
}

function finishStreamTurn(
    state: StreamTurnState,
    status: 'stopped' | 'complete' | 'error',
    runtimeMs: number | null,
    updatedAt: number,
): StreamTurnState {
    const finalStatus = state.status === 'stopped' ? 'stopped' : status
    const transcript = currentTranscript(state)
    const rows = state.rows.map((row, seq): ChatTimelineRow => {
        if (row.type !== 'run_transcript' || row.id !== transcript?.row.id) {
            if (row.type === 'assistant_final') {
                return {
                    ...row,
                    seq,
                    streaming: false,
                }
            }
            return {
                ...row,
                seq,
            }
        }
        const settled = settleTranscriptItems(row, finalStatus)
        return {
            ...settled,
            seq,
            status: finalStatus,
            runtimeMs,
            collapsed: state.rows.some((candidate) => candidate.type === 'assistant_final'),
            timestamp: updatedAt,
        }
    })
    return {
        ...state,
        status: finalStatus,
        rows,
        finished: true,
        updatedAt,
    }
}

function ensureTranscript(
    state: StreamTurnState,
    updatedAt: number,
    status: RunTranscriptStatus,
): StreamTurnState {
    if (state.rows.some((row) => row.type === 'run_transcript')) {
        return updateTranscriptStatus(state, status, updatedAt)
    }
    const runId = state.runId ?? `live-${updatedAt}`
    return {
        ...state,
        runId,
        status,
        rows: [
            createRunTranscriptRow({
                id: `run-transcript-${runId}`,
                seq: 0,
                runId,
                status,
                startedAt: state.startedAt ?? updatedAt,
                runtimeMs: null,
                collapsed: false,
                timestamp: updatedAt,
            }),
            ...state.rows,
        ].map((row, seq) => ({ ...row, seq })),
        startedAt: state.startedAt ?? updatedAt,
        updatedAt,
    }
}

function updateTranscriptStatus(
    state: StreamTurnState,
    status: RunTranscriptStatus,
    updatedAt: number,
): StreamTurnState {
    return {
        ...state,
        status,
        rows: state.rows.map((row, seq): ChatTimelineRow => {
            if (row.type !== 'run_transcript') return { ...row, seq }
            return {
                ...row,
                seq,
                status: row.status === 'error' ? 'error' : status,
                timestamp: updatedAt,
            }
        }),
        updatedAt,
    }
}

function replaceTranscript(
    state: StreamTurnState,
    transcript: RunTranscriptRow,
    status: RunTranscriptStatus,
    updatedAt: number,
): StreamTurnState {
    return {
        ...state,
        status,
        rows: state.rows.map(
            (row, seq): ChatTimelineRow =>
                row.type === 'run_transcript'
                    ? {
                          ...transcript,
                          seq,
                          status: transcript.status === 'error' ? 'error' : status,
                          timestamp: updatedAt,
                      }
                    : {
                          ...row,
                          seq,
                      },
        ),
        updatedAt,
    }
}

function moveCurrentTurnUnknownFinalTextToTranscript(state: StreamTurnState): StreamTurnState {
    let next = state
    const movedIds = new Set<string>()
    for (const row of state.rows) {
        if (row.type !== 'assistant_final') continue
        if (!row.id.startsWith(`stream-final-${state.turnIndex}-`)) continue
        const part = row.message.parts[0]
        if (part?.textPhase !== null) continue
        next = setAssistantText(
            next,
            {
                contentIndex: part.contentIndex,
                text: row.message.text,
                textPhase: null,
            },
            !row.streaming,
            row.timestamp ?? state.updatedAt ?? Date.now(),
        )
        movedIds.add(row.id)
    }
    if (movedIds.size === 0) return next
    return {
        ...next,
        rows: next.rows
            .filter((row) => !movedIds.has(row.id))
            .map((row, seq) => ({
                ...row,
                seq,
            })),
    }
}

function currentTranscript(
    state: StreamTurnState,
): { state: StreamTurnState; row: RunTranscriptRow } | null {
    const row = state.rows.find(
        (candidate): candidate is RunTranscriptRow => candidate.type === 'run_transcript',
    )
    return row ? { state, row } : null
}

function classifyLiveText(
    state: StreamTurnState,
    update: AssistantTextUpdate,
): RoomExecutionMessagePart['textPhase'] | 'commentary' | 'final_answer' {
    if (update.textPhase === 'commentary' || update.textPhase === 'final_answer') {
        return update.textPhase
    }
    if (state.currentTurnHasToolCall) return 'commentary'
    if (state.hasToolActivity) return 'final_answer'
    return 'final_answer'
}

function finalMessage(
    id: string,
    text: string,
    update: AssistantTextUpdate,
    timestamp: number | null,
): RoomExecutionMessage {
    return {
        id,
        role: 'assistant',
        text,
        parts: [
            emptyRuntimePart({
                type: 'text',
                text,
                contentIndex: update.contentIndex,
                textPhase: update.textPhase,
            }),
        ],
        timestamp,
    }
}

function toolTaskFromAssistantToolCall(
    assistantEvent: Record<string, unknown>,
): { task: ToolActivityTask; contentIndex: number | null } | null {
    const contentIndex = contentIndexFromAssistantEvent(assistantEvent)
    const block = toolCallBlockFromEvent(assistantEvent, contentIndex)
    if (!block) return null

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

function assistantBlocks(content: unknown): Array<
    AssistantTextUpdate & {
        part: RoomExecutionMessagePart | null
    }
> {
    if (Array.isArray(content)) {
        const updates: Array<AssistantTextUpdate & { part: RoomExecutionMessagePart | null }> = []
        for (const [contentIndex, block] of content.entries()) {
            if (!isRecord(block)) continue
            if (block.type === 'text') {
                const update = textUpdateFromBlock(block, contentIndex)
                if (update.text.trim()) {
                    updates.push({
                        ...update,
                        part: emptyRuntimePart({
                            type: 'text',
                            text: update.text,
                            contentIndex,
                            textPhase: update.textPhase,
                        }),
                    })
                }
            } else if (block.type === 'thinking') {
                const text = thinkingTextFromBlock(block)
                updates.push({
                    contentIndex,
                    text,
                    textPhase: null,
                    part: emptyRuntimePart({
                        type: 'thinking',
                        text,
                        status: block.redacted === true ? 'redacted' : 'complete',
                        rawType: 'thinking',
                        contentIndex,
                    }),
                })
            } else if (block.type === 'toolCall') {
                updates.push({
                    contentIndex,
                    text: '',
                    textPhase: null,
                    part: emptyRuntimePart({
                        type: 'tool_call',
                        text: typeof block.name === 'string' ? block.name : '',
                        toolName: typeof block.name === 'string' ? block.name : null,
                        toolCallId: typeof block.id === 'string' ? block.id : null,
                        status: 'running',
                        input: toRuntimeSerializable(block.arguments ?? {}),
                        rawType: 'toolCall',
                        contentIndex,
                    }),
                })
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
                  part: emptyRuntimePart({
                      type: 'text',
                      text,
                      contentIndex: null,
                  }),
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

function thinkingTextFromUpdate(
    assistantEvent: Record<string, unknown>,
    contentIndex: number | null,
): string {
    if (assistantEvent.type === 'thinking_delta') {
        return typeof assistantEvent.delta === 'string' ? assistantEvent.delta : ''
    }
    if (typeof assistantEvent.content === 'string') {
        return assistantEvent.content
    }
    const block = assistantBlockFromEvent(assistantEvent, contentIndex)
    return block?.type === 'thinking' ? thinkingTextFromBlock(block) : ''
}

function thinkingTextFromBlock(block: Record<string, unknown>): string {
    return typeof block.thinking === 'string' ? block.thinking : ''
}

function toolCallBlockFromEvent(
    assistantEvent: Record<string, unknown>,
    contentIndex: number | null,
): Record<string, unknown> | null {
    if (isRecord(assistantEvent.toolCall)) return assistantEvent.toolCall
    const block = assistantBlockFromEvent(assistantEvent, contentIndex)
    return block?.type === 'toolCall' ? block : null
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

function payloadRuntimeEvent(payload: unknown): Record<string, unknown> | null {
    if (!isRecord(payload)) return null
    return isRecord(payload.event) ? payload.event : null
}

function liveTextItemId(
    turnIndex: number,
    source: 'thinking' | 'text',
    contentIndex: number | null,
): string {
    return contentIndex === null
        ? `model-text-${turnIndex}-${source}-unknown`
        : `model-text-${turnIndex}-${source}-${contentIndex}`
}

function liveFinalRowId(turnIndex: number, contentIndex: number | null): string {
    return contentIndex === null
        ? `stream-final-${turnIndex}-unknown`
        : `stream-final-${turnIndex}-${contentIndex}`
}

function runStartedAtFromPayload(payload: Record<string, unknown>, fallback: number): number {
    if (typeof payload.startedAtMs === 'number' && Number.isFinite(payload.startedAtMs)) {
        return payload.startedAtMs
    }
    if (typeof payload.startedAt === 'number' && Number.isFinite(payload.startedAt)) {
        return payload.startedAt
    }
    if (typeof payload.startedAt === 'string') {
        const parsed = Date.parse(payload.startedAt)
        if (Number.isFinite(parsed)) return parsed
    }
    return fallback
}

function runErrorMessageFromPayload(payload: Record<string, unknown>): string {
    const detail =
        typeof payload.message === 'string' && payload.message.trim()
            ? payload.message.trim()
            : typeof payload.error === 'string' && payload.error.trim()
              ? payload.error.trim()
              : ''
    return detail ? `Run failed: ${detail}` : 'Run failed before the model returned a response.'
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
