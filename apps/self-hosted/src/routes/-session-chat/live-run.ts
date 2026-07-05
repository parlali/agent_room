import {
    emptyRuntimePart,
    extractTextFromRuntimeContent,
    runtimeTextPhaseFromSignature,
    toRuntimeSerializable,
} from '#/domain/runtime-message'
import type {
    ChatTimelineRow,
    RoomExecutionMessage,
    RoomRealtimeEvent,
    RunTranscriptRow,
    RunTranscriptStatus,
    WorkTranscriptItem,
} from '#/domain/room-execution-types'
import {
    toolTaskFromRuntimeEvent,
    toolTasksFromParts,
    type ToolActivityTask,
} from '#/domain/tool-activity'

export type LiveRunOutcome = 'complete' | 'stopped' | 'error'

export type LiveRunActivity = 'queued' | 'thinking' | 'working' | 'responding'

export type LiveSegment =
    | {
          kind: 'thinking'
          id: string
          turnIndex: number
          text: string
          done: boolean
          timestamp: number
      }
    | {
          kind: 'text'
          id: string
          turnIndex: number
          text: string
          phase: 'commentary' | 'final_answer' | null
          done: boolean
          timestamp: number
      }
    | {
          kind: 'tool'
          id: string
          turnIndex: number
          toolCallId: string
          task: ToolActivityTask
          timestamp: number
      }

export interface LiveRun {
    runId: string
    activity: LiveRunActivity
    outcome: LiveRunOutcome | null
    startedAt: number
    runtimeMs: number | null
    updatedAt: number
    turnIndex: number
    segments: LiveSegment[]
    errorText: string | null
}

export function liveRunFinished(run: LiveRun | null): run is LiveRun & {
    outcome: LiveRunOutcome
} {
    return run !== null && run.outcome !== null
}

export function liveRunActive(run: LiveRun | null): run is LiveRun {
    return run !== null && run.outcome === null
}

export function isFabricatedRunId(runId: string): boolean {
    return runId.startsWith('live-')
}

export function adoptLiveRunId(run: LiveRun | null, runId: string): LiveRun | null {
    if (!run) return null
    if (!runId.trim()) return run
    if (run.outcome !== null) return run
    if (run.runId === runId) return run
    if (!isFabricatedRunId(run.runId)) return run
    return {
        ...run,
        runId,
    }
}

export function reduceLiveRunEvent(
    run: LiveRun | null,
    realtime: RoomRealtimeEvent,
): LiveRun | null {
    if (realtime.event === 'run.accepted') {
        const payload = record(realtime.payload)
        const runId =
            typeof payload.runId === 'string' && payload.runId.trim()
                ? payload.runId
                : `live-${realtime.receivedAt}`
        return {
            runId,
            activity: 'queued',
            outcome: null,
            startedAt: startedAtFromPayload(payload, realtime.receivedAt),
            runtimeMs: null,
            updatedAt: realtime.receivedAt,
            turnIndex: 0,
            segments: [],
            errorText: null,
        }
    }

    if (run && run.outcome !== null) return run

    if (realtime.event === 'run.finished' || realtime.event === 'agent_end') {
        if (!run) return null
        const payload = record(realtime.payload)
        const errored = typeof payload.error === 'string' && payload.error.trim().length > 0
        return finishLiveRun(
            run,
            errored ? 'error' : 'complete',
            realtime.receivedAt,
            durationFromPayload(payload),
        )
    }

    if (realtime.event === 'run.error') {
        const payload = record(realtime.payload)
        const base = run ?? implicitLiveRun(payload, realtime.receivedAt)
        const message = runErrorMessage(payload)
        const withError: LiveRun = {
            ...base,
            errorText: message,
            segments: upsertSegment(base.segments, {
                kind: 'text',
                id: `run-error-${base.runId}`,
                turnIndex: base.turnIndex,
                text: message,
                phase: 'commentary',
                done: true,
                timestamp: realtime.receivedAt,
            }),
        }
        return finishLiveRun(withError, 'error', realtime.receivedAt, durationFromPayload(payload))
    }

    const event = runtimeEventFromPayload(realtime.payload)
    if (!event) return run

    const base = run ?? implicitLiveRun(record(realtime.payload), realtime.receivedAt)

    if (event.type === 'agent_start' || event.type === 'turn_start') {
        return touch(base, 'thinking', realtime.receivedAt)
    }

    if (event.type === 'message_update') {
        return reduceMessageUpdate(base, event, realtime.receivedAt)
    }

    if (event.type === 'message_end' || event.type === 'turn_end') {
        const message = record(event.message)
        const next =
            message.role === 'assistant'
                ? applyAssistantContent(base, message.content, realtime.receivedAt)
                : base
        if (event.type === 'turn_end') {
            return touch(
                {
                    ...next,
                    turnIndex: next.turnIndex + 1,
                },
                next.activity,
                realtime.receivedAt,
            )
        }
        return next
    }

    if (
        event.type === 'tool_execution_start' ||
        event.type === 'tool_execution_update' ||
        event.type === 'tool_execution_end'
    ) {
        const task = toolTaskFromRuntimeEvent(event)
        if (!task) return base
        return upsertToolSegment(base, task, realtime.receivedAt)
    }

    return base
}

