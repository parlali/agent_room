import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { roomRepository, usageRepository } from '../../db/repositories'
import type { JsonValue, UsageEventKind } from '#/domain/domain-types'
import { getRoomPaths } from '../room-paths'
import { toNullableNumber } from './helpers'
import {
    elapsedPerformanceMs,
    logPerformanceEvent,
    performanceNow,
} from '../../telemetry/performance'

const usageSyncStateVersion = 2
const usageSyncQueues = new Map<string, Promise<void>>()

type UsageSyncState = {
    lastLine: number
    lastByteOffset: number | null
}

type UsageSyncCounters = {
    scannedLines: number
    blankLines: number
    invalidLines: number
    persistedEvents: number
    runEvents: number
    providerEvents: number
    toolEvents: number
}

export interface RuntimeUsageEventInsert {
    roomId: string
    sessionKey: string | null
    runId: string | null
    jobId: string | null
    kind: UsageEventKind
    provider: string | null
    model: string | null
    toolName: string | null
    inputTokens: number | null
    outputTokens: number | null
    cachedTokens: number | null
    reasoningTokens: number | null
    totalTokens: number | null
    durationMs: number | null
    activeDurationMs: number | null
    idleDurationMs: number | null
    estimatedCostUsd: number | null
    metadata: JsonValue
}

function emptyCounters(): UsageSyncCounters {
    return {
        scannedLines: 0,
        blankLines: 0,
        invalidLines: 0,
        persistedEvents: 0,
        runEvents: 0,
        providerEvents: 0,
        toolEvents: 0,
    }
}

function payloadRecord(payload: unknown): Record<string, unknown> {
    return payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {}
}

function usageKindForRuntimeEvent(event: string): UsageEventKind | null {
    if (!event.startsWith('tool.')) {
        return null
    }
    if (event === 'tool.image_generate') {
        return 'image'
    }
    if (event === 'tool.pdf') {
        return 'document_worker'
    }
    return 'tool'
}

function runtimeEventToolName(event: string): string | null {
    if (!event.startsWith('tool.')) {
        return null
    }
    return event.slice('tool.'.length).replaceAll('.', '_')
}

function toJsonValue(value: unknown): JsonValue {
    if (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
    ) {
        return value
    }
    if (Array.isArray(value)) {
        return value.map((entry) => toJsonValue(entry))
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
                key,
                toJsonValue(entry),
            ]),
        )
    }
    return null
}

function usageNumber(payload: Record<string, unknown>, key: string): number | null {
    const usage = payloadRecord(payload.usage)
    return toNullableNumber(usage[key])
}

function stringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return []
    }
    return value.filter(
        (entry): entry is string => typeof entry === 'string' && entry.trim() !== '',
    )
}

function jsonArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : []
}

function runtimeJobId(input: {
    record: Record<string, unknown>
    payload: Record<string, unknown>
}): string | null {
    const recordJobId = typeof input.record.jobId === 'string' ? input.record.jobId.trim() : ''
    if (recordJobId) {
        return recordJobId
    }
    const payloadJobId = typeof input.payload.jobId === 'string' ? input.payload.jobId.trim() : ''
    if (payloadJobId) {
        return payloadJobId
    }
    return null
}

function runtimeRunKind(payload: Record<string, unknown>): string | null {
    return typeof payload.runKind === 'string' ? payload.runKind : null
}

function tokenUsageKnown(payload: Record<string, unknown>): boolean {
    return usageNumber(payload, 'totalTokens') !== null
}

function costUsageKnown(payload: Record<string, unknown>): boolean {
    const usage = payloadRecord(payload.usage)
    return usage.costKnown === true && usageNumber(payload, 'estimatedCostUsd') !== null
}

function usageSyncStatePath(roomId: string): string {
    return join(getRoomPaths(roomId).engineStateDir, 'usage-sync.json')
}

function finiteInteger(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.max(0, Math.floor(value))
        : null
}

async function readUsageSyncState(roomId: string): Promise<UsageSyncState> {
    try {
        const raw = JSON.parse(await readFile(usageSyncStatePath(roomId), 'utf8')) as {
            version?: number
            lastLine?: number
            lastByteOffset?: number
        }
        const lastLine = finiteInteger(raw.lastLine)
        const lastByteOffset = finiteInteger(raw.lastByteOffset)
        if (raw.version === usageSyncStateVersion && lastLine !== null && lastByteOffset !== null) {
            return {
                lastLine,
                lastByteOffset,
            }
        }
        if (raw.version === 1 && lastLine !== null) {
            return {
                lastLine,
                lastByteOffset: null,
            }
        }
    } catch {}
    return {
        lastLine: 0,
        lastByteOffset: 0,
    }
}

