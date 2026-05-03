import { access, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import {
    roomCronRepository,
    roomRepository,
    roomRuntimeMetadataRepository,
    usageRepository,
} from '../db/repositories'
import type {
    JsonValue,
    RoomCronJobRecord,
    RoomCronRunRecord,
    RoomRuntimeMetadataRecord,
    RoomStatus,
    UsageEventKind,
} from '../domain/types'
import type {
    PiRuntimeAbortPayload,
    PiRuntimeCompactPayload,
    PiRuntimeForkPayload,
    PiRuntimeSendPayload,
    PiRuntimeSnapshotPayload,
    PiRuntimeThreadCreatePayload,
} from '../pi-runtime/protocol'
import { getRoomConfigSnapshot } from '../configuration/operator-configuration'
import { normalizeBudgets } from '../configuration/capabilities'
import { encodeRoomSseEvent, toRoomRealtimeEvent } from './execution-adapter'
import type {
    RoomAgentExecutionTruth,
    RoomCronJob,
    RoomExecutionSnapshot,
    RoomExecutionTruthSnapshot,
    RoomRuntimeOverview,
    RoomRunHistorySnapshot,
    RoomThreadAbortResult,
    RoomThreadSendResult,
} from './execution-types'
import { getRoomPaths } from './room-paths'
import { openPiRuntimeEventStream, requestPiRuntime } from './pi-runtime-client'

const ROOM_STREAM_BACKPRESSURE_LIMIT = -64
const maxCronStaleLockMs = 12 * 60 * 60 * 1000
const cronLeaseRenewalMs = 30000
const usageSyncStateVersion = 1
const usageSyncQueues = new Map<string, Promise<void>>()

const runtimeFileMetadataSchema = z
    .object({
        roomId: z.string().min(1),
        port: z.number(),
        pid: z.number().nullable().optional(),
        startedAt: z.string().nullable().optional(),
        configVersion: z.number().optional(),
        tokenVersion: z.number().optional(),
    })
    .passthrough()

const runtimeHealthFileSchema = z
    .object({
        roomId: z.string().min(1),
        port: z.number().nullable().optional(),
        pid: z.number().nullable().optional(),
        healthy: z.boolean(),
        message: z.string(),
        checkedAt: z.string(),
    })
    .passthrough()

const runtimeConfigFileSchema = z
    .object({
        runtime: z
            .object({
                bindHost: z.string().optional(),
                port: z.number().optional(),
            })
            .partial()
            .optional(),
        paths: z
            .object({
                workspaceDir: z.string().optional(),
                sessionsDir: z.string().optional(),
                internalStateDir: z.string().optional(),
                stateDir: z.string().optional(),
            })
            .partial()
            .optional(),
    })
    .passthrough()

const snapshotSchema = z.custom<PiRuntimeSnapshotPayload>(
    (value) => typeof value === 'object' && value !== null,
)
const createThreadSchema = z.custom<PiRuntimeThreadCreatePayload>(
    (value) => typeof value === 'object' && value !== null,
)
const sendSchema = z.custom<PiRuntimeSendPayload>(
    (value) => typeof value === 'object' && value !== null,
)
const abortSchema = z.custom<PiRuntimeAbortPayload>(
    (value) => typeof value === 'object' && value !== null,
)
const compactSchema = z.custom<PiRuntimeCompactPayload>(
    (value) => typeof value === 'object' && value !== null,
)
const forkSchema = z.custom<PiRuntimeForkPayload>(
    (value) => typeof value === 'object' && value !== null,
)

function toNullableNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value
    }
    return null
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

function mapRuntimeOverview(input: {
    roomId: string
    displayName: string
    slug: string
    status: RoomStatus
    desiredState: 'running' | 'stopped'
    runtimeMetadata: RoomRuntimeMetadataRecord | null
}): RoomRuntimeOverview {
    return {
        roomId: input.roomId,
        displayName: input.displayName,
        slug: input.slug,
        status: input.status,
        desiredState: input.desiredState,
        healthStatus: input.runtimeMetadata?.healthStatus ?? null,
        port: input.runtimeMetadata?.port ?? null,
        pid: input.runtimeMetadata?.pid ?? null,
        lastError: input.runtimeMetadata?.lastError ?? null,
        lastHealthAt: input.runtimeMetadata?.lastHealthAt
            ? input.runtimeMetadata.lastHealthAt.toISOString()
            : null,
    }
}