export function finishLiveRun(
    run: LiveRun,
    outcome: LiveRunOutcome,
    finishedAt: number,
    durationMs: number | null = null,
): LiveRun {
    if (run.outcome !== null) return run
    const runtimeMs = durationMs ?? Math.max(0, finishedAt - run.startedAt)
    return {
        ...run,
        outcome,
        runtimeMs,
        updatedAt: finishedAt,
        segments: run.segments.map((segment): LiveSegment => {
            if (segment.kind === 'tool') {
                if (segment.task.status === 'pending' || segment.task.status === 'in_progress') {
                    return {
                        ...segment,
                        task: {
                            ...segment.task,
                            status: outcome === 'complete' ? 'complete' : 'stopped',
                        },
                    }
                }
                return segment
            }
            return segment.done ? segment : { ...segment, done: true }
        }),
    }
}

export function liveRunHasContent(run: LiveRun | null): boolean {
    if (!run) return false
    return run.segments.some((segment) => {
        if (segment.kind === 'tool') return true
        return segment.text.trim().length > 0
    })
}

export function projectLiveRun(run: LiveRun): ChatTimelineRow[] {
    const answerIds = answerSegmentIds(run)
    const items: WorkTranscriptItem[] = []
    let answerText = ''
    let answerDone = true
    let answerTimestamp = run.updatedAt
    for (const segment of run.segments) {
        if (segment.kind === 'tool') {
            items.push({
                type: 'tool_activity',
                id: `live-item-${segment.id}`,
                turnIndex: segment.turnIndex,
                contentIndex: null,
                toolCallId: segment.toolCallId,
                task: segment.task,
                timestamp: segment.timestamp,
            })
            continue
        }
        if (segment.kind === 'text' && answerIds.has(segment.id)) {
            answerText += segment.text
            answerDone = segment.done
            answerTimestamp = segment.timestamp
            continue
        }
        if (segment.text.trim().length === 0) continue
        items.push({
            type: 'model_text',
            id: `live-item-${segment.id}`,
            turnIndex: segment.turnIndex,
            contentIndex: null,
            markdown: segment.text,
            complete: segment.done,
            phase:
                segment.kind === 'thinking'
                    ? 'thinking'
                    : segment.phase === 'commentary'
                      ? 'commentary'
                      : 'unknown',
            timestamp: segment.timestamp,
        })
    }
    const hasAnswer = answerText.trim().length > 0
    const finished = run.outcome !== null
    const transcript: RunTranscriptRow = {
        type: 'run_transcript',
        id: `run-transcript-${run.runId}`,
        seq: 0,
        runId: run.runId,
        status: transcriptStatus(run),
        startedAt: run.startedAt,
        runtimeMs: run.runtimeMs,
        collapsed: hasAnswer || finished,
        items,
        timestamp: run.updatedAt,
    }
    if (!hasAnswer) return [transcript]
    const answer: ChatTimelineRow = {
        type: 'assistant_final',
        id: `live-final-${run.runId}`,
        seq: 1,
        message: answerMessage(run.runId, answerText, answerTimestamp),
        streaming: !finished && !answerDone,
        timestamp: answerTimestamp,
    }
    return [transcript, answer]
}

export function shouldRefetchForRoomEvent(realtime: RoomRealtimeEvent): boolean {
    return (
        realtime.event === 'run.finished' ||
        realtime.event === 'run.error' ||
        realtime.event === 'agent_end' ||
        realtime.event === 'thread.message_edited' ||
        realtime.event === 'thread.renamed' ||
        realtime.event === 'thread.title_generated' ||
        realtime.event === 'thread.forked' ||
        realtime.event === 'thread.deleted' ||
        realtime.event === 'thread.model_changed' ||
        realtime.event === 'room.files.changed' ||
        realtime.event === 'browser.session_changed'
    )
}

