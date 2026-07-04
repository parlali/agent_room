import type { InfiniteData } from '@tanstack/react-query'
import { beforeEach, describe, expect, it } from 'vitest'

import { createPendingUserDisplayRows } from '#/domain/message-list-model'
import { emptyRuntimePart } from '#/domain/runtime-message'
import type { RoomSessionDisplayRow, RoomSessionWindow } from '#/domain/room-execution-types'

import {
    forgetPendingUserRowsForSession,
    isPendingRunStale,
    markStalePendingRunRows,
    pendingRunStaleThresholdMs,
    preserveUnsettledPendingUserRows,
    rememberPendingUserRow,
} from './chat-projection-store'

beforeEach(() => {
    forgetPendingUserRowsForSession('session-1')
})

type Window = InfiniteData<RoomSessionWindow, string | null>

function windowOf(rows: RoomSessionDisplayRow[]): Window {
    return {
        pages: [
            {
                sessionKey: 'session-1',
                rows,
                beforeCursor: null,
                afterCursor: null,
                hasOlder: false,
                hasNewer: false,
                totalRows: rows.length,
                artifacts: [],
            },
        ],
        pageParams: [null],
    }
}

function pendingUserRow(runId: string, text: string): RoomSessionDisplayRow {
    const [userRow] = createPendingUserDisplayRows({
        messageId: runId,
        runId,
        text,
        queuedAt: 1000,
        startSeq: 1000,
    })
    return userRow
}

function pendingRunRow(runId: string, queuedAt: number): RoomSessionDisplayRow {
    const [, runRow] = createPendingUserDisplayRows({
        messageId: runId,
        runId,
        text: 'pending',
        queuedAt,
        startSeq: queuedAt,
    })
    return runRow
}

function settledUserRow(id: string, text: string): RoomSessionDisplayRow {
    return {
        type: 'user_message',
        id,
        seq: 0,
        message: {
            id,
            role: 'user',
            text,
            parts: [emptyRuntimePart({ type: 'text', text })],
            timestamp: 2000,
        },
        timestamp: 2000,
    }
}

describe('preserveUnsettledPendingUserRows', () => {
    it('carries a queued pending user row forward when a refetch drops it', () => {
        const oldData = windowOf([
            settledUserRow('msg-prior', 'stays'),
            pendingUserRow('run-persist', 'persist'),
        ])
        const refetched = windowOf([settledUserRow('msg-prior', 'stays')])

        const merged = preserveUnsettledPendingUserRows(oldData, refetched)
        const rows = merged.pages[0]!.rows

        expect(rows.map((row) => row.id)).toEqual(['msg-prior', 'pending-user-run-persist'])
        expect(merged.pages[0]!.totalRows).toBe(2)
    })

    it('drops the pending user row once the window persists the real message', () => {
        const oldData = windowOf([pendingUserRow('run-persist', 'persist')])
        const refetched = windowOf([settledUserRow('msg-persist', 'persist')])

        const merged = preserveUnsettledPendingUserRows(oldData, refetched)

        expect(merged).toBe(refetched)
        expect(merged.pages[0]!.rows.map((row) => row.id)).toEqual(['msg-persist'])
    })

    it('returns the refetched window unchanged when there are no pending user rows', () => {
        const oldData = windowOf([settledUserRow('msg-prior', 'stays')])
        const refetched = windowOf([settledUserRow('msg-prior', 'stays')])

        expect(preserveUnsettledPendingUserRows(oldData, refetched)).toBe(refetched)
    })

    it('keeps a promoted pending user row after the query cache is evicted on remount', () => {
        rememberPendingUserRow('session-1', pendingUserRow('run-remount', 'survive'))
        const refetched = windowOf([settledUserRow('msg-prior', 'stays')])

        const merged = preserveUnsettledPendingUserRows(undefined, refetched)

        expect(merged.pages[0]!.rows.map((row) => row.id)).toEqual([
            'msg-prior',
            'pending-user-run-remount',
        ])
    })

    it('prunes the durable pending row once the server confirms the message', () => {
        rememberPendingUserRow('session-1', pendingUserRow('run-remount', 'survive'))
        const refetched = windowOf([settledUserRow('msg-remount', 'survive')])

        const merged = preserveUnsettledPendingUserRows(undefined, refetched)
        expect(merged).toBe(refetched)

        const again = preserveUnsettledPendingUserRows(
            undefined,
            windowOf([settledUserRow('msg-prior', 'stays')]),
        )
        expect(again.pages[0]!.rows.map((row) => row.id)).toEqual(['msg-prior'])
    })

    it('ignores transient optimistic rows that were not promoted to a run', () => {
        const optimistic: RoomSessionDisplayRow = {
            type: 'user_message',
            id: 'optimistic-session-1-1000',
            seq: 1000,
            message: {
                id: 'optimistic-session-1-1000',
                role: 'user',
                text: 'persist',
                parts: [emptyRuntimePart({ type: 'text', text: 'persist' })],
                timestamp: 1000,
            },
            timestamp: 1000,
            pending: true,
        }
        const oldData = windowOf([optimistic])
        const refetched = windowOf([settledUserRow('msg-prior', 'stays')])

        expect(preserveUnsettledPendingUserRows(oldData, refetched)).toBe(refetched)
    })
})

describe('isPendingRunStale', () => {
    const now = 10 * 60_000

    it('flags a working run with no activity past the staleness threshold', () => {
        const rows = [pendingRunRow('run-stale', now - pendingRunStaleThresholdMs - 1000)]
        expect(isPendingRunStale({ rows, liveRun: null, isWorking: true, now })).toBe(true)
    })

    it('does not flag a run that is still within the staleness window', () => {
        const rows = [pendingRunRow('run-fresh', now - 1000)]
        expect(isPendingRunStale({ rows, liveRun: null, isWorking: true, now })).toBe(false)
    })

    it('does not flag when the session is not working', () => {
        const rows = [pendingRunRow('run-idle', now - pendingRunStaleThresholdMs - 1000)]
        expect(isPendingRunStale({ rows, liveRun: null, isWorking: false, now })).toBe(false)
    })
})

describe('markStalePendingRunRows', () => {
    it('converts an active pending run transcript into a terminal error row', () => {
        const rows = [pendingRunRow('run-x', 1000)]
        const marked = markStalePendingRunRows(rows)
        expect(marked[0]).toMatchObject({
            type: 'run_transcript',
            status: 'error',
            pending: false,
        })
    })

    it('returns the same array when there is nothing active to mark', () => {
        const rows = [settledUserRow('msg-prior', 'stays')]
        expect(markStalePendingRunRows(rows)).toBe(rows)
    })
})
