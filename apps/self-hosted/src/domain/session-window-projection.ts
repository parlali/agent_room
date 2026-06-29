import type {
    ChatTimelineRow,
    RoomExecutionMessage,
    RoomSessionArtifact,
    RoomSessionDisplayRow,
    RoomSessionWindow,
} from './room-execution-types'

export const maxSessionWindowRows = 120
const workingStatuses = new Set(['queued', 'running', 'compacting'])

export function isThreadWorking(status: string | null): boolean {
    return status !== null && workingStatuses.has(status)
}

export function finalizeSessionDisplayRows(rows: ChatTimelineRow[]): RoomSessionDisplayRow[] {
    return rows.map((row, seq) => sanitizeDisplayRow(row, seq))
}

export function sliceSessionWindow(input: {
    sessionKey: string
    rows: RoomSessionDisplayRow[]
    artifacts: RoomSessionArtifact[]
    before?: string | null
    after?: string | null
    limitRows: number
}): RoomSessionWindow {
    const limitRows = clampLimit(input.limitRows)
    const totalRows = input.rows.length
    const bounds = rowBounds({
        before: input.before,
        after: input.after,
        limitRows,
        totalRows,
    })
    const rows = input.rows.slice(bounds.start, bounds.end)
    return {
        sessionKey: input.sessionKey,
        rows,
        beforeCursor: bounds.start > 0 ? String(bounds.start) : null,
        afterCursor: rows.length > 0 ? String(rows[rows.length - 1]!.seq) : null,
        hasOlder: bounds.start > 0,
        hasNewer: bounds.end < totalRows,
        totalRows,
        artifacts: input.artifacts,
    }
}

export function sanitizeDisplayRow(row: RoomSessionDisplayRow, seq: number): RoomSessionDisplayRow {
    if (row.type === 'user_message' || row.type === 'assistant_final' || row.type === 'system') {
        return {
            ...row,
            seq,
            message: sanitizeDisplayMessage(row.message),
        }
    }
    return {
        ...row,
        seq,
    }
}

function sanitizeDisplayMessage(message: RoomExecutionMessage): RoomExecutionMessage {
    return {
        ...message,
        parts: message.parts.map((part) => ({
            ...part,
            input: null,
            result: null,
        })),
    }
}

function rowBounds(input: {
    before?: string | null
    after?: string | null
    limitRows: number
    totalRows: number
}): { start: number; end: number } {
    if (input.totalRows === 0) {
        return {
            start: 0,
            end: 0,
        }
    }

    if (input.after) {
        const after = parseCursor(input.after, input.totalRows)
        const start = after === null ? 0 : Math.min(input.totalRows, after + 1)
        return {
            start,
            end: Math.min(input.totalRows, start + input.limitRows),
        }
    }

    const before = input.before ? parseCursor(input.before, input.totalRows) : null
    const end = before === null ? input.totalRows : Math.max(0, Math.min(input.totalRows, before))
    return {
        start: Math.max(0, end - input.limitRows),
        end,
    }
}

function parseCursor(cursor: string, totalRows: number): number | null {
    const value = Number.parseInt(cursor, 10)
    if (!Number.isFinite(value)) return null
    if (value < 0 || value > totalRows) return null
    return value
}

function clampLimit(limitRows: number): number {
    if (!Number.isFinite(limitRows)) return 40
    return Math.max(1, Math.min(maxSessionWindowRows, Math.floor(limitRows)))
}