export function persistedRunSettled(rows: ChatTimelineRow[], run: LiveRun): boolean {
    const anchor = lastUserRowIndex(rows)
    if (anchor < 0) return false
    let sawSettledRun = false
    let sawFinalContent = false
    for (let index = anchor + 1; index < rows.length; index += 1) {
        const row = rows[index]!
        if (row.type === 'run_transcript') {
            if (row.pending === true) continue
            if (!isActiveTranscriptStatus(row.status)) sawSettledRun = true
            continue
        }
        if (row.type === 'assistant_final') {
            sawFinalContent = row.message.text.trim().length > 0
        }
    }
    if (liveRunHasFinalAnswer(run)) return sawFinalContent
    return sawSettledRun || sawFinalContent
}

export function lastUserRowIndex(rows: ChatTimelineRow[]): number {
    for (let index = rows.length - 1; index >= 0; index -= 1) {
        if (rows[index]!.type === 'user_message') return index
    }
    return -1
}

function liveRunHasFinalAnswer(run: LiveRun): boolean {
    const answerIds = answerSegmentIds(run)
    if (answerIds.size === 0) return false
    return run.segments.some(
        (segment) =>
            segment.kind === 'text' && answerIds.has(segment.id) && segment.text.trim().length > 0,
    )
}

function transcriptStatus(run: LiveRun): RunTranscriptStatus {
    if (run.outcome !== null) return run.outcome
    return run.activity
}

function isActiveTranscriptStatus(status: RunTranscriptStatus): boolean {
    return (
        status === 'queued' ||
        status === 'thinking' ||
        status === 'working' ||
        status === 'responding'
    )
}

function answerSegmentIds(run: LiveRun): Set<string> {
    const ids = new Set<string>()
    let trailing = true
    for (let index = run.segments.length - 1; index >= 0; index -= 1) {
        const segment = run.segments[index]!
        if (segment.turnIndex !== run.turnIndex && run.outcome === null) {
            if (segment.kind === 'text' && segment.phase === 'final_answer') ids.add(segment.id)
            continue
        }
        if (segment.kind === 'text') {
            if (segment.phase === 'final_answer') {
                ids.add(segment.id)
                continue
            }
            if (trailing && segment.phase !== 'commentary') {
                ids.add(segment.id)
            }
            continue
        }
        trailing = false
    }
    return ids
}

function reduceMessageUpdate(
    run: LiveRun,
    event: Record<string, unknown>,
    receivedAt: number,
): LiveRun {
    const assistantEvent = record(event.assistantMessageEvent)
    if (Object.keys(assistantEvent).length === 0) return run

    if (
        assistantEvent.type === 'thinking_start' ||
        assistantEvent.type === 'thinking_delta' ||
        assistantEvent.type === 'thinking_end'
    ) {
        const contentIndex = contentIndexOf(assistantEvent)
        const id = segmentId(run.turnIndex, 'thinking', contentIndex)
        const existing = run.segments.find(
            (segment): segment is LiveSegment & { kind: 'thinking' } =>
                segment.kind === 'thinking' && segment.id === id,
        )
        if (assistantEvent.type === 'thinking_delta') {
            const delta = typeof assistantEvent.delta === 'string' ? assistantEvent.delta : ''
            return withSegment(
                run,
                {
                    kind: 'thinking',
                    id,
                    turnIndex: run.turnIndex,
                    text: `${existing?.text ?? ''}${delta}`,
                    done: false,
                    timestamp: receivedAt,
                },
                'thinking',
                receivedAt,
            )
        }
        const text = thinkingText(assistantEvent, contentIndex)
        return withSegment(
            run,
            {
                kind: 'thinking',
                id,
                turnIndex: run.turnIndex,
                text: text.length > 0 ? text : (existing?.text ?? ''),
                done: assistantEvent.type === 'thinking_end',
                timestamp: receivedAt,
            },
            'thinking',
            receivedAt,
        )
    }

    if (
        assistantEvent.type === 'toolcall_start' ||
        assistantEvent.type === 'toolcall_delta' ||
        assistantEvent.type === 'toolcall_end'
    ) {
        const contentIndex = contentIndexOf(assistantEvent)
        const block = toolCallBlock(assistantEvent, contentIndex)
        if (!block) return touch(run, 'working', receivedAt)
        const task = toolTaskFromBlock(block, contentIndex)
        if (!task) return touch(run, 'working', receivedAt)
        return upsertToolSegment(run, task, receivedAt)
    }

    if (
        assistantEvent.type !== 'text_start' &&
        assistantEvent.type !== 'text_delta' &&
        assistantEvent.type !== 'text_end'
    ) {
        return run
    }

    const contentIndex = contentIndexOf(assistantEvent)
    const id = segmentId(run.turnIndex, 'text', contentIndex)
    const existing = run.segments.find(
        (segment): segment is LiveSegment & { kind: 'text' } =>
            segment.kind === 'text' && segment.id === id,
    )
    const update = textUpdate(event, assistantEvent, contentIndex)

    if (assistantEvent.type === 'text_delta' && !update.text) {
        const delta = typeof assistantEvent.delta === 'string' ? assistantEvent.delta : ''
        if (!delta) return touch(run, 'responding', receivedAt)
        return withSegment(
            run,
            {
                kind: 'text',
                id,
                turnIndex: run.turnIndex,
                text: `${existing?.text ?? ''}${delta}`,
                phase: update.phase ?? existing?.phase ?? null,
                done: false,
                timestamp: receivedAt,
            },
            'responding',
            receivedAt,
        )
    }

    if (!update.text) return touch(run, 'responding', receivedAt)

    return withSegment(
        run,
        {
            kind: 'text',
            id,
            turnIndex: run.turnIndex,
            text: update.text,
            phase: update.phase ?? existing?.phase ?? null,
            done: assistantEvent.type === 'text_end',
            timestamp: receivedAt,
        },
        'responding',
        receivedAt,
    )
}