async function writeUsageSyncState(roomId: string, state: UsageSyncState): Promise<void> {
    const path = usageSyncStatePath(roomId)
    await mkdir(dirname(path), {
        recursive: true,
        mode: 0o700,
    })
    const tempPath = `${path}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
    await writeFile(
        tempPath,
        `${JSON.stringify(
            {
                version: usageSyncStateVersion,
                lastLine: state.lastLine,
                lastByteOffset: state.lastByteOffset ?? 0,
                updatedAt: new Date().toISOString(),
            },
            null,
            4,
        )}\n`,
        {
            encoding: 'utf8',
            mode: 0o600,
        },
    )
    await rename(tempPath, path)
}

function normalizeStateForFile(state: UsageSyncState, fileBytes: number): UsageSyncState {
    if (state.lastByteOffset === null) {
        return state
    }
    if (state.lastByteOffset > fileBytes) {
        return {
            lastLine: 0,
            lastByteOffset: 0,
        }
    }
    return state
}

function runtimeUsageMetrics(
    payload: Record<string, unknown>,
): Pick<
    RuntimeUsageEventInsert,
    | 'provider'
    | 'model'
    | 'toolName'
    | 'inputTokens'
    | 'outputTokens'
    | 'cachedTokens'
    | 'reasoningTokens'
    | 'totalTokens'
    | 'durationMs'
    | 'estimatedCostUsd'
> {
    return {
        provider: typeof payload.provider === 'string' ? payload.provider : null,
        model: typeof payload.model === 'string' ? payload.model : null,
        toolName: null,
        inputTokens: usageNumber(payload, 'inputTokens'),
        outputTokens: usageNumber(payload, 'outputTokens'),
        cachedTokens: usageNumber(payload, 'cachedTokens'),
        reasoningTokens: usageNumber(payload, 'reasoningTokens'),
        totalTokens: usageNumber(payload, 'totalTokens'),
        durationMs: toNullableNumber(payload.durationMs),
        estimatedCostUsd: usageNumber(payload, 'estimatedCostUsd'),
    }
}

function runUsageEvent(input: {
    roomId: string
    sessionKey: string | null
    runId: string | null
    jobId: string | null
    ts: number
    payload: Record<string, unknown>
}): RuntimeUsageEventInsert {
    const runKind = runtimeRunKind(input.payload)
    return {
        roomId: input.roomId,
        sessionKey: input.sessionKey,
        runId: input.runId,
        jobId: input.jobId,
        kind: runKind === 'scheduled' ? 'job' : 'run',
        ...runtimeUsageMetrics(input.payload),
        activeDurationMs: toNullableNumber(input.payload.activeDurationMs),
        idleDurationMs: toNullableNumber(input.payload.idleDurationMs),
        metadata: toJsonValue({
            runtimeEventTs: input.ts,
            event: 'run.finished',
            status: typeof input.payload.status === 'string' ? input.payload.status : null,
            error: typeof input.payload.error === 'string' ? input.payload.error : null,
            runKind,
            jobId: input.jobId,
            tokenUsageKnown: tokenUsageKnown(input.payload),
            costUsageKnown: costUsageKnown(input.payload),
            hostedProviderReservationIds: stringArray(input.payload.hostedProviderReservationIds),
            hostedProviderUsageCharges: jsonArray(input.payload.hostedProviderUsageCharges),
        }),
    }
}

function providerUsageEvent(input: {
    roomId: string
    sessionKey: string | null
    runId: string | null
    jobId: string | null
    ts: number
    payload: Record<string, unknown>
}): RuntimeUsageEventInsert {
    return {
        roomId: input.roomId,
        sessionKey: input.sessionKey,
        runId: input.runId,
        jobId: input.jobId,
        kind: 'provider',
        ...runtimeUsageMetrics(input.payload),
        activeDurationMs: null,
        idleDurationMs: null,
        metadata: toJsonValue({
            runtimeEventTs: input.ts,
            event: 'provider.finished',
            purpose: typeof input.payload.purpose === 'string' ? input.payload.purpose : null,
            jobId: input.jobId,
            tokenUsageKnown: tokenUsageKnown(input.payload),
            costUsageKnown: costUsageKnown(input.payload),
            hostedProviderReservationIds: stringArray(input.payload.hostedProviderReservationIds),
            hostedProviderUsageCharges: jsonArray(input.payload.hostedProviderUsageCharges),
        }),
    }
}

function toolUsageEvent(input: {
    roomId: string
    sessionKey: string | null
    runId: string | null
    jobId: string | null
    ts: number
    event: string
    kind: UsageEventKind
    payload: Record<string, unknown>
}): RuntimeUsageEventInsert {
    return {
        roomId: input.roomId,
        sessionKey: input.sessionKey,
        runId: input.runId,
        jobId: input.jobId,
        kind: input.kind,
        provider: typeof input.payload.provider === 'string' ? input.payload.provider : null,
        model: typeof input.payload.model === 'string' ? input.payload.model : null,
        toolName: runtimeEventToolName(input.event),
        inputTokens: null,
        outputTokens: null,
        cachedTokens: null,
        reasoningTokens: null,
        totalTokens: null,
        durationMs:
            toNullableNumber(input.payload.durationMs) ?? toNullableNumber(input.payload.latencyMs),
        activeDurationMs: null,
        idleDurationMs: null,
        estimatedCostUsd: null,
        metadata: toJsonValue({
            runtimeEventTs: input.ts,
            event: input.event,
            jobId: input.jobId,
            payload: input.payload,
        }),
    }
}

export function runtimeUsageEventFromLogEntry(input: {
    roomId: string
    entry: unknown
}): RuntimeUsageEventInsert | null {
    const record = payloadRecord(input.entry)
    const ts = toNullableNumber(record.ts)
    const event = typeof record.event === 'string' ? record.event : null
    if (!event || ts === null) {
        return null
    }

    const payload = payloadRecord(record.payload)
    const sessionKey =
        typeof record.sessionKey === 'string'
            ? record.sessionKey
            : typeof payload.sessionKey === 'string'
              ? payload.sessionKey
              : null
    const runId =
        typeof record.runId === 'string'
            ? record.runId
            : typeof payload.runId === 'string'
              ? payload.runId
              : null
    const jobId = runtimeJobId({ record, payload })

    if (event === 'run.finished') {
        if (runtimeRunKind(payload) === 'scheduled' && !jobId) {
            return null
        }
        return runUsageEvent({
            roomId: input.roomId,
            sessionKey,
            runId,
            jobId,
            ts,
            payload,
        })
    }

    if (event === 'provider.finished') {
        return providerUsageEvent({
            roomId: input.roomId,
            sessionKey,
            runId,
            jobId,
            ts,
            payload,
        })
    }

    const kind = usageKindForRuntimeEvent(event)
    if (!kind) {
        return null
    }

    return toolUsageEvent({
        roomId: input.roomId,
        sessionKey,
        runId,
        jobId,
        ts,
        event,
        kind,
        payload,
    })
}

async function processRuntimeEventLine(input: {
    roomId: string
    line: string
    counters: UsageSyncCounters
}): Promise<void> {
    if (!input.line.trim()) {
        input.counters.blankLines += 1
        return
    }

    let entry: unknown
    try {
        entry = JSON.parse(input.line)
    } catch {
        input.counters.invalidLines += 1
        return
    }

    const record = payloadRecord(entry)
    const event = typeof record.event === 'string' ? record.event : null
    const usageEvent = runtimeUsageEventFromLogEntry({
        roomId: input.roomId,
        entry,
    })
    if (!usageEvent) {
        if (!event || toNullableNumber(record.ts) === null) {
            input.counters.invalidLines += 1
        }
        return
    }

    await usageRepository.appendEvent(usageEvent)
    input.counters.persistedEvents += 1
    if (event === 'run.finished') {
        input.counters.runEvents += 1
    } else if (event === 'provider.finished') {
        input.counters.providerEvents += 1
    } else {
        input.counters.toolEvents += 1
    }
}

async function scanRuntimeEventTail(input: {
    roomId: string
    path: string
    state: UsageSyncState
    counters: UsageSyncCounters
}): Promise<UsageSyncState> {
    const startByteOffset = input.state.lastByteOffset ?? 0
    const skipThroughLine = input.state.lastByteOffset === null ? input.state.lastLine : 0
    let currentLine = input.state.lastByteOffset === null ? 0 : input.state.lastLine
    let lastLine = input.state.lastByteOffset === null ? input.state.lastLine : currentLine
    let lastByteOffset = startByteOffset
    let pending = Buffer.alloc(0)

    for await (const chunk of createReadStream(input.path, { start: startByteOffset })) {
        pending = Buffer.concat([pending, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)])
        let newlineIndex = pending.indexOf(10)
        while (newlineIndex >= 0) {
            const lineBytes = pending.subarray(0, newlineIndex)
            pending = pending.subarray(newlineIndex + 1)
            currentLine += 1
            const lineEndByteOffset = lastByteOffset + lineBytes.byteLength + 1
            if (currentLine > skipThroughLine) {
                input.counters.scannedLines += 1
                await processRuntimeEventLine({
                    roomId: input.roomId,
                    line: lineBytes.toString('utf8'),
                    counters: input.counters,
                })
                lastLine = currentLine
            }
            lastByteOffset = lineEndByteOffset
            newlineIndex = pending.indexOf(10)
        }
    }

    return {
        lastLine,
        lastByteOffset,
    }
}

async function syncRuntimeUsageEventsUnlocked(roomId: string): Promise<void> {
    const startedAt = performanceNow()
    const counters = emptyCounters()
    let status = 'ok'
    let errorName: string | null = null
    let startingLine = 0
    let lastLine = 0
    let startingByteOffset: number | null = null
    let lastByteOffset: number | null = null
    let fileBytes: number | null = null

    try {
        const paths = getRoomPaths(roomId)
        const runtimeEventsPath = join(paths.engineStateDir, 'runtime-events.jsonl')
        let fileStat: Awaited<ReturnType<typeof stat>>
        try {
            fileStat = await stat(runtimeEventsPath)
        } catch {
            status = 'no_log'
            return
        }

        fileBytes = fileStat.size
        const syncState = normalizeStateForFile(await readUsageSyncState(roomId), fileBytes)
        startingLine = syncState.lastLine
        lastLine = syncState.lastLine
        startingByteOffset = syncState.lastByteOffset
        lastByteOffset = syncState.lastByteOffset

        const nextState = await scanRuntimeEventTail({
            roomId,
            path: runtimeEventsPath,
            state: syncState,
            counters,
        })
        lastLine = nextState.lastLine
        lastByteOffset = nextState.lastByteOffset

        if (
            nextState.lastLine !== syncState.lastLine ||
            nextState.lastByteOffset !== syncState.lastByteOffset ||
            syncState.lastByteOffset === null
        ) {
            await writeUsageSyncState(roomId, nextState)
        }
    } catch (error) {
        status = 'error'
        errorName = error instanceof Error ? error.name : typeof error
        throw error
    } finally {
        logPerformanceEvent('usage_sync.run', {
            roomId,
            status,
            durationMs: elapsedPerformanceMs(startedAt),
            startingLine,
            lastLine,
            advancedLines: Math.max(0, lastLine - startingLine),
            startingByteOffset,
            lastByteOffset,
            advancedBytes:
                startingByteOffset === null || lastByteOffset === null
                    ? null
                    : Math.max(0, lastByteOffset - startingByteOffset),
            fileBytes,
            scannedLines: counters.scannedLines,
            blankLines: counters.blankLines,
            invalidLines: counters.invalidLines,
            persistedEvents: counters.persistedEvents,
            runEvents: counters.runEvents,
            providerEvents: counters.providerEvents,
            toolEvents: counters.toolEvents,
            errorName,
        })
    }
}

export async function syncRuntimeUsageEvents(roomId: string): Promise<void> {
    const startedAt = performanceNow()
    const queued = usageSyncQueues.has(roomId)
    const previous = usageSyncQueues.get(roomId) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(() => syncRuntimeUsageEventsUnlocked(roomId))
    usageSyncQueues.set(roomId, next)
    try {
        await next
    } finally {
        if (usageSyncQueues.get(roomId) === next) {
            usageSyncQueues.delete(roomId)
        }
        logPerformanceEvent('usage_sync.queue', {
            roomId,
            queued,
            durationMs: elapsedPerformanceMs(startedAt),
        })
    }
}

export async function syncAllRuntimeUsageEvents(): Promise<void> {
    const rooms = await roomRepository.listRooms()
    for (const room of rooms) {
        await syncRuntimeUsageEvents(room.id)
    }
}
