import type { ChatTimelineRow, RoomSessionDisplayRow } from '#/domain/room-execution-types'
import { createRunTranscriptRow } from '#/domain/message-list-model'

import { isActiveRunStatus } from './conversation-utils'
import type { StreamTurnState } from './stream-state'

export function buildTimelineRows(
    rows: RoomSessionDisplayRow[],
    stream: StreamTurnState,
    isWorking: boolean,
    sessionKey: string,
    previous: ChatTimelineRow[] = [],
): ChatTimelineRow[] {
    const streamRows = stream.rows
    const persistentMerge =
        streamRows.length > 0
            ? persistedRowsForLiveRun(rows, stream)
            : {
                  before: rows,
                  after: [],
              }
    const fallback =
        isWorking && streamRows.length === 0 && !persistentMerge.before.some(hasActiveTranscript)
            ? [
                  createRunTranscriptRow({
                      id: `run-transcript-pending-${sessionKey}`,
                      seq: persistentMerge.before.length,
                      runId: `pending-${sessionKey}`,
                      status: 'working',
                      startedAt: null,
                      runtimeMs: null,
                      collapsed: false,
                      timestamp: null,
                  }),
              ]
            : []
    const merged = [...persistentMerge.before, ...streamRows, ...persistentMerge.after, ...fallback]
    return reconcileTimelineRows(merged, previous)
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
    const aRecord = a as Record<string, unknown>
    const bRecord = b as Record<string, unknown>
    const aKeys = Object.keys(aRecord)
    if (aKeys.length !== Object.keys(bRecord).length) return false
    for (const key of aKeys) {
        if (aRecord[key] !== bRecord[key]) return false
    }
    return true
}

function persistedRowsForLiveRun(
    rows: RoomSessionDisplayRow[],
    stream: StreamTurnState,
): { before: RoomSessionDisplayRow[]; after: RoomSessionDisplayRow[] } {
    const pendingAnchor = persistedRowsForMatchingPendingRun(rows, stream.runId)
    if (pendingAnchor) return pendingAnchor

    const persistedRunAnchor = persistedRowsForMatchingRun(rows, stream.runId)
    if (persistedRunAnchor) return persistedRunAnchor

    return {
        before: rows.filter((row) => {
            if (row.type === 'run_transcript')
                return row.pending === true || !isActiveRunStatus(row.status)
            return true
        }),
        after: [],
    }
}

function persistedRowsForMatchingPendingRun(
    rows: RoomSessionDisplayRow[],
    runId: string | null,
): { before: RoomSessionDisplayRow[]; after: RoomSessionDisplayRow[] } | null {
    if (!runId) return null
    const pendingRunIndex = rows.findIndex(
        (row) => row.type === 'run_transcript' && row.pending === true && row.runId === runId,
    )
    if (pendingRunIndex < 0) return null
    const userIndex = nearestUserRowIndexBefore(rows, pendingRunIndex)
    if (userIndex < 0) {
        return {
            before: rows.slice(0, pendingRunIndex),
            after: rows.slice(pendingRunIndex + 1),
        }
    }
    return {
        before: rows.slice(0, userIndex + 1),
        after: rows.slice(pendingRunIndex + 1),
    }
}

function persistedRowsForMatchingRun(
    rows: RoomSessionDisplayRow[],
    runId: string | null,
): { before: RoomSessionDisplayRow[]; after: RoomSessionDisplayRow[] } | null {
    if (!runId) return null
    const runIndex = rows.findIndex((row) => row.type === 'run_transcript' && row.runId === runId)
    if (runIndex < 0) return null
    const userIndex = nearestUserRowIndexBefore(rows, runIndex)
    const replacementStart = userIndex < 0 ? runIndex : userIndex + 1
    return {
        before: rows.slice(0, replacementStart),
        after: rows.slice(currentRunReplacementEnd(rows, replacementStart - 1)),
    }
}

function nearestUserRowIndexBefore(rows: RoomSessionDisplayRow[], beforeIndex: number): number {
    for (let index = beforeIndex - 1; index >= 0; index -= 1) {
        if (rows[index]?.type === 'user_message') return index
    }
    return -1
}

function currentRunReplacementEnd(rows: RoomSessionDisplayRow[], userIndex: number): number {
    for (let index = userIndex + 1; index < rows.length; index += 1) {
        const row = rows[index]
        if (!row) return index
        if (row.type === 'user_message' || row.type === 'system') return index
    }
    return rows.length
}

function hasActiveTranscript(row: ChatTimelineRow): boolean {
    return row.type === 'run_transcript' && isActiveRunStatus(row.status)
}