function applyAssistantContent(run: LiveRun, content: unknown, receivedAt: number): LiveRun {
    if (!Array.isArray(content)) {
        const text = extractTextFromRuntimeContent(content)
        if (!text.trim()) return run
        return withSegment(
            run,
            {
                kind: 'text',
                id: segmentId(run.turnIndex, 'text', null),
                turnIndex: run.turnIndex,
                text,
                phase: null,
                done: true,
                timestamp: receivedAt,
            },
            run.activity,
            receivedAt,
        )
    }
    let next = run
    for (const [contentIndex, blockValue] of content.entries()) {
        const block = record(blockValue)
        if (block.type === 'text') {
            const text = extractTextFromRuntimeContent(block)
            if (!text.trim()) continue
            next = withSegment(
                next,
                {
                    kind: 'text',
                    id: segmentId(next.turnIndex, 'text', contentIndex),
                    turnIndex: next.turnIndex,
                    text,
                    phase: runtimeTextPhaseFromSignature(block.textSignature),
                    done: true,
                    timestamp: receivedAt,
                },
                next.activity,
                receivedAt,
            )
        } else if (block.type === 'thinking') {
            const text = typeof block.thinking === 'string' ? block.thinking : ''
            if (!text) continue
            next = withSegment(
                next,
                {
                    kind: 'thinking',
                    id: segmentId(next.turnIndex, 'thinking', contentIndex),
                    turnIndex: next.turnIndex,
                    text,
                    done: true,
                    timestamp: receivedAt,
                },
                next.activity,
                receivedAt,
            )
        } else if (block.type === 'toolCall') {
            const task = toolTaskFromBlock(block, contentIndex)
            if (task) next = upsertToolSegment(next, task, receivedAt)
        }
    }
    return next
}

function upsertToolSegment(run: LiveRun, task: ToolActivityTask, receivedAt: number): LiveRun {
    return withSegment(
        run,
        {
            kind: 'tool',
            id: `tool-${task.id}`,
            turnIndex: run.turnIndex,
            toolCallId: task.id,
            task,
            timestamp: receivedAt,
        },
        task.status === 'error' ? run.activity : 'working',
        receivedAt,
    )
}

function withSegment(
    run: LiveRun,
    segment: LiveSegment,
    activity: LiveRunActivity,
    receivedAt: number,
): LiveRun {
    return {
        ...run,
        activity,
        updatedAt: receivedAt,
        segments: upsertSegment(run.segments, segment),
    }
}

function upsertSegment(segments: LiveSegment[], segment: LiveSegment): LiveSegment[] {
    const index = segments.findIndex((candidate) => candidate.id === segment.id)
    if (index < 0) return [...segments, segment]
    const next = [...segments]
    next[index] = segment
    return next
}

function touch(run: LiveRun, activity: LiveRunActivity, receivedAt: number): LiveRun {
    if (run.activity === activity && run.updatedAt === receivedAt) return run
    return {
        ...run,
        activity,
        updatedAt: receivedAt,
    }
}

function implicitLiveRun(payload: Record<string, unknown>, receivedAt: number): LiveRun {
    const runId =
        typeof payload.runId === 'string' && payload.runId.trim()
            ? payload.runId
            : `live-${receivedAt}`
    return {
        runId,
        activity: 'thinking',
        outcome: null,
        startedAt: startedAtFromPayload(payload, receivedAt),
        runtimeMs: null,
        updatedAt: receivedAt,
        turnIndex: 0,
        segments: [],
        errorText: null,
    }
}