function buildRoomExecutionCapabilities(connected: boolean) {
    return {
        canStreamTokens: connected,
        canStreamToolEvents: connected,
        canAbortGeneration: connected,
        canEditMessages: false,
        editMessageUnsupportedReason:
            'Pi sessions are append-only in Agent Room. Create a new thread or rerun from a fork once branching is exposed.',
    }
}

function emptySnapshot(input: {
    room: RoomRuntimeOverview
    state: RoomExecutionSnapshot['executionState']
    message: string
}): RoomExecutionSnapshot {
    return {
        room: input.room,
        executionState: input.state,
        executionMessage: input.message,
        capabilities: buildRoomExecutionCapabilities(input.state === 'connected'),
        roomAgent: null,
        extraAgentIds: [],
        threads: [],
        selectedThreadKey: null,
        selectedThreadMessages: [],
        recentActivity: [],
    }
}

async function fileExists(path: string): Promise<boolean> {
    try {
        await access(path, fsConstants.F_OK)
        return true
    } catch {
        return false
    }
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

async function readJsonFile<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
    try {
        const raw = await readFile(path, 'utf8')
        return schema.parse(JSON.parse(raw))
    } catch {
        return null
    }
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
            await usageRepository.appendEvent({
                roomId,
                sessionKey,
                runId,
                jobId: null,
                kind: runKind === 'scheduled' ? 'job' : 'run',
                provider: typeof payload.provider === 'string' ? payload.provider : null,
                model: typeof payload.model === 'string' ? payload.model : null,
                toolName: null,
                inputTokens: null,
                outputTokens: null,
                cachedTokens: null,
                reasoningTokens: null,
                totalTokens: null,
                durationMs: toNullableNumber(payload.durationMs),
                activeDurationMs: toNullableNumber(payload.activeDurationMs),
                idleDurationMs: toNullableNumber(payload.idleDurationMs),
                estimatedCostUsd: null,
                metadata: toJsonValue({
                    runtimeEventTs: ts,
                    event,
                    status: typeof payload.status === 'string' ? payload.status : null,
                    error: typeof payload.error === 'string' ? payload.error : null,
                    runKind,
                    tokenUsageKnown: false,
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

async function collectSessionDirSnapshot(path: string): Promise<{
    count: number
    latestUpdateAt: number | null
}> {
    try {
        const entries = await readdir(path, { withFileTypes: true })
        let count = 0
        let latestUpdateAt: number | null = null

        for (const entry of entries) {
            if (!entry.isFile() && !entry.isDirectory()) {
                continue
            }

            count += 1
            try {
                const entryStat = await stat(join(path, entry.name))
                const updatedAt = entryStat.mtimeMs
                if (Number.isFinite(updatedAt)) {
                    latestUpdateAt =
                        latestUpdateAt === null || updatedAt > latestUpdateAt
                            ? updatedAt
                            : latestUpdateAt
                }
            } catch {
                continue
            }
        }

        return {
            count,
            latestUpdateAt,
        }
    } catch {
        return {
            count: 0,
            latestUpdateAt: null,
        }
    }
}

export async function listRoomsWithRuntime(): Promise<RoomRuntimeOverview[]> {
    const rooms = await roomRepository.listRooms()
    const runtimeRows = await Promise.all(
        rooms.map((room) => roomRuntimeMetadataRepository.findByRoomId(room.id)),
    )

    return rooms.map((room, index) =>
        mapRuntimeOverview({
            roomId: room.id,
            displayName: room.displayName,
            slug: room.slug,
            status: room.status,
            desiredState: room.desiredState,
            runtimeMetadata: runtimeRows[index],
        }),
    )
}

export async function getRoomExecutionSnapshot(input: {
    roomId: string
    selectedThreadKey?: string | null
    messageLimit?: number
}): Promise<RoomExecutionSnapshot> {
    const room = await roomRepository.findRoomById(input.roomId)
    if (!room) {
        throw new Error(`Room ${input.roomId} does not exist`)
    }

    const runtimeMetadata = await roomRuntimeMetadataRepository.findByRoomId(input.roomId)
    const roomOverview = mapRuntimeOverview({
        roomId: room.id,
        displayName: room.displayName,
        slug: room.slug,
        status: room.status,
        desiredState: room.desiredState,
        runtimeMetadata,
    })

    if (!runtimeMetadata || runtimeMetadata.port === null) {
        return emptySnapshot({
            room: roomOverview,
            state: 'unavailable',
            message: 'Room runtime has no allocated Pi endpoint',
        })
    }

    if (room.status !== 'running' && room.status !== 'degraded') {
        return emptySnapshot({
            room: roomOverview,
            state: 'unavailable',
            message: `Room is ${room.status}. Start the runtime to load threads and chat`,
        })
    }

    try {
        const query = new URLSearchParams()
        if (input.selectedThreadKey) {
            query.set('selectedThreadKey', input.selectedThreadKey)
        }
        query.set(
            'messageLimit',
            String(
                input.messageLimit && Number.isFinite(input.messageLimit)
                    ? Math.max(1, Math.floor(input.messageLimit))
                    : 200,
            ),
        )
        const payload = await requestPiRuntime(
            input.roomId,
            `/snapshot?${query.toString()}`,
            snapshotSchema,
        )
        await syncRuntimeUsageEvents(input.roomId)

        return {
            room: roomOverview,
            executionState: 'connected',
            executionMessage: null,
            capabilities: buildRoomExecutionCapabilities(true),
            ...payload,
        }
    } catch (error) {
        return emptySnapshot({
            room: roomOverview,
            state: 'error',
            message: error instanceof Error ? error.message : 'Unknown Pi adapter error',
        })
    }
}

export async function sendRoomThreadMessage(input: {
    roomId: string
    sessionKey: string
    message: string
    awaitCompletion?: boolean
    runKind?: 'manual' | 'scheduled' | 'subagent' | 'maintenance'
    jobId?: string | null
}): Promise<RoomThreadSendResult> {
    const message = input.message.trim()
    if (!message) {
        throw new Error('Message cannot be empty')
    }

    const startedAt = Date.now()
    try {
        const result = await requestPiRuntime(
            input.roomId,
            `/threads/${encodeURIComponent(input.sessionKey)}/send`,
            sendSchema,
            {
                method: 'POST',
                body: {
                    message,
                    awaitCompletion: input.awaitCompletion === true,
                    runKind: input.runKind ?? 'manual',
                },
            },
        )
        await syncRuntimeUsageEvents(input.roomId)
        if (input.jobId && result.runId) {
            await usageRepository.attachJobToRun({
                roomId: input.roomId,
                runId: result.runId,
                jobId: input.jobId,
            })
        }
        return result
    } catch (error) {
        await usageRepository.appendEvent({
            roomId: input.roomId,
            sessionKey: input.sessionKey,
            runId: null,
            jobId: input.jobId ?? null,
            kind: 'run',
            provider: null,
            model: null,
            toolName: null,
            inputTokens: null,
            outputTokens: null,
            cachedTokens: null,
            reasoningTokens: null,
            totalTokens: null,
            durationMs: Date.now() - startedAt,
            activeDurationMs: null,
            idleDurationMs: null,
            estimatedCostUsd: null,
            metadata: {
                status: 'failed',
                runKind: input.runKind ?? 'manual',
                error: error instanceof Error ? error.message : 'Unknown error',
                tokenUsageKnown: false,
            },
        })
        throw error
    }
}

export async function abortRoomThreadMessage(input: {
    roomId: string
    sessionKey: string
    runId?: string | null
}): Promise<RoomThreadAbortResult> {
    return requestPiRuntime(
        input.roomId,
        `/threads/${encodeURIComponent(input.sessionKey)}/abort`,
        abortSchema,
        {
            method: 'POST',
            body: {
                runId: input.runId ?? null,
            },
        },
    )
}

export async function compactRoomThread(input: {
    roomId: string
    sessionKey: string
    instructions?: string | null
}): Promise<PiRuntimeCompactPayload> {
    return requestPiRuntime(
        input.roomId,
        `/threads/${encodeURIComponent(input.sessionKey)}/compact`,
        compactSchema,
        {
            method: 'POST',
            body: {
                instructions: input.instructions ?? null,
            },
        },
    )
}

export async function forkRoomThread(input: {
    roomId: string
    sessionKey: string
    title?: string | null
    entryId?: string | null
}): Promise<PiRuntimeForkPayload> {
    return requestPiRuntime(
        input.roomId,
        `/threads/${encodeURIComponent(input.sessionKey)}/fork`,
        forkSchema,
        {
            method: 'POST',
            body: {
                title: input.title ?? null,
                entryId: input.entryId ?? null,
            },
        },
    )
}

export async function editRoomThreadMessage(_input: {
    roomId: string
    sessionKey: string
    messageId: string
    message: string
}): Promise<never> {
    throw new Error(
        'Pi sessions are append-only in Agent Room. Message editing is not exposed yet.',
    )
}

export function createRoomSessionEventStream(input: {
    roomId: string
    sessionKey: string
    abortSignal?: AbortSignal
}): ReadableStream<Uint8Array> {
    let closed = false
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null

    return new ReadableStream<Uint8Array>({
        start(controller) {
            const close = async () => {
                if (closed) {
                    return
                }
                closed = true
                input.abortSignal?.removeEventListener('abort', onAbort)
                if (reader) {
                    await reader.cancel()
                    reader = null
                }
                try {
                    controller.close()
                } catch {}
            }

            const enqueue = (chunk: Uint8Array) => {
                if (closed) {
                    return
                }
                if (
                    typeof controller.desiredSize === 'number' &&
                    controller.desiredSize < ROOM_STREAM_BACKPRESSURE_LIMIT
                ) {
                    controller.enqueue(
                        encodeRoomSseEvent('stream-error', {
                            message: 'Browser stream consumer is too far behind',
                        }),
                    )
                    void close()
                    return
                }
                controller.enqueue(chunk)
            }

            const onAbort = () => {
                void close()
            }

            const run = async () => {
                try {
                    const stream = await openPiRuntimeEventStream({
                        roomId: input.roomId,
                        sessionKey: input.sessionKey,
                        signal: input.abortSignal,
                    })
                    reader = stream.getReader()
                    while (!closed) {
                        const result = await reader.read()
                        if (result.done) {
                            await close()
                            return
                        }
                        enqueue(result.value)
                    }
                } catch (error) {
                    if (!closed) {
                        controller.enqueue(
                            encodeRoomSseEvent(
                                'stream-error',
                                toRoomRealtimeEvent({
                                    event: 'stream-error',
                                    payload: {
                                        message:
                                            error instanceof Error
                                                ? error.message
                                                : 'Room stream failed',
                                    },
                                }),
                            ),
                        )
                        await close()
                    }
                }
            }

            input.abortSignal?.addEventListener('abort', onAbort, { once: true })
            void run()
        },
        cancel() {
            closed = true
            if (reader) {
                void reader.cancel()
                reader = null
            }
        },
    })
}

export async function createRoomThread(input: {
    roomId: string
    firstMessage?: string | null
}): Promise<{ key: string }> {
    return requestPiRuntime(input.roomId, '/threads', createThreadSchema, {
        method: 'POST',
        body: {
            firstMessage: input.firstMessage ?? null,
        },
    })
}

export async function listRoomCronJobs(input: {
    roomId: string
    limit?: number
}): Promise<RoomCronJob[]> {
    const limit =
        input.limit && Number.isFinite(input.limit) ? Math.max(1, Math.floor(input.limit)) : 200
    const jobs = await roomCronRepository.listJobsByRoomId(input.roomId)
    return jobs.slice(0, limit).map(mapCronJobRecord)
}

export async function createRoomCronJob(input: {
    roomId: string
    name: string
    message: string
    everyMinutes: number
}): Promise<RoomCronJob> {
    const name = input.name.trim()
    if (!name) {
        throw new Error('Cron job name cannot be empty')
    }

    const message = input.message.trim()
    if (!message) {
        throw new Error('Cron job message cannot be empty')
    }

    if (!Number.isFinite(input.everyMinutes) || input.everyMinutes <= 0) {
        throw new Error('Cron job interval must be a positive minute value')
    }

    const [config, runtimeMetadata] = await Promise.all([
        getRoomConfigSnapshot(input.roomId),
        roomRuntimeMetadataRepository.findByRoomId(input.roomId),
    ])
    const everyMinutes = Math.max(1, Math.floor(input.everyMinutes))
    const job = await roomCronRepository.createJob({
        roomId: input.roomId,
        name,
        message,
        everyMinutes,
        timezone: config.config.cronTimezone,
        nextRunAt: new Date(Date.now() + everyMinutes * 60000),
        provider: config.effective.provider,
        model: config.effective.model,
        configVersion: runtimeMetadata?.configVersion ?? null,
    })
    return mapCronJobRecord(job)
}

export async function updateRoomCronJob(input: {
    roomId: string
    jobId: string
    name: string
    message: string
    everyMinutes: number
}): Promise<RoomCronJob> {
    const existing = await roomCronRepository.findJobById({
        roomId: input.roomId,
        jobId: input.jobId,
    })
    if (!existing) {
        throw new Error(`Cron job ${input.jobId} does not exist`)
    }

    const name = input.name.trim()
    if (!name) {
        throw new Error('Cron job name cannot be empty')
    }

    const message = input.message.trim()
    if (!message) {
        throw new Error('Cron job message cannot be empty')
    }

    if (!Number.isFinite(input.everyMinutes) || input.everyMinutes <= 0) {
        throw new Error('Cron job interval must be a positive minute value')
    }

    const [config, runtimeMetadata] = await Promise.all([
        getRoomConfigSnapshot(input.roomId),
        roomRuntimeMetadataRepository.findByRoomId(input.roomId),
    ])
    const everyMinutes = Math.max(1, Math.floor(input.everyMinutes))
    const job = await roomCronRepository.updateJob({
        roomId: input.roomId,
        jobId: input.jobId,
        name,
        message,
        everyMinutes,
        nextRunAt: existing.enabled ? new Date(Date.now() + everyMinutes * 60000) : null,
        provider: config.effective.provider,
        model: config.effective.model,
        configVersion: runtimeMetadata?.configVersion ?? existing.configVersion,
    })
    return mapCronJobRecord(job)
}

export async function updateRoomCronJobEnabled(input: {
    roomId: string
    jobId: string
    enabled: boolean
}): Promise<RoomCronJob> {
    const existing = await roomCronRepository.findJobById(input)
    if (!existing) {
        throw new Error(`Cron job ${input.jobId} does not exist`)
    }
    return mapCronJobRecord(
        await roomCronRepository.setJobEnabled({
            roomId: input.roomId,
            jobId: input.jobId,
            enabled: input.enabled,
            nextRunAt: input.enabled ? new Date(Date.now() + existing.everyMinutes * 60000) : null,
        }),
    )
}

function scheduledRunBudgetMs(): number {
    return normalizeBudgets().scheduledTurnMs
}

function cronLeaseMs(job: Pick<RoomCronJobRecord, 'everyMinutes' | 'runBudgetMs'>): number {
    const intervalMs = Math.max(60000, job.everyMinutes * 60000)
    const budgetMs = job.runBudgetMs ?? scheduledRunBudgetMs()
    return Math.min(maxCronStaleLockMs, Math.max(5 * 60000, Math.min(intervalMs, budgetMs + 60000)))
}

function nextCronLease(job: RoomCronJobRecord): Date {
    return new Date(Date.now() + cronLeaseMs(job))
}

async function executeClaimedCronJob(input: {
    job: RoomCronJobRecord
    lockToken: string | null
}): Promise<{ ran: boolean; reason: string | null }> {
    const startedAt = Date.now()
    const [config, runtimeMetadata] = await Promise.all([
        getRoomConfigSnapshot(input.job.roomId),
        roomRuntimeMetadataRepository.findByRoomId(input.job.roomId),
    ])
    const provider = config.effective.provider
    const model = config.effective.model
    const configVersion = runtimeMetadata?.configVersion ?? input.job.configVersion
    let run: RoomCronRunRecord | null = null
    let renewal: ReturnType<typeof setInterval> | null = null

    if (input.lockToken) {
        renewal = setInterval(() => {
            void roomCronRepository.renewJobLease({
                roomId: input.job.roomId,
                jobId: input.job.id,
                lockToken: input.lockToken!,
                lockedUntil: nextCronLease(input.job),
            })
        }, cronLeaseRenewalMs)
        renewal.unref?.()
    }

    try {
        if (!config.effective.ready) {
            throw new Error(
                `Room configuration is blocked: ${config.effective.blockedReasons.join('; ')}`,
            )
        }

        const thread = await createRoomThread({
            roomId: input.job.roomId,
        })
        run = await roomCronRepository.createRun({
            roomId: input.job.roomId,
            jobId: input.job.id,
            jobName: input.job.name,
            status: 'running',
            summary: input.job.message,
            error: null,
            sessionKey: thread.key,
            sessionId: null,
            provider,
            model,
            configVersion,
        })
        const sendResult = await sendRoomThreadMessage({
            roomId: input.job.roomId,
            sessionKey: thread.key,
            message: input.job.message,
            awaitCompletion: true,
            runKind: 'scheduled',
            jobId: input.job.id,
        })
        if (sendResult.status === 'error') {
            throw new Error(sendResult.error ?? 'Scheduled run failed in the Pi runtime')
        }

        const nextRunAt = input.job.enabled
            ? new Date(Date.now() + input.job.everyMinutes * 60000)
            : null
        await roomCronRepository.finishRun({
            runId: run.id,
            status: 'complete',
            error: null,
            nextRunAt,
        })
        await roomCronRepository.finishJob({
            roomId: input.job.roomId,
            jobId: input.job.id,
            lockToken: input.lockToken,
            status: 'complete',
            error: null,
            durationMs: Date.now() - startedAt,
            nextRunAt,
        })
        return {
            ran: true,
            reason: null,
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Scheduled run failed'
        const nextRunAt = input.job.enabled
            ? new Date(Date.now() + input.job.everyMinutes * 60000)
            : null
        if (run) {
            await roomCronRepository.finishRun({
                runId: run.id,
                status: 'failed',
                error: message,
                nextRunAt,
            })
        } else {
            await roomCronRepository.createRun({
                roomId: input.job.roomId,
                jobId: input.job.id,
                jobName: input.job.name,
                status: 'failed',
                summary: input.job.message,
                error: message,
                sessionKey: null,
                sessionId: null,
                provider,
                model,
                configVersion,
            })
        }
        await roomCronRepository.finishJob({
            roomId: input.job.roomId,
            jobId: input.job.id,
            lockToken: input.lockToken,
            status: 'failed',
            error: message,
            durationMs: Date.now() - startedAt,
            nextRunAt,
        })
        return {
            ran: false,
            reason: message,
        }
    } finally {
        if (renewal) {
            clearInterval(renewal)
        }
    }
}

export async function runRoomCronJobNow(input: {
    roomId: string
    jobId: string
}): Promise<{ ran: boolean; reason: string | null }> {
    const job = await roomCronRepository.findJobById(input)
    if (!job) {
        throw new Error(`Cron job ${input.jobId} does not exist`)
    }
    const lockToken = randomUUID()
    const claimed = await roomCronRepository.claimJob({
        roomId: input.roomId,
        jobId: input.jobId,
        lockToken,
        runBudgetMs: scheduledRunBudgetMs(),
        maxStaleLockMs: maxCronStaleLockMs,
    })
    if (!claimed) {
        return {
            ran: false,
            reason: 'Job is already running',
        }
    }
    return executeClaimedCronJob({
        job: claimed,
        lockToken,
    })
}

export async function runDueRoomCronJobs(
    input: {
        limit?: number
    } = {},
): Promise<Array<{ jobId: string; ran: boolean; reason: string | null }>> {
    const lockToken = randomUUID()
    const jobs = await roomCronRepository.claimDueJobs({
        lockToken,
        runBudgetMs: scheduledRunBudgetMs(),
        maxStaleLockMs: maxCronStaleLockMs,
        limit:
            input.limit && Number.isFinite(input.limit)
                ? Math.max(1, Math.min(25, Math.floor(input.limit)))
                : 10,
    })
    const results: Array<{ jobId: string; ran: boolean; reason: string | null }> = []
    for (const job of jobs) {
        const result = await executeClaimedCronJob({
            job,
            lockToken,
        })
        results.push({
            jobId: job.id,
            ...result,
        })
    }
    return results
}

export async function removeRoomCronJob(input: { roomId: string; jobId: string }): Promise<void> {
    const removed = await roomCronRepository.removeJob(input)
    if (!removed) {
        throw new Error(`Cron job ${input.jobId} was not removed`)
    }
}

function mapCronJobRecord(job: RoomCronJobRecord): RoomCronJob {
    return {
        id: job.id,
        agentId: 'main',
        sessionKey: job.targetThreadKey,
        name: job.name,
        description: null,
        enabled: job.enabled,
        sessionTarget: job.sessionTarget,
        wakeMode: 'now',
        everyMinutes: job.everyMinutes,
        scheduleSummary: scheduleSummary(job.everyMinutes),
        payloadSummary: job.message,
        nextRunAt: job.nextRunAt ? job.nextRunAt.getTime() : null,
        runningAt: job.runningAt ? job.runningAt.getTime() : null,
        lastRunAt: job.lastRunAt ? job.lastRunAt.getTime() : null,
        lastRunStatus: job.lastRunStatus,
        lastError: job.lastError,
        lastDurationMs: job.lastDurationMs,
    }
}

function scheduleSummary(everyMinutes: number): string {
    if (everyMinutes < 60) {
        return everyMinutes === 1 ? 'Every minute' : `Every ${everyMinutes} minutes`
    }
    if (everyMinutes % (24 * 60) === 0) {
        const days = everyMinutes / (24 * 60)
        return days === 1 ? 'Every day' : `Every ${days} days`
    }
    if (everyMinutes % 60 === 0) {
        const hours = everyMinutes / 60
        return hours === 1 ? 'Every hour' : `Every ${hours} hours`
    }
    return `Every ${everyMinutes} minutes`
}

function mapCronRunRecord(run: RoomCronRunRecord): RoomRunHistorySnapshot['entries'][number] {
    return {
        id: run.id,
        ts: run.startedAt.getTime(),
        jobId: run.jobId ?? '',
        jobName: run.jobName,
        status: run.status,
        summary: run.summary,
        error: run.error,
        sessionId: run.sessionId,
        sessionKey: run.sessionKey,
        declaredAgentId: 'main',
        effectiveAgentId: 'main',
        resolvedSessionAgentId: run.sessionKey ? 'main' : null,
        ownership: run.sessionKey ? 'owned' : 'unknown',
        durationMs: run.durationMs,
        nextRunAtMs: run.nextRunAt ? run.nextRunAt.getTime() : null,
        model: run.model,
        provider: run.provider,
    }
}

export async function wakeRoomRuntime(input: {
    roomId: string
    text: string
    mode: 'now' | 'next-heartbeat'
}): Promise<void> {
    if (input.mode !== 'now') {
        throw new Error('Deferred heartbeat wake is not implemented for the Pi runtime')
    }

    const text = input.text.trim()
    if (!text) {
        throw new Error('Wake trigger text cannot be empty')
    }

    const snapshot = await requestPiRuntime(input.roomId, '/snapshot', snapshotSchema)
    const selectedThreadKey = snapshot.selectedThreadKey ?? snapshot.threads[0]?.key ?? null
    if (!selectedThreadKey) {
        await createRoomThread({
            roomId: input.roomId,
            firstMessage: text,
        })
        return
    }

    await sendRoomThreadMessage({
        roomId: input.roomId,
        sessionKey: selectedThreadKey,
        message: text,
    })
}

export async function getRoomExecutionTruthSnapshot(input: {
    roomId: string
}): Promise<RoomExecutionTruthSnapshot> {
    const room = await roomRepository.findRoomById(input.roomId)
    if (!room) {
        throw new Error(`Room ${input.roomId} does not exist`)
    }

    const paths = getRoomPaths(input.roomId)

    const [runtimeMetadataFile, runtimeHealthFile, runtimeConfigFile] = await Promise.all([
        readJsonFile(paths.runtimeMetadataPath, runtimeFileMetadataSchema),
        readJsonFile(paths.runtimeHealthPath, runtimeHealthFileSchema),
        readJsonFile(paths.runtimeConfigPath, runtimeConfigFileSchema),
    ])

    const sessionsPath =
        runtimeConfigFile?.paths?.sessionsDir ?? join(paths.engineStateDir, 'sessions')
    const memoryPath =
        runtimeConfigFile?.paths?.internalStateDir ?? join(paths.engineStateDir, 'internal-state')
    const [memoryExists, sessionsExists, sessionsSnapshot] = await Promise.all([
        fileExists(memoryPath),
        fileExists(sessionsPath),
        collectSessionDirSnapshot(sessionsPath),
    ])

    const agents: RoomAgentExecutionTruth[] = [
        {
            agentId: 'main',
            workspacePath: runtimeConfigFile?.paths?.workspaceDir ?? paths.workspaceDir,
            memoryPath,
            sessionsPath,
            memoryExists,
            sessionsExists,
            sessionFileCount: sessionsSnapshot.count,
            latestSessionUpdateAt: sessionsSnapshot.latestUpdateAt,
        },
    ]

    return {
        roomId: input.roomId,
        stateDirPath: paths.engineStateDir,
        workspaceDirPath: paths.workspaceDir,
        storeDirPath: paths.storeDir,
        runtimeConfigPath: paths.runtimeConfigPath,
        runtimeMetadataPath: paths.runtimeMetadataPath,
        runtimeHealthPath: paths.runtimeHealthPath,
        runtimeMetadataFile: runtimeMetadataFile
            ? {
                  port: toNullableNumber(runtimeMetadataFile.port),
                  pid: toNullableNumber(runtimeMetadataFile.pid),
                  startedAt: runtimeMetadataFile.startedAt ?? null,
                  configVersion: toNullableNumber(runtimeMetadataFile.configVersion),
                  tokenVersion: toNullableNumber(runtimeMetadataFile.tokenVersion),
              }
            : null,
        runtimeHealthFile: runtimeHealthFile
            ? {
                  healthy: runtimeHealthFile.healthy,
                  message: runtimeHealthFile.message,
                  checkedAt: runtimeHealthFile.checkedAt,
              }
            : null,
        runtimeConfigFile: runtimeConfigFile
            ? {
                  bind: runtimeConfigFile.runtime?.bindHost ?? null,
                  port: toNullableNumber(runtimeConfigFile.runtime?.port),
                  workspace: runtimeConfigFile.paths?.workspaceDir ?? null,
              }
            : null,
        agents,
    }
}

export async function listRoomRunHistory(input: {
    roomId: string
    limit?: number
}): Promise<RoomRunHistorySnapshot> {
    const limit =
        input.limit && Number.isFinite(input.limit)
            ? Math.max(1, Math.min(200, Math.floor(input.limit)))
            : 100
    const runs = await roomCronRepository.listRunsByRoomId({
        roomId: input.roomId,
        limit,
    })
    return {
        roomId: input.roomId,
        mismatchCount: 0,
        entries: runs.map(mapCronRunRecord),
    }
}

const sessionMutationSchema = z
    .object({
        ok: z.boolean(),
    })
    .passthrough()

export async function deleteRoomSession(input: {
    roomId: string
    sessionKey: string
}): Promise<void> {
    await requestPiRuntime(
        input.roomId,
        `/threads/${encodeURIComponent(input.sessionKey)}`,
        sessionMutationSchema,
        { method: 'DELETE' },
    )
}

export async function renameRoomSession(input: {
    roomId: string
    sessionKey: string
    title: string
}): Promise<void> {
    await requestPiRuntime(
        input.roomId,
        `/threads/${encodeURIComponent(input.sessionKey)}/rename`,
        sessionMutationSchema,
        {
            method: 'POST',
            body: { title: input.title },
        },
    )
}
