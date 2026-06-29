import type { InfiniteData } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import { createPendingUserDisplayRows } from '#/domain/message-list-model'
import { emptyRuntimePart } from '#/domain/runtime-message'
import type {
    RoomSessionDisplayRow,
    RoomSessionWindow,
} from '#/domain/room-execution-types'

import { preserveUnsettledPendingUserRows } from './chat-projection-store'

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
