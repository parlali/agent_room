import type {
    ChatTimelineRow,
    RoomSessionDisplayRow,
    WorkTranscriptItem,
} from '#/domain/room-execution-types'
import { createRunTranscriptRow } from '#/domain/message-list-model'

import { lastUserRowIndex, projectLiveRun, type LiveRun } from './live-run'

export function buildTimelineRows(
    rows: RoomSessionDisplayRow[],
    liveRun: LiveRun | null,
    isWorking: boolean,
    sessionKey: string,
    previous: ChatTimelineRow[] = [],
): ChatTimelineRow[] {
    const merged = liveRun
        ? [...ownedRowsBoundary(rows), ...projectLiveRun(liveRun)]
        : [...rows, ...pendingFallback(rows, isWorking, sessionKey)]
    return reconcileTimelineRows(merged, previous)
}

function ownedRowsBoundary(rows: RoomSessionDisplayRow[]): RoomSessionDisplayRow[] {
    const anchor = lastUserRowIndex(rows)
    if (anchor < 0) return rows
    return rows.slice(0, anchor + 1)
}

function pendingFallback(
    rows: RoomSessionDisplayRow[],
    isWorking: boolean,
    sessionKey: string,
): ChatTimelineRow[] {
    if (!isWorking) return []
    if (rows.some(hasActiveTranscript)) return []
    return [
        createRunTranscriptRow({
            id: `run-transcript-pending-${sessionKey}`,
            seq: rows.length,
            runId: `pending-${sessionKey}`,
            status: 'working',
            startedAt: null,
            runtimeMs: null,
            collapsed: false,
            timestamp: null,
        }),
    ]
}

function reconcileTimelineRows(
    merged: ChatTimelineRow[],
    previous: ChatTimelineRow[],
): ChatTimelineRow[] {
    const previousById = new Map<string, ChatTimelineRow>()
    for (const row of previous) previousById.set(row.id, row)
    return merged.map((row, seq) => {
        const stamped = row.seq === seq ? row : { ...row, seq }
        const prior = previousById.get(stamped.id)
        if (prior && timelineRowsShallowEqual(prior, stamped)) return prior
        return stamped
    })
}

function timelineRowsShallowEqual(a: ChatTimelineRow, b: ChatTimelineRow): boolean {
    if (a === b) return true
    if (a.type !== b.type) return false
    if (a.type === 'run_transcript' && b.type === 'run_transcript') {
        return (
            a.id === b.id &&
            a.seq === b.seq &&
            a.runId === b.runId &&
            a.status === b.status &&
            a.startedAt === b.startedAt &&
            a.runtimeMs === b.runtimeMs &&
            a.collapsed === b.collapsed &&
            a.timestamp === b.timestamp &&
            a.pending === b.pending &&
            transcriptItemsEqual(a.items, b.items)
        )
    }
    if (a.type === 'assistant_final' && b.type === 'assistant_final') {
        return (
            a.id === b.id &&
            a.seq === b.seq &&
            a.streaming === b.streaming &&
            a.timestamp === b.timestamp &&
            a.message.id === b.message.id &&
            a.message.text === b.message.text
        )
    }
    const aRecord = a as Record<string, unknown>
    const bRecord = b as Record<string, unknown>
    const aKeys = Object.keys(aRecord)
    if (aKeys.length !== Object.keys(bRecord).length) return false
    for (const key of aKeys) {
        if (aRecord[key] !== bRecord[key]) return false
    }
    return true
}

function transcriptItemsEqual(a: WorkTranscriptItem[], b: WorkTranscriptItem[]): boolean {
    if (a === b) return true
    if (a.length !== b.length) return false
    for (let index = 0; index < a.length; index += 1) {
        const left = a[index] as unknown as Record<string, unknown>
        const right = b[index] as unknown as Record<string, unknown>
        if (left === right) continue
        const keys = Object.keys(left)
        if (keys.length !== Object.keys(right).length) return false
        for (const key of keys) {
            if (left[key] !== right[key]) return false
        }
    }
    return true
}

function hasActiveTranscript(row: ChatTimelineRow): boolean {
    if (row.type !== 'run_transcript') return false
    return (
        row.status === 'queued' ||
        row.status === 'thinking' ||
        row.status === 'working' ||
        row.status === 'responding'
    )
}
