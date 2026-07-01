import { existsSync, statSync } from 'node:fs'
import type { SessionEntry } from '@mariozechner/pi-coding-agent'
import { buildChatTimelineRows, createPendingUserDisplayRows } from '#/domain/message-list-model'
import {
    finalizeSessionDisplayRows,
    isThreadWorking,
    sliceSessionWindow,
} from '#/domain/session-window-projection'
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
import { visibleProjectionEntries } from './hidden-projection'
import { completedToolCallIds, mapSessionEntry } from './session-entry-mapper'
import { promptAttachmentMetadataByEntryId } from './prompt-attachments'
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
            const index = readIndex(inputWindow.record, inputWindow.thread)
            const payload = sliceSessionWindow({
                sessionKey: inputWindow.record.key,
                rows: index.rows,
                artifacts: index.artifacts,
                before: inputWindow.before,
                after: inputWindow.after,
                limitRows: inputWindow.limitRows,
            })
            logPerformanceEvent('chat.window.load', {
                sessionKey: inputWindow.record.key,
                durationMs: elapsedPerformanceMs(startedAt),
                rowCount: payload.rows.length,
                totalRows: payload.totalRows,
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
    const attachmentMetadata = promptAttachmentMetadataByEntryId(input.entries)
    const messages = visibleProjectionEntries(input.entries)
        .map((entry, index) => mapSessionEntry(entry, index, completed, attachmentMetadata))
        .filter((message): message is RoomExecutionMessage => message !== null)
    const rows = buildChatTimelineRows(messages, isThreadWorking(input.record.status), input.thread)
    const displayRows = finalizeSessionDisplayRows(appendPendingUserRows(rows, input.record))
    return {
        rows: displayRows,
        artifacts: extractSessionArtifacts(input.config, input.entries),
    }
}

function appendPendingUserRows(rows: ChatTimelineRow[], record: ThreadRecord): ChatTimelineRow[] {
    const pendingMessages = record.pendingUserMessages ?? []
    if (pendingMessages.length === 0) return rows
    const next = [...rows]
    for (const pending of pendingMessages) {
        const pendingRows = createPendingUserDisplayRows({
            messageId: pending.messageId,
            runId: pending.runId,
            text: pending.text,
            queuedAt: pending.queuedAt,
            startSeq: next.length,
        })
        next.push(...pendingRows)
    }
    return next
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
        (record.pendingUserMessages ?? [])
            .map((message) => `${message.messageId}:${message.queuedAt}`)
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
