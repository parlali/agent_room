import { existsSync, statSync } from 'node:fs'
import type { SessionEntry } from '@mariozechner/pi-coding-agent'
import { buildChatTimelineRows } from '#/lib/message-list-model'
import { emptyRuntimePart } from '#/lib/runtime-message'
import type {
    ChatTimelineRow,
    RoomExecutionMessage,
    RoomExecutionThread,
    RoomSessionDisplayRow,
    RoomSessionWindow,
    RoomSessionArtifact,
} from '../rooms/execution-types'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import {
    jsonPayloadByteLength,
    logPerformanceEvent,
    performanceNow,
    elapsedPerformanceMs,
} from '../telemetry/performance'
import { extractSessionArtifacts } from './session-artifacts'
import { completedToolCallIds, mapSessionEntry } from './session-entry-mapper'
import { promptAttachmentMetadataByEntryId } from './prompt-attachments'
import type { PendingUserMessageRecord, ThreadRecord } from './thread-records'

interface SessionDisplayIndex {
    rows: RoomSessionDisplayRow[]
    artifacts: RoomSessionArtifact[]
}

interface CachedSessionDisplayIndex {
    cacheKey: string
    index: SessionDisplayIndex
}

interface SessionWindowStoreInput {
    config: PiRuntimeConfig
    readThreadEntries: (record: ThreadRecord) => SessionEntry[]
}

interface SessionWindowInput {
    record: ThreadRecord
    thread: RoomExecutionThread
    limitRows: number
    before?: string | null
    after?: string | null
}

const maxWindowRows = 120
const workingStatuses = new Set(['queued', 'running', 'compacting'])

export function createSessionWindowStore(input: SessionWindowStoreInput) {
    const cache = new Map<string, CachedSessionDisplayIndex>()

    function readIndex(record: ThreadRecord, thread: RoomExecutionThread): SessionDisplayIndex {
        const startedAt = performanceNow()
        const cacheKey = displayCacheKey(record)
        const cached = cache.get(record.key)
        if (cached?.cacheKey === cacheKey) {
            logPerformanceEvent('chat.window.index', {
                sessionKey: record.key,
                status: 'cache_hit',
                durationMs: elapsedPerformanceMs(startedAt),
                rowCount: cached.index.rows.length,
                artifactCount: cached.index.artifacts.length,
            })
            return cached.index
        }

        const entries = input.readThreadEntries(record)
        const index = buildSessionDisplayIndex({
            config: input.config,
            record,
            thread,
            entries,
        })
        cache.set(record.key, {
            cacheKey,
            index,
        })
        logPerformanceEvent('chat.window.index', {
            sessionKey: record.key,
            status: 'rebuilt',
            durationMs: elapsedPerformanceMs(startedAt),
            entryCount: entries.length,
            rowCount: index.rows.length,
            artifactCount: index.artifacts.length,
        })
        return index
    }

    return {
        window(inputWindow: SessionWindowInput): RoomSessionWindow {
            const startedAt = performanceNow()
            const limitRows = clampLimit(inputWindow.limitRows)
            const index = readIndex(inputWindow.record, inputWindow.thread)
            const totalRows = index.rows.length
            const bounds = rowBounds({
                before: inputWindow.before,
                after: inputWindow.after,
                limitRows,
                totalRows,
            })
            const rows = index.rows.slice(bounds.start, bounds.end)
            const payload: RoomSessionWindow = {
                sessionKey: inputWindow.record.key,
                rows,
                beforeCursor: bounds.start > 0 ? String(bounds.start) : null,
                afterCursor: rows.length > 0 ? String(rows[rows.length - 1]!.seq) : null,
                hasOlder: bounds.start > 0,
                hasNewer: bounds.end < totalRows,
                totalRows,
                artifacts: index.artifacts,
            }
            logPerformanceEvent('chat.window.load', {
                sessionKey: inputWindow.record.key,
                durationMs: elapsedPerformanceMs(startedAt),
                rowCount: rows.length,
                totalRows,
                hasOlder: payload.hasOlder,
                hasNewer: payload.hasNewer,
                payloadBytes: jsonPayloadByteLength(payload),
            })
            return payload
        },
        clear(recordKey: string): void {
            cache.delete(recordKey)
        },
    }
}

/**
 * Builds the complete display index for a session thread, producing ordered sanitized timeline rows and extracted artifacts.
 *
 * The result includes pending queued user messages (and their associated run transcript rows) appended to the timeline, with each row sanitized and assigned a stable sequence number.
 *
 * @param config - Runtime configuration used when extracting artifacts
 * @param record - Thread record containing session metadata and any pending user messages
 * @param thread - Execution thread context for the session
 * @param entries - Raw session entries to be mapped into timeline messages
 * @returns An object with `rows`: the ordered, sanitized display rows with assigned `seq` values, and `artifacts`: artifacts extracted from the provided entries
 */