function toolTaskFromBlock(
    block: Record<string, unknown>,
    contentIndex: number | null,
): ToolActivityTask | null {
    const tasks = toolTasksFromParts([
        emptyRuntimePart({
            type: 'tool_call',
            text: typeof block.name === 'string' ? block.name : '',
            toolName: typeof block.name === 'string' ? block.name : null,
            toolCallId: typeof block.id === 'string' ? block.id : null,
            status: typeof block.status === 'string' ? block.status : 'running',
            input: toRuntimeSerializable(block.arguments ?? {}),
            rawType: 'toolCall',
            contentIndex,
        }),
    ])
    return tasks[0] ?? null
}

function textUpdate(
    event: Record<string, unknown>,
    assistantEvent: Record<string, unknown>,
    contentIndex: number | null,
): { text: string; phase: 'commentary' | 'final_answer' | null } {
    if (typeof assistantEvent.content === 'string') {
        return { text: assistantEvent.content, phase: null }
    }
    const block = assistantBlock(assistantEvent, contentIndex) ?? messageBlock(event, contentIndex)
    if (!block) return { text: '', phase: null }
    return {
        text: extractTextFromRuntimeContent(block),
        phase: runtimeTextPhaseFromSignature(block.textSignature),
    }
}

function thinkingText(
    assistantEvent: Record<string, unknown>,
    contentIndex: number | null,
): string {
    if (typeof assistantEvent.content === 'string') return assistantEvent.content
    const block = assistantBlock(assistantEvent, contentIndex)
    if (block?.type !== 'thinking') return ''
    return typeof block.thinking === 'string' ? block.thinking : ''
}

function toolCallBlock(
    assistantEvent: Record<string, unknown>,
    contentIndex: number | null,
): Record<string, unknown> | null {
    if (isRecord(assistantEvent.toolCall)) return assistantEvent.toolCall
    const block = assistantBlock(assistantEvent, contentIndex)
    return block?.type === 'toolCall' ? block : null
}

function assistantBlock(
    assistantEvent: Record<string, unknown>,
    contentIndex: number | null,
): Record<string, unknown> | null {
    const partial = record(assistantEvent.partial)
    if (partial.role !== 'assistant') return null
    return blockAt(partial.content, contentIndex)
}

function messageBlock(
    event: Record<string, unknown>,
    contentIndex: number | null,
): Record<string, unknown> | null {
    const message = record(event.message)
    if (message.role !== 'assistant') return null
    return blockAt(message.content, contentIndex)
}

function blockAt(content: unknown, contentIndex: number | null): Record<string, unknown> | null {
    if (!Array.isArray(content) || contentIndex === null) return null
    const block = content[contentIndex]
    return isRecord(block) ? block : null
}

function contentIndexOf(assistantEvent: Record<string, unknown>): number | null {
    return typeof assistantEvent.contentIndex === 'number' &&
        Number.isInteger(assistantEvent.contentIndex) &&
        assistantEvent.contentIndex >= 0
        ? assistantEvent.contentIndex
        : null
}

function segmentId(
    turnIndex: number,
    kind: 'thinking' | 'text',
    contentIndex: number | null,
): string {
    return `${kind}-${turnIndex}-${contentIndex ?? 'stream'}`
}

function runtimeEventFromPayload(payload: unknown): Record<string, unknown> | null {
    if (!isRecord(payload)) return null
    return isRecord(payload.event) ? payload.event : null
}

function startedAtFromPayload(payload: Record<string, unknown>, fallback: number): number {
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

function durationFromPayload(payload: Record<string, unknown>): number | null {
    return typeof payload.durationMs === 'number' && Number.isFinite(payload.durationMs)
        ? payload.durationMs
        : null
}

function runErrorMessage(payload: Record<string, unknown>): string {
    const detail =
        typeof payload.message === 'string' && payload.message.trim()
            ? payload.message.trim()
            : typeof payload.error === 'string' && payload.error.trim()
              ? payload.error.trim()
              : ''
    return detail ? `Run failed: ${detail}` : 'Run failed before the model returned a response.'
}

function answerMessage(runId: string, text: string, timestamp: number): RoomExecutionMessage {
    return {
        id: `live-final-${runId}`,
        role: 'assistant',
        text,
        parts: [
            emptyRuntimePart({
                type: 'text',
                text,
                contentIndex: null,
                textPhase: null,
            }),
        ],
        timestamp,
    }
}

function record(value: unknown): Record<string, unknown> {
    return isRecord(value) ? value : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
