import { existsSync, statSync } from 'node:fs'
import type { SessionEntry } from '@mariozechner/pi-coding-agent'
import { buildDisplayItems } from '#/lib/message-list-model'
import type {
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
import type { ThreadRecord } from './thread-records'

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

function buildSessionDisplayIndex(input: {
    config: PiRuntimeConfig
    record: ThreadRecord
    thread: RoomExecutionThread
    entries: SessionEntry[]
}): SessionDisplayIndex {
    const completed = completedToolCallIds(input.entries)
    const messages = input.entries
        .map((entry, index) => mapSessionEntry(entry, index, completed))
        .filter((message): message is RoomExecutionMessage => message !== null)
    const items = buildDisplayItems(
        messages,
        workingStatuses.has(input.record.status),
        input.thread,
    )
    const rows: RoomSessionDisplayRow[] = items.map((item, seq) => {
        if (item.type === 'message') {
            return {
                type: 'message',
                id: item.message.id,
                seq,
                message: sanitizeDisplayMessage(item.message),
                timestamp: item.message.timestamp,
            }
        }
        if (item.type === 'tools') {
            return {
                type: 'tools',
                id: item.id,
                seq,
                tasks: item.tasks,
                timestamp: item.timestamp,
            }
        }
        return {
            type: 'run-status',
            id: item.id,
            seq,
            thread: item.thread,
        }
    })
    return {
        rows,
        artifacts: extractSessionArtifacts(input.config, input.entries),
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

function displayCacheKey(record: ThreadRecord): string {
    const fileKey = fileCacheKey(record.sessionFile)
    return [
        record.sessionFile,
        fileKey,
        record.updatedAt,
        record.status,
        record.activeRunId ?? '',
        record.activeDurationMs,
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