function buildSessionDisplayIndex(input: {
    config: PiRuntimeConfig
    record: ThreadRecord
    thread: RoomExecutionThread
    entries: SessionEntry[]
}): SessionDisplayIndex {
    const completed = completedToolCallIds(input.entries)
    const attachmentMetadata = promptAttachmentMetadataByEntryId(input.entries)
    const messages = input.entries
        .map((entry, index) => mapSessionEntry(entry, index, completed, attachmentMetadata))
        .filter((message): message is RoomExecutionMessage => message !== null)
    const rows = buildChatTimelineRows(
        messages,
        workingStatuses.has(input.record.status),
        input.thread,
    )
    const displayRows = appendPendingUserRows(rows, input.record).map((row, seq) =>
        sanitizeDisplayRow(row, seq),
    )
    return {
        rows: displayRows,
        artifacts: extractSessionArtifacts(input.config, input.entries),
    }
}

/**
 * Append any pending queued user messages (and their corresponding queued run transcript rows) to the given timeline.
 *
 * If `record.pendingUserMessages` is empty or missing, the original `rows` array is returned unchanged; otherwise a new array is returned with, for each pending message, a `user_message` row followed by a `run_transcript` row appended.
 *
 * @param rows - The existing chat timeline rows
 * @param record - The thread record containing `pendingUserMessages`
 * @returns A timeline rows array augmented with pending user message and run transcript rows, or the original `rows` if none are pending
 */
function appendPendingUserRows(rows: ChatTimelineRow[], record: ThreadRecord): ChatTimelineRow[] {
    const pendingMessages = record.pendingUserMessages ?? []
    if (pendingMessages.length === 0) return rows
    const next = [...rows]
    for (const pending of pendingMessages) {
        const userMessage = pendingUserMessage(pending)
        next.push({
            type: 'user_message',
            id: `pending-user-${pending.id}`,
            seq: next.length,
            message: userMessage,
            timestamp: pending.queuedAt,
        })
        next.push({
            type: 'run_transcript',
            id: `pending-run-${pending.id}`,
            seq: next.length,
            runId: pending.runId,
            status: 'queued',
            startedAt: pending.queuedAt,
            runtimeMs: null,
            collapsed: false,
            items: [],
            timestamp: pending.queuedAt,
        })
    }
    return next
}

/**
 * Creates a display-ready `RoomExecutionMessage` for a pending queued user message.
 *
 * @param pending - The pending user message record to convert
 * @returns A `RoomExecutionMessage` with an `id` prefixed by `pending-user-`, `role` set to `user`, the original `text`, a single text `part` reflecting the pending text, and `timestamp` taken from `pending.queuedAt`
 */
function pendingUserMessage(pending: PendingUserMessageRecord): RoomExecutionMessage {
    return {
        id: `pending-user-${pending.id}`,
        role: 'user',
        text: pending.text,
        parts: [
            emptyRuntimePart({
                type: 'text',
                text: pending.text,
            }),
        ],
        timestamp: pending.queuedAt,
    }
}

/**
 * Normalizes a display row for public consumption and assigns its sequence number.
 *
 * If the row is a message row (`user_message`, `assistant_final`, or `system`), runtime fields inside its message parts are redacted; for other row types only the `seq` field is updated.
 *
 * @param row - The original display row
 * @param seq - The sequence index to assign to the returned row
 * @returns The input row with `seq` set to `seq` and, for message rows, a sanitized `message`
 */
function sanitizeDisplayRow(row: RoomSessionDisplayRow, seq: number): RoomSessionDisplayRow {
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
    return Math.max(1, Math.min(maxWindowRows, Math.floor(limitRows)))
}

/**
 * Compute a cache invalidation key for a thread's display index.
 *
 * The returned key encodes the session file path, file cache metadata, record update time,
 * status, active run identifier, active duration, and the list of pending user message
 * id:queuedAt pairs so that changes to any of those invalidate cached indexes.
 *
 * @param record - ThreadRecord containing session and thread metadata used to build the key
 * @returns A colon-separated string formed from session file, file cache key, updatedAt, status, activeRunId (or empty), activeDurationMs, and comma-separated `id:queuedAt` pairs for pending user messages
 */
function displayCacheKey(record: ThreadRecord): string {
    const fileKey = fileCacheKey(record.sessionFile)
    return [
        record.sessionFile,
        fileKey,
        record.updatedAt,
        record.status,
        record.activeRunId ?? '',
        record.activeDurationMs,
        (record.pendingUserMessages ?? [])
            .map((message) => `${message.id}:${message.queuedAt}`)
            .join(','),
    ].join(':')
}

function fileCacheKey(path: string): string {
    if (!existsSync(path)) return 'missing'
    try {
        const stat = statSync(path)
        return `${stat.size}:${stat.mtimeMs}`
    } catch {
        return 'unknown'
    }
}
