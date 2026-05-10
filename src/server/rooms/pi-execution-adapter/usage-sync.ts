import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { roomRepository, usageRepository } from '../../db/repositories'
import type { JsonValue, UsageEventKind } from '../../domain/types'
import { getRoomPaths } from '../room-paths'
import { toNullableNumber } from './helpers'

const usageSyncStateVersion = 1
const usageSyncQueues = new Map<string, Promise<void>>()

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
    if (
        event === 'tool.docx' ||
        event === 'tool.xlsx' ||
        event === 'tool.pptx' ||
        event === 'tool.pdf'
    ) {
        return 'document_worker'
    }
    return 'tool'
}

function runtimeEventToolName(event: string): string | null {
    if (!event.startsWith('tool.')) {
        return null
    }
    if (event === 'tool.image_generate') {
        return 'agent_room_image_generate'
    }
    return `agent_room_${event.slice('tool.'.length).replaceAll('.', '_')}`
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

async function readUsageSyncState(roomId: string): Promise<{ lastLine: number }> {
    try {
        const raw = JSON.parse(await readFile(usageSyncStatePath(roomId), 'utf8')) as {
            version?: number
            lastLine?: number
        }
        if (
            raw.version === usageSyncStateVersion &&
            typeof raw.lastLine === 'number' &&
            Number.isFinite(raw.lastLine)
        ) {
            return {
                lastLine: Math.max(0, Math.floor(raw.lastLine)),
            }
        }
    } catch {}
    return {
        lastLine: 0,
    }
}

async function writeUsageSyncState(roomId: string, state: { lastLine: number }): Promise<void> {
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

async function syncRuntimeUsageEventsUnlocked(roomId: string): Promise<void> {
    const syncState = await readUsageSyncState(roomId)
    const paths = getRoomPaths(roomId)
    const runtimeEventsPath = join(paths.engineStateDir, 'runtime-events.jsonl')
    let raw = ''
    try {
        raw = await readFile(runtimeEventsPath, 'utf8')
    } catch {
        return
    }
    const lines = raw.split('\n')
    let lastLine = syncState.lastLine
    for (const [index, line] of lines.entries()) {
        const lineNumber = index + 1
        if (lineNumber <= syncState.lastLine) {
            continue
        }
        if (!line.trim()) {
            if (index < lines.length - 1) {
                lastLine = lineNumber
            }
            continue
        }
        let entry: unknown
        try {
            entry = JSON.parse(line)
        } catch {
            lastLine = lineNumber
            continue
        }
        const record = payloadRecord(entry)
        const ts = toNullableNumber(record.ts)
        const event = typeof record.event === 'string' ? record.event : null
        if (!event || ts === null) {
            lastLine = lineNumber
            continue
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
        if (event === 'run.finished') {
            const runKind = typeof payload.runKind === 'string' ? payload.runKind : null
            const totalTokens = usageNumber(payload, 'totalTokens')
            await usageRepository.appendEvent({
                roomId,
                sessionKey,
                runId,
                jobId: null,
                kind: runKind === 'scheduled' ? 'job' : 'run',
                provider: typeof payload.provider === 'string' ? payload.provider : null,
                model: typeof payload.model === 'string' ? payload.model : null,
                toolName: null,
                inputTokens: usageNumber(payload, 'inputTokens'),
                outputTokens: usageNumber(payload, 'outputTokens'),
                cachedTokens: usageNumber(payload, 'cachedTokens'),
                reasoningTokens: usageNumber(payload, 'reasoningTokens'),
                totalTokens,
                durationMs: toNullableNumber(payload.durationMs),
                activeDurationMs: toNullableNumber(payload.activeDurationMs),
                idleDurationMs: toNullableNumber(payload.idleDurationMs),
                estimatedCostUsd: usageNumber(payload, 'estimatedCostUsd'),
                metadata: toJsonValue({
                    runtimeEventTs: ts,
                    event,
                    status: typeof payload.status === 'string' ? payload.status : null,
                    error: typeof payload.error === 'string' ? payload.error : null,
                    runKind,
                    tokenUsageKnown: tokenUsageKnown(payload),
                    costUsageKnown: costUsageKnown(payload),
                }),
            })
            lastLine = lineNumber
            continue
        }
        if (event === 'provider.finished') {
            const totalTokens = usageNumber(payload, 'totalTokens')
            await usageRepository.appendEvent({
                roomId,
                sessionKey,
                runId,
                jobId: null,
                kind: 'provider',
                provider: typeof payload.provider === 'string' ? payload.provider : null,
                model: typeof payload.model === 'string' ? payload.model : null,
                toolName: null,
                inputTokens: usageNumber(payload, 'inputTokens'),
                outputTokens: usageNumber(payload, 'outputTokens'),
                cachedTokens: usageNumber(payload, 'cachedTokens'),
                reasoningTokens: usageNumber(payload, 'reasoningTokens'),
                totalTokens,
                durationMs: toNullableNumber(payload.durationMs),
                activeDurationMs: null,
                idleDurationMs: null,
                estimatedCostUsd: usageNumber(payload, 'estimatedCostUsd'),
                metadata: toJsonValue({
                    runtimeEventTs: ts,
                    event,
                    purpose: typeof payload.purpose === 'string' ? payload.purpose : null,
                    tokenUsageKnown: tokenUsageKnown(payload),
                    costUsageKnown: costUsageKnown(payload),
                }),
            })
            lastLine = lineNumber
            continue
        }
        const kind = usageKindForRuntimeEvent(event)
        if (!kind) {
            lastLine = lineNumber
            continue
        }
        await usageRepository.appendEvent({
            roomId,
            sessionKey,
            runId,
            jobId: null,
            kind,
            provider: typeof payload.provider === 'string' ? payload.provider : null,
            model: typeof payload.model === 'string' ? payload.model : null,
            toolName: runtimeEventToolName(event),
            inputTokens: null,
            outputTokens: null,
            cachedTokens: null,
            reasoningTokens: null,
            totalTokens: null,
            durationMs: toNullableNumber(payload.durationMs) ?? toNullableNumber(payload.latencyMs),
            activeDurationMs: null,
            idleDurationMs: null,
            estimatedCostUsd: null,
            metadata: toJsonValue({
                runtimeEventTs: ts,
                event,
                payload,
            }),
        })
        lastLine = lineNumber
    }
    if (lastLine > syncState.lastLine) {
        await writeUsageSyncState(roomId, {
            lastLine,
        })
    }
}

export async function syncRuntimeUsageEvents(roomId: string): Promise<void> {
    const previous = usageSyncQueues.get(roomId) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(() => syncRuntimeUsageEventsUnlocked(roomId))
    usageSyncQueues.set(roomId, next)
    try {
        await next
    } finally {
        if (usageSyncQueues.get(roomId) === next) {
            usageSyncQueues.delete(roomId)
        }
    }
}

export async function syncAllRuntimeUsageEvents(): Promise<void> {
    const rooms = await roomRepository.listRooms()
    for (const room of rooms) {
        await syncRuntimeUsageEvents(room.id)
    }
}
