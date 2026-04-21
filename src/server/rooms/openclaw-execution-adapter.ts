import { randomUUID } from 'node:crypto'
import { access, readFile, readdir, stat } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import {
    extractOpenClawMessageParts,
    extractOpenClawMessageText,
    toOpenClawMessagePayload,
} from '#/lib/openclaw-message'
import { roomRepository, roomRuntimeMetadataRepository } from '../db/repositories'
import type { RoomRuntimeMetadataRecord, RoomStatus } from '../domain/types'
import { getRoomPaths } from './room-paths'
import type {
    RoomAgentExecutionTruth,
    RoomCronJob,
    RoomExecutionActivity,
    RoomExecutionAgent,
    RoomExecutionMessage,
    RoomExecutionSnapshot,
    RoomExecutionThread,
    RoomExecutionTruthSnapshot,
    RoomRealtimeEvent,
    RoomRunHistoryEntry,
    RoomRunHistorySnapshot,
    RoomRuntimeOverview,
    RoomThreadAbortResult,
    RoomThreadSendResult,
} from './execution-types'

const gatewayAgentSchema = z
    .object({
        id: z.string().min(1),
        name: z.string().optional(),
        workspace: z.string().optional(),
        identity: z
            .object({
                name: z.string().optional(),
                theme: z.string().optional(),
                emoji: z.string().optional(),
                avatar: z.string().optional(),
                avatarUrl: z.string().optional(),
            })
            .partial()
            .optional(),
        model: z
            .object({
                primary: z.string().optional(),
                fallbacks: z.array(z.string()).optional(),
            })
            .partial()
            .optional(),
    })
    .passthrough()

const agentsListResultSchema = z
    .object({
        defaultId: z.string().min(1),
        mainKey: z.string().optional(),
        scope: z.string().optional(),
        agents: z.array(gatewayAgentSchema),
    })
    .passthrough()

const gatewaySessionSchema = z
    .object({
        key: z.string().min(1),
        updatedAt: z.number().nullable().optional(),
        sessionId: z.string().optional(),
        label: z.string().optional(),
        displayName: z.string().optional(),
        derivedTitle: z.string().optional(),
        lastMessagePreview: z.string().optional(),
        status: z.string().optional(),
        modelProvider: z.string().optional(),
        model: z.string().optional(),
        runtimeMs: z.number().optional(),
        startedAt: z.number().optional(),
        endedAt: z.number().optional(),
        totalTokens: z.number().optional(),
        estimatedCostUsd: z.number().optional(),
    })
    .passthrough()

const sessionsListResultSchema = z
    .object({
        sessions: z.array(gatewaySessionSchema),
    })
    .passthrough()

const sessionsGetResultSchema = z
    .object({
        messages: z.array(z.unknown()),
    })
    .passthrough()

const sessionsCreateResultSchema = z
    .object({
        ok: z.literal(true),
        key: z.string().min(1),
    })
    .passthrough()

const sessionsSendResultSchema = z
    .object({
        runId: z.string().optional(),
        status: z.string().optional(),
        messageSeq: z.number().optional(),
        interruptedActiveRun: z.boolean().optional(),
    })
    .passthrough()

const sessionsAbortResultSchema = z
    .object({
        abortedRunId: z.string().nullable().optional(),
        status: z.string().optional(),
    })
    .passthrough()

const sessionsSubscribeResultSchema = z
    .object({
        subscribed: z.boolean(),
    })
    .passthrough()

const sessionsMessagesSubscribeResultSchema = z
    .object({
        subscribed: z.boolean(),
        key: z.string().min(1),
    })
    .passthrough()

const cronScheduleSchema = z.union([
    z
        .object({
            kind: z.literal('at'),
            at: z.string().min(1),
        })
        .passthrough(),
    z
        .object({
            kind: z.literal('every'),
            everyMs: z.number(),
            anchorMs: z.number().optional(),
        })
        .passthrough(),
    z
        .object({
            kind: z.literal('cron'),
            expr: z.string().min(1),
            tz: z.string().optional(),
            staggerMs: z.number().optional(),
        })
        .passthrough(),
])

const cronPayloadSchema = z
    .object({
        kind: z.string().min(1),
        text: z.string().optional(),
        message: z.string().optional(),
    })
    .passthrough()

const cronStateSchema = z
    .object({
        nextRunAtMs: z.number().optional(),
        runningAtMs: z.number().optional(),
        lastRunAtMs: z.number().optional(),
        lastRunStatus: z.string().optional(),
        lastStatus: z.string().optional(),
        lastError: z.string().optional(),
        lastDurationMs: z.number().optional(),
    })
    .passthrough()

const cronJobSchema = z
    .object({
        id: z.string().min(1),
        agentId: z.string().optional(),
        sessionKey: z.string().optional(),
        name: z.string().min(1),
        description: z.string().optional(),
        enabled: z.boolean(),
        schedule: cronScheduleSchema,
        sessionTarget: z.string().optional(),
        wakeMode: z.string().optional(),
        payload: cronPayloadSchema.optional(),
        state: cronStateSchema.optional(),
    })
    .passthrough()

const cronListResultSchema = z
    .object({
        jobs: z.array(cronJobSchema),
        total: z.number().optional(),
        offset: z.number().optional(),
        limit: z.number().optional(),
    })
    .passthrough()

const cronRunResultSchema = z
    .object({
        ok: z.boolean(),
        ran: z.boolean().optional(),
        reason: z.string().optional(),
    })
    .passthrough()

const cronRemoveResultSchema = z
    .object({
        removed: z.boolean(),
    })
    .passthrough()

const cronRunsEntrySchema = z
    .object({
        ts: z.number(),
        jobId: z.string().min(1),
        status: z.string().optional(),
        summary: z.string().optional(),
        error: z.string().optional(),
        sessionId: z.string().optional(),
        sessionKey: z.string().optional(),
        runAtMs: z.number().optional(),
        durationMs: z.number().optional(),
        nextRunAtMs: z.number().optional(),
        model: z.string().optional(),
        provider: z.string().optional(),
    })
    .passthrough()

const cronRunsResultSchema = z
    .object({
        entries: z.array(cronRunsEntrySchema),
        total: z.number().optional(),
        offset: z.number().optional(),
        limit: z.number().optional(),
    })
    .passthrough()

const runtimeFileMetadataSchema = z
    .object({
        roomId: z.string().min(1),
        port: z.number(),
        pid: z.number().nullable().optional(),
        startedAt: z.string().optional(),
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
        gateway: z
            .object({
                bind: z.string().optional(),
                port: z.number().optional(),
            })
            .partial()
            .optional(),
        agents: z
            .object({
                defaults: z
                    .object({
                        workspace: z.string().optional(),
                    })
                    .partial()
                    .optional(),
            })
            .partial()
            .optional(),
    })
    .passthrough()

const GATEWAY_CLIENT_ID = 'gateway-client'
const GATEWAY_CLIENT_MODE = 'backend'
const GATEWAY_CLIENT_DISPLAY_NAME = 'agent-room'
const GATEWAY_CLIENT_VERSION = 'agent-room'
const GATEWAY_OPERATOR_ROLE = 'operator'
const GATEWAY_OPERATOR_SCOPES = ['operator.admin', 'operator.read', 'operator.write'] as const
const GATEWAY_TOOL_EVENTS_CAP = 'tool-events'
const GATEWAY_MAX_LIST_LIMIT = 200
const ROOM_STREAM_KEEPALIVE_MS = 15_000
const ROOM_STREAM_BACKPRESSURE_LIMIT = -64
const OPENCLAW_GATEWAY_RUNTIME_MODULE_PATH =
    '/usr/lib/node_modules/openclaw/dist/plugin-sdk/gateway-runtime.js'
const sseTextEncoder = new TextEncoder()

interface GatewayRequestOptions {
    expectFinal?: boolean
    timeoutMs?: number | null
}

interface GatewayEventFrame {
    type: 'event'
    event: string
    payload?: unknown
    seq?: number
    stateVersion?: unknown
}

interface GatewayRuntimeClient {
    request: <T = unknown>(
        method: string,
        params?: unknown,
        opts?: GatewayRequestOptions,
    ) => Promise<T>
    start: () => void
    stop: () => void
    stopAndWait?: (opts?: { timeoutMs?: number }) => Promise<void>
}

interface GatewayRuntimeClientConstructor {
    new (options: GatewayRuntimeClientOptions): GatewayRuntimeClient
}

interface GatewayRuntimeModule {
    GatewayClient: GatewayRuntimeClientConstructor
}

interface GatewayRuntimeClientOptions {
    url: string
    token: string
    clientName: string
    clientDisplayName: string
    clientVersion: string
    platform: string
    mode: string
    role: string
    scopes: string[]
    caps?: string[]
    onHelloOk: (hello: unknown) => void
    onConnectError: (error: Error) => void
    onClose: (code: number, reason: string) => void
    onEvent?: (event: GatewayEventFrame) => void
}

let openClawGatewayRuntimeModulePromise: Promise<GatewayRuntimeModule> | null = null

function buildGatewayRuntimeClientSpec(input: {
    port: number
    token: string
    caps?: string[]
    onEvent?: (event: GatewayEventFrame) => void
}) {
    return {
        url: `ws://127.0.0.1:${input.port}`,
        token: input.token,
        clientName: GATEWAY_CLIENT_ID,
        clientDisplayName: GATEWAY_CLIENT_DISPLAY_NAME,
        clientVersion: GATEWAY_CLIENT_VERSION,
        platform: process.platform,
        mode: GATEWAY_CLIENT_MODE,
        role: GATEWAY_OPERATOR_ROLE,
        scopes: [...GATEWAY_OPERATOR_SCOPES],
        caps: input.caps ?? [],
        onEvent: input.onEvent,
    }
}

class OpenClawGatewayClient {
    private readonly client: GatewayRuntimeClient
    private closed = false

    private constructor(client: GatewayRuntimeClient) {
        this.client = client
    }

    static async connect(
        input: {
            port: number
            token: string
            caps?: string[]
            onEvent?: (event: GatewayEventFrame) => void
        },
        deps: {
            createRuntimeClient?: (input: {
                port: number
                token: string
                caps?: string[]
                onEvent?: (event: GatewayEventFrame) => void
            }) => Promise<GatewayRuntimeClient>
        } = {},
    ): Promise<OpenClawGatewayClient> {
        const client = await (deps.createRuntimeClient ?? createOpenClawGatewayRuntimeClient)(input)
        return new OpenClawGatewayClient(client)
    }

    async request<T>(
        method: string,
        params: Record<string, unknown>,
        schema: z.ZodType<T>,
    ): Promise<T> {
        const payload = await this.client.request(method, params)
        return schema.parse(payload)
    }

    async requestRaw(
        method: string,
        params: Record<string, unknown>,
        opts?: GatewayRequestOptions,
    ): Promise<unknown> {
        if (this.closed) {
            throw new Error(`Gateway websocket is not open for ${method}`)
        }
        if (opts === undefined) {
            return this.client.request(method, params)
        }
        return this.client.request(method, params, opts)
    }

    async close(): Promise<void> {
        if (this.closed) {
            return
        }

        this.closed = true
        if (typeof this.client.stopAndWait === 'function') {
            await this.client.stopAndWait({
                timeoutMs: 1_000,
            })
            return
        }

        this.client.stop()
    }
}

async function loadOpenClawGatewayRuntimeModule(): Promise<GatewayRuntimeModule> {
    openClawGatewayRuntimeModulePromise ??= import(
        pathToFileURL(OPENCLAW_GATEWAY_RUNTIME_MODULE_PATH).href
    ) as Promise<GatewayRuntimeModule>

    return openClawGatewayRuntimeModulePromise
}

async function createOpenClawGatewayRuntimeClient(input: {
    port: number
    token: string
    caps?: string[]
    onEvent?: (event: GatewayEventFrame) => void
}): Promise<GatewayRuntimeClient> {
    const { GatewayClient } = await loadOpenClawGatewayRuntimeModule()
    const options = buildGatewayRuntimeClientSpec(input)

    return await new Promise<GatewayRuntimeClient>((resolve, reject) => {
        let settled = false

        const finish = (error?: Error, client?: GatewayRuntimeClient) => {
            if (settled) {
                return
            }

            settled = true

            if (error) {
                if (client) {
                    client.stop()
                }
                reject(error)
                return
            }

            if (!client) {
                reject(new Error('OpenClaw gateway client resolved without a client instance'))
                return
            }

            resolve(client)
        }

        const client = new GatewayClient({
            ...options,
            onHelloOk: () => {
                finish(undefined, client)
            },
            onConnectError: (error) => {
                finish(error, client)
            },
            onClose: (code, reason) => {
                finish(
                    new Error(
                        `Gateway websocket closed during connect: code=${code} reason=${
                            reason || 'none'
                        }`,
                    ),
                    client,
                )
            },
            onEvent: input.onEvent,
        })

        client.start()
    })
}

function parseSessionAgentId(sessionKey: string, defaultAgentId: string): string {
    const trimmed = sessionKey.trim()
    if (!trimmed.startsWith('agent:')) {
        return defaultAgentId
    }

    const parts = trimmed.split(':')
    if (parts.length < 2 || !parts[1]) {
        return defaultAgentId
    }

    return parts[1]
}

function toDisplayTitle(thread: z.infer<typeof gatewaySessionSchema>): string {
    return (
        thread.derivedTitle ?? thread.displayName ?? thread.label ?? thread.sessionId ?? thread.key
    )
}

function formatCronSchedule(schedule: z.infer<typeof cronScheduleSchema>): string {
    if (schedule.kind === 'at') {
        return `at ${schedule.at}`
    }
    if (schedule.kind === 'every') {
        if (schedule.everyMs < 60_000) {
            return `every ${schedule.everyMs} ms`
        }
        if (schedule.everyMs < 3_600_000) {
            return `every ${Math.round(schedule.everyMs / 60_000)} min`
        }
        return `every ${Math.round(schedule.everyMs / 3_600_000)} h`
    }

    return schedule.tz ? `${schedule.expr} (${schedule.tz})` : schedule.expr
}

function formatCronPayload(payload: z.infer<typeof cronPayloadSchema> | undefined): string | null {
    if (!payload) {
        return null
    }
    if (payload.kind === 'systemEvent' && typeof payload.text === 'string') {
        return payload.text
    }
    if (payload.kind === 'agentTurn' && typeof payload.message === 'string') {
        return payload.message
    }
    if (typeof payload.message === 'string') {
        return payload.message
    }
    if (typeof payload.text === 'string') {
        return payload.text
    }
    return null
}

function mapCronJob(job: z.infer<typeof cronJobSchema>): RoomCronJob {
    return {
        id: job.id,
        agentId: job.agentId ?? null,
        sessionKey: job.sessionKey ?? null,
        name: job.name,
        description: job.description ?? null,
        enabled: job.enabled,
        sessionTarget: job.sessionTarget ?? null,
        wakeMode: job.wakeMode ?? null,
        scheduleSummary: formatCronSchedule(job.schedule),
        payloadSummary: formatCronPayload(job.payload),
        nextRunAt: toNullableNumber(job.state?.nextRunAtMs),
        runningAt: toNullableNumber(job.state?.runningAtMs),
        lastRunAt: toNullableNumber(job.state?.lastRunAtMs),
        lastRunStatus:
            typeof job.state?.lastRunStatus === 'string'
                ? job.state.lastRunStatus
                : typeof job.state?.lastStatus === 'string'
                  ? job.state.lastStatus
                  : null,
        lastError: job.state?.lastError ?? null,
        lastDurationMs: toNullableNumber(job.state?.lastDurationMs),
    }
}

function mapCronRunResult(payload: z.infer<typeof cronRunResultSchema>): {
    ran: boolean
    reason: string | null
} {
    const ran = payload.ran ?? payload.ok
    return {
        ran,
        reason: ran ? null : (payload.reason ?? 'Runtime did not return a block reason'),
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

async function readJsonFile<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
    try {
        const raw = await readFile(path, 'utf8')
        return schema.parse(JSON.parse(raw))
    } catch {
        return null
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
                    if (latestUpdateAt === null || updatedAt > latestUpdateAt) {
                        latestUpdateAt = updatedAt
                    }
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

function resolveOwnership(input: {
    effectiveAgentId: string | null
    sessionAgentId: string | null
}): 'owned' | 'mismatch' | 'unknown' {
    if (!input.effectiveAgentId || !input.sessionAgentId) {
        return 'unknown'
    }

    return input.effectiveAgentId === input.sessionAgentId ? 'owned' : 'mismatch'
}

function mapRunHistoryEntry(input: {
    entry: z.infer<typeof cronRunsEntrySchema>
    index: number
    job: z.infer<typeof cronJobSchema> | null
    defaultAgentId: string
}): RoomRunHistoryEntry {
    const effectiveAgentId = input.job?.agentId ?? input.defaultAgentId
    const resolvedSessionAgentId = input.entry.sessionKey
        ? parseSessionAgentId(input.entry.sessionKey, input.defaultAgentId)
        : null
    const ownership = resolveOwnership({
        effectiveAgentId,
        sessionAgentId: resolvedSessionAgentId,
    })

    return {
        id: `${input.entry.ts}-${input.entry.jobId}-${input.index + 1}`,
        ts: input.entry.ts,
        jobId: input.entry.jobId,
        jobName: input.job?.name ?? null,
        status: input.entry.status ?? null,
        summary: input.entry.summary ?? null,
        error: input.entry.error ?? null,
        sessionId: input.entry.sessionId ?? null,
        sessionKey: input.entry.sessionKey ?? null,
        declaredAgentId: input.job?.agentId ?? null,
        effectiveAgentId,
        resolvedSessionAgentId,
        ownership,
        durationMs: toNullableNumber(input.entry.durationMs),
        nextRunAtMs: toNullableNumber(input.entry.nextRunAtMs),
        model: input.entry.model ?? null,
        provider: input.entry.provider ?? null,
    }
}

async function listAgentIdsFromDisk(stateDirPath: string): Promise<string[]> {
    try {
        const agentsRoot = join(stateDirPath, 'agents')
        const entries = await readdir(agentsRoot, { withFileTypes: true })
        return entries
            .filter((entry) => entry.isDirectory() && entry.name.trim().length > 0)
            .map((entry) => entry.name)
            .sort((left, right) => left.localeCompare(right))
    } catch {
        return []
    }
}

function toNullableNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value
    }
    return null
}

function normalizeRole(value: unknown): RoomExecutionMessage['role'] {
    if (value === 'user' || value === 'assistant' || value === 'tool' || value === 'system') {
        return value
    }
    return 'other'
}

function mapMessages(rawMessages: unknown[]): RoomExecutionMessage[] {
    return rawMessages.map((item, index) => {
        const payload = toOpenClawMessagePayload(item)
        const timestampValue = payload.timestamp
        const parts = extractOpenClawMessageParts(item)
        return {
            id: typeof payload.id === 'string' ? payload.id : `message-${index + 1}`,
            role: normalizeRole(payload.role),
            text: extractOpenClawMessageText(item),
            parts,
            timestamp: toNullableNumber(timestampValue),
        }
    })
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

function mapRoomAgent(input: {
    agent: z.infer<typeof gatewayAgentSchema>
    threads: RoomExecutionThread[]
}): RoomExecutionAgent {
    const latestActivityAt = input.threads.reduce<number | null>((latest, thread) => {
        if (thread.updatedAt === null) {
            return latest
        }
        if (latest === null || thread.updatedAt > latest) {
            return thread.updatedAt
        }
        return latest
    }, null)

    return {
        id: input.agent.id,
        name: input.agent.name ?? null,
        workspace: input.agent.workspace ?? null,
        modelPrimary: input.agent.model?.primary ?? null,
        modelFallbacks: input.agent.model?.fallbacks ?? [],
        identity: {
            name: input.agent.identity?.name ?? null,
            theme: input.agent.identity?.theme ?? null,
            emoji: input.agent.identity?.emoji ?? null,
            avatarUrl: input.agent.identity?.avatarUrl ?? null,
        },
        threadCount: input.threads.length,
        activeThreadCount: input.threads.filter((thread) => thread.status === 'running').length,
        latestActivityAt,
    }
}

function resolveRoomBrain(input: {
    defaultAgentId: string
    agents: z.infer<typeof gatewayAgentSchema>[]
    threads: RoomExecutionThread[]
}): {
    roomAgent: RoomExecutionAgent | null
    extraAgentIds: string[]
} {
    const agentsById = new Map(input.agents.map((agent) => [agent.id, agent]))
    const roomAgentSource =
        agentsById.get(input.defaultAgentId) ??
        input.agents[0] ??
        ({
            id: input.defaultAgentId,
        } satisfies z.infer<typeof gatewayAgentSchema>)

    const roomThreads = input.threads.filter((thread) => thread.agentId === roomAgentSource.id)
    const extraAgentIds = [
        ...new Set(
            [
                ...input.agents.map((agent) => agent.id),
                ...input.threads.map((thread) => thread.agentId),
            ].filter((agentId) => agentId !== roomAgentSource.id),
        ),
    ].sort((left, right) => left.localeCompare(right))

    return {
        roomAgent: roomAgentSource
            ? mapRoomAgent({ agent: roomAgentSource, threads: roomThreads })
            : null,
        extraAgentIds,
    }
}

async function getRuntimeToken(roomId: string): Promise<string> {
    const paths = getRoomPaths(roomId)
    const rawToken = await readFile(paths.runtimeTokenPath, 'utf8')
    const token = rawToken.trim()
    if (token.length < 24) {
        throw new Error(`Room ${roomId} runtime token is missing or invalid`)
    }
    return token
}

async function connectGatewayClientForRoom(
    roomId: string,
    options: {
        caps?: string[]
        onEvent?: (event: GatewayEventFrame) => void
    } = {},
): Promise<{
    room: Awaited<ReturnType<typeof roomRepository.findRoomById>>
    runtimeMetadata: RoomRuntimeMetadataRecord
    client: OpenClawGatewayClient
}> {
    const room = await roomRepository.findRoomById(roomId)
    if (!room) {
        throw new Error(`Room ${roomId} does not exist`)
    }

    const runtimeMetadata = await roomRuntimeMetadataRepository.findByRoomId(roomId)
    if (!runtimeMetadata || runtimeMetadata.port === null) {
        throw new Error(`Room ${roomId} has no active runtime endpoint`)
    }

    const token = await getRuntimeToken(roomId)
    const client = await OpenClawGatewayClient.connect({
        port: runtimeMetadata.port,
        token,
        caps: options.caps,
        onEvent: options.onEvent,
    })

    return {
        room,
        runtimeMetadata,
        client,
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

function buildRoomExecutionCapabilities(connected: boolean) {
    return {
        canStreamTokens: connected,
        canStreamToolEvents: connected,
        canAbortGeneration: connected,
        canEditMessages: false,
        editMessageUnsupportedReason:
            'OpenClaw exposes session metadata patch, reset, delete, and compact operations, but no safe per-message edit RPC.',
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
            message: 'Room runtime has no allocated gateway endpoint',
        })
    }

    if (room.status !== 'running' && room.status !== 'degraded') {
        return emptySnapshot({
            room: roomOverview,
            state: 'unavailable',
            message: `Room is ${room.status}. Start the runtime to load threads and chat`,
        })
    }

    let client: OpenClawGatewayClient | null = null

    try {
        const token = await getRuntimeToken(input.roomId)
        client = await OpenClawGatewayClient.connect({
            port: runtimeMetadata.port,
            token,
        })

        const agentsResult = await client.request('agents.list', {}, agentsListResultSchema)
        const sessionsResult = await client.request(
            'sessions.list',
            {
                includeDerivedTitles: true,
                includeLastMessage: true,
                limit: GATEWAY_MAX_LIST_LIMIT,
            },
            sessionsListResultSchema,
        )

        const sessionsSorted = [...sessionsResult.sessions].sort(
            (left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0),
        )

        const allThreads = sessionsSorted.map((session) => {
            const agentId = parseSessionAgentId(session.key, agentsResult.defaultId)
            return {
                key: session.key,
                sessionId: session.sessionId ?? null,
                agentId,
                title: toDisplayTitle(session),
                lastMessagePreview: session.lastMessagePreview ?? null,
                status: session.status ?? null,
                updatedAt: toNullableNumber(session.updatedAt),
                runtimeMs: toNullableNumber(session.runtimeMs),
                model: session.model ?? null,
                modelProvider: session.modelProvider ?? null,
                totalTokens: toNullableNumber(session.totalTokens),
                estimatedCostUsd: toNullableNumber(session.estimatedCostUsd),
            }
        })
        const { roomAgent, extraAgentIds } = resolveRoomBrain({
            defaultAgentId: agentsResult.defaultId,
            agents: agentsResult.agents,
            threads: allThreads,
        })
        const roomThreads = roomAgent
            ? allThreads.filter((thread) => thread.agentId === roomAgent.id)
            : []

        const selectedThreadKey =
            input.selectedThreadKey &&
            roomThreads.some((thread) => thread.key === input.selectedThreadKey)
                ? input.selectedThreadKey
                : (roomThreads[0]?.key ?? null)

        let selectedThreadMessages: RoomExecutionMessage[] = []

        if (selectedThreadKey) {
            const messageLimit =
                input.messageLimit && Number.isFinite(input.messageLimit)
                    ? Math.max(1, Math.floor(input.messageLimit))
                    : 200

            const sessionPayload = await client.request(
                'sessions.get',
                {
                    key: selectedThreadKey,
                    limit: messageLimit,
                },
                sessionsGetResultSchema,
            )

            selectedThreadMessages = mapMessages(sessionPayload.messages)
        }

        const recentActivity: RoomExecutionActivity[] = sessionsSorted
            .slice(0, 30)
            .map((session) => {
                const agentId = parseSessionAgentId(session.key, agentsResult.defaultId)
                return {
                    key: session.key,
                    agentId,
                    title: toDisplayTitle(session),
                    status: session.status ?? null,
                    updatedAt: toNullableNumber(session.updatedAt),
                    runtimeMs: toNullableNumber(session.runtimeMs),
                    totalTokens: toNullableNumber(session.totalTokens),
                    estimatedCostUsd: toNullableNumber(session.estimatedCostUsd),
                }
            })
            .filter((entry) => (roomAgent ? entry.agentId === roomAgent.id : true))

        return {
            room: roomOverview,
            executionState: 'connected',
            executionMessage: null,
            capabilities: buildRoomExecutionCapabilities(true),
            roomAgent,
            extraAgentIds,
            threads: roomThreads,
            selectedThreadKey,
            selectedThreadMessages,
            recentActivity,
        }
    } catch (error) {
        return emptySnapshot({
            room: roomOverview,
            state: 'error',
            message: error instanceof Error ? error.message : 'Unknown gateway adapter error',
        })
    } finally {
        if (client) {
            await client.close()
        }
    }
}

export async function sendRoomThreadMessage(input: {
    roomId: string
    sessionKey: string
    message: string
}): Promise<RoomThreadSendResult> {
    const message = input.message.trim()
    if (!message) {
        throw new Error('Message cannot be empty')
    }

    const { client } = await connectGatewayClientForRoom(input.roomId)
    try {
        const payload = sessionsSendResultSchema.parse(
            await client.requestRaw(
                'sessions.send',
                {
                    key: input.sessionKey,
                    message,
                    idempotencyKey: randomUUID(),
                },
                {
                    expectFinal: false,
                    timeoutMs: 15_000,
                },
            ),
        )

        return {
            runId: payload.runId ?? null,
            status: payload.status ?? 'accepted',
            messageSeq: toNullableNumber(payload.messageSeq),
            interruptedActiveRun: payload.interruptedActiveRun === true,
        }
    } finally {
        await client.close()
    }
}

export async function abortRoomThreadMessage(input: {
    roomId: string
    sessionKey: string
    runId?: string | null
}): Promise<RoomThreadAbortResult> {
    const { client } = await connectGatewayClientForRoom(input.roomId)
    try {
        const payload = await client.request(
            'sessions.abort',
            {
                key: input.sessionKey,
                ...(input.runId ? { runId: input.runId } : {}),
            },
            sessionsAbortResultSchema,
        )

        return {
            abortedRunId: payload.abortedRunId ?? null,
            status: payload.status ?? (payload.abortedRunId ? 'aborted' : 'no-active-run'),
        }
    } finally {
        await client.close()
    }
}

export async function editRoomThreadMessage(_input: {
    roomId: string
    sessionKey: string
    messageId: string
    message: string
}): Promise<never> {
    throw new Error(
        'OpenClaw does not expose a safe per-message edit operation through the Gateway. Create a new session, reset the session, or use OpenClaw-supported session operations instead.',
    )
}

function encodeSseEvent(event: string, data: unknown): Uint8Array {
    return sseTextEncoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
}

function readEventSessionKey(payload: unknown): string | null {
    if (!isRecord(payload)) {
        return null
    }

    const value = payload.sessionKey
    return typeof value === 'string' && value.trim() ? value : null
}

function shouldForwardSessionEvent(event: GatewayEventFrame, sessionKey: string): boolean {
    if (
        event.event !== 'chat' &&
        event.event !== 'agent' &&
        event.event !== 'session.message' &&
        event.event !== 'session.tool' &&
        event.event !== 'sessions.changed'
    ) {
        return false
    }

    return readEventSessionKey(event.payload) === sessionKey
}

function toRoomRealtimeEvent(event: GatewayEventFrame): RoomRealtimeEvent {
    return {
        event: event.event,
        payload: event.payload ?? null,
        seq: typeof event.seq === 'number' ? event.seq : null,
        stateVersion: event.stateVersion ?? null,
        receivedAt: Date.now(),
    }
}

function assertSessionBelongsToRoom(input: {
    sessionKey: string
    defaultAgentId: string
    agents: z.infer<typeof gatewayAgentSchema>[]
    sessions: z.infer<typeof gatewaySessionSchema>[]
}) {
    const session = input.sessions.find((entry) => entry.key === input.sessionKey)
    if (!session) {
        throw new Error(`Session ${input.sessionKey} does not exist in this room runtime`)
    }

    const allThreads = input.sessions.map((entry) => {
        const agentId = parseSessionAgentId(entry.key, input.defaultAgentId)
        return {
            key: entry.key,
            sessionId: entry.sessionId ?? null,
            agentId,
            title: toDisplayTitle(entry),
            lastMessagePreview: entry.lastMessagePreview ?? null,
            status: entry.status ?? null,
            updatedAt: toNullableNumber(entry.updatedAt),
            runtimeMs: toNullableNumber(entry.runtimeMs),
            model: entry.model ?? null,
            modelProvider: entry.modelProvider ?? null,
            totalTokens: toNullableNumber(entry.totalTokens),
            estimatedCostUsd: toNullableNumber(entry.estimatedCostUsd),
        }
    })
    const { roomAgent } = resolveRoomBrain({
        defaultAgentId: input.defaultAgentId,
        agents: input.agents,
        threads: allThreads,
    })
    const sessionAgentId = parseSessionAgentId(input.sessionKey, input.defaultAgentId)
    if (roomAgent && sessionAgentId !== roomAgent.id) {
        throw new Error(`Session ${input.sessionKey} is not owned by the room brain`)
    }
}

export function createRoomSessionEventStream(input: {
    roomId: string
    sessionKey: string
    abortSignal?: AbortSignal
}): ReadableStream<Uint8Array> {
    let client: OpenClawGatewayClient | null = null
    let heartbeat: NodeJS.Timeout | null = null
    let closed = false
    let subscribedSessionKey = input.sessionKey

    return new ReadableStream<Uint8Array>({
        start(controller) {
            const close = async () => {
                if (closed) {
                    return
                }

                closed = true
                if (heartbeat) {
                    clearInterval(heartbeat)
                    heartbeat = null
                }
                input.abortSignal?.removeEventListener('abort', onAbort)
                if (client) {
                    await client.close()
                    client = null
                }
                try {
                    controller.close()
                } catch {}
            }

            const enqueue = (event: string, payload: unknown) => {
                if (closed) {
                    return
                }
                if (
                    typeof controller.desiredSize === 'number' &&
                    controller.desiredSize < ROOM_STREAM_BACKPRESSURE_LIMIT
                ) {
                    controller.enqueue(
                        encodeSseEvent('stream-error', {
                            message: 'Browser stream consumer is too far behind',
                        }),
                    )
                    void close()
                    return
                }
                controller.enqueue(encodeSseEvent(event, payload))
            }

            const onAbort = () => {
                void close()
            }

            const run = async () => {
                try {
                    if (input.abortSignal?.aborted) {
                        await close()
                        return
                    }

                    const connected = await connectGatewayClientForRoom(input.roomId, {
                        caps: [GATEWAY_TOOL_EVENTS_CAP],
                        onEvent: (event) => {
                            if (shouldForwardSessionEvent(event, subscribedSessionKey)) {
                                enqueue('room-event', toRoomRealtimeEvent(event))
                            }
                        },
                    })
                    client = connected.client

                    const agentsResult = await client.request(
                        'agents.list',
                        {},
                        agentsListResultSchema,
                    )
                    const sessionsResult = await client.request(
                        'sessions.list',
                        {
                            includeDerivedTitles: true,
                            includeLastMessage: true,
                            limit: GATEWAY_MAX_LIST_LIMIT,
                        },
                        sessionsListResultSchema,
                    )

                    assertSessionBelongsToRoom({
                        sessionKey: input.sessionKey,
                        defaultAgentId: agentsResult.defaultId,
                        agents: agentsResult.agents,
                        sessions: sessionsResult.sessions,
                    })

                    const messageSubscription = await client.request(
                        'sessions.messages.subscribe',
                        {
                            key: input.sessionKey,
                        },
                        sessionsMessagesSubscribeResultSchema,
                    )
                    subscribedSessionKey = messageSubscription.key

                    await client.request('sessions.subscribe', {}, sessionsSubscribeResultSchema)

                    enqueue('ready', {
                        roomId: input.roomId,
                        sessionKey: subscribedSessionKey,
                        subscribed: messageSubscription.subscribed,
                    })

                    heartbeat = setInterval(() => {
                        enqueue('heartbeat', {
                            ts: Date.now(),
                        })
                    }, ROOM_STREAM_KEEPALIVE_MS)
                    heartbeat.unref?.()
                } catch (error) {
                    enqueue('stream-error', {
                        message: error instanceof Error ? error.message : 'Room stream failed',
                    })
                    await close()
                }
            }

            input.abortSignal?.addEventListener('abort', onAbort, { once: true })
            void run()
        },
        cancel() {
            if (heartbeat) {
                clearInterval(heartbeat)
                heartbeat = null
            }
            if (client) {
                void client.close()
                client = null
            }
            closed = true
        },
    })
}

export async function createRoomThread(input: {
    roomId: string
    firstMessage?: string | null
}): Promise<{ key: string }> {
    const firstMessage = input.firstMessage?.trim()
    const { client } = await connectGatewayClientForRoom(input.roomId)
    try {
        const agentsResult = await client.request('agents.list', {}, agentsListResultSchema)
        const payload = await client.request(
            'sessions.create',
            {
                agentId: agentsResult.defaultId,
                ...(firstMessage ? { message: firstMessage } : {}),
            },
            sessionsCreateResultSchema,
        )

        return {
            key: payload.key,
        }
    } finally {
        await client.close()
    }
}

export async function listRoomCronJobs(input: {
    roomId: string
    limit?: number
}): Promise<RoomCronJob[]> {
    const limit =
        input.limit && Number.isFinite(input.limit) ? Math.max(1, Math.floor(input.limit)) : 200

    const { client } = await connectGatewayClientForRoom(input.roomId)
    try {
        const payload = await client.request(
            'cron.list',
            {
                includeDisabled: true,
                limit,
                offset: 0,
                enabled: 'all',
                sortBy: 'nextRunAtMs',
                sortDir: 'asc',
            },
            cronListResultSchema,
        )

        return payload.jobs.map((job) => mapCronJob(job))
    } finally {
        await client.close()
    }
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

    const everyMs = Math.floor(input.everyMinutes) * 60_000
    if (everyMs <= 0) {
        throw new Error('Cron job interval resolved to an invalid duration')
    }

    const { client } = await connectGatewayClientForRoom(input.roomId)
    try {
        const agentsResult = await client.request('agents.list', {}, agentsListResultSchema)
        const payload = await client.request(
            'cron.add',
            {
                name,
                enabled: true,
                schedule: {
                    kind: 'every',
                    everyMs,
                },
                sessionTarget: 'isolated',
                wakeMode: 'now',
                payload: {
                    kind: 'agentTurn',
                    message,
                },
                delivery: {
                    mode: 'none',
                },
                agentId: agentsResult.defaultId,
            },
            cronJobSchema,
        )

        return mapCronJob(payload)
    } finally {
        await client.close()
    }
}

export async function updateRoomCronJobEnabled(input: {
    roomId: string
    jobId: string
    enabled: boolean
}): Promise<RoomCronJob> {
    const { client } = await connectGatewayClientForRoom(input.roomId)
    try {
        const payload = await client.request(
            'cron.update',
            {
                id: input.jobId,
                patch: {
                    enabled: input.enabled,
                },
            },
            cronJobSchema,
        )

        return mapCronJob(payload)
    } finally {
        await client.close()
    }
}

export async function runRoomCronJobNow(input: {
    roomId: string
    jobId: string
}): Promise<{ ran: boolean; reason: string | null }> {
    const { client } = await connectGatewayClientForRoom(input.roomId)
    try {
        const payload = await client.request(
            'cron.run',
            {
                id: input.jobId,
                mode: 'force',
            },
            cronRunResultSchema,
        )

        return mapCronRunResult(payload)
    } finally {
        await client.close()
    }
}

export async function removeRoomCronJob(input: { roomId: string; jobId: string }): Promise<void> {
    const { client } = await connectGatewayClientForRoom(input.roomId)
    try {
        const payload = await client.request(
            'cron.remove',
            {
                id: input.jobId,
            },
            cronRemoveResultSchema,
        )

        if (!payload.removed) {
            throw new Error(`Cron job ${input.jobId} was not removed`)
        }
    } finally {
        await client.close()
    }
}

export async function wakeRoomRuntime(input: {
    roomId: string
    text: string
    mode: 'now' | 'next-heartbeat'
}): Promise<void> {
    const text = input.text.trim()
    if (!text) {
        throw new Error('Wake trigger text cannot be empty')
    }

    const { client } = await connectGatewayClientForRoom(input.roomId)
    try {
        await client.requestRaw('wake', {
            mode: input.mode,
            text,
        })
    } finally {
        await client.close()
    }
}

export async function getRoomExecutionTruthSnapshot(input: {
    roomId: string
}): Promise<RoomExecutionTruthSnapshot> {
    const room = await roomRepository.findRoomById(input.roomId)
    if (!room) {
        throw new Error(`Room ${input.roomId} does not exist`)
    }

    const paths = getRoomPaths(input.roomId)

    const [runtimeMetadataFile, runtimeHealthFile, runtimeConfigFile, diskAgentIds] =
        await Promise.all([
            readJsonFile(paths.runtimeMetadataPath, runtimeFileMetadataSchema),
            readJsonFile(paths.runtimeHealthPath, runtimeHealthFileSchema),
            readJsonFile(paths.runtimeConfigPath, runtimeConfigFileSchema),
            listAgentIdsFromDisk(paths.engineStateDir),
        ])

    const gatewayWorkspaceByAgent = new Map<string, string | null>()
    try {
        const { client } = await connectGatewayClientForRoom(input.roomId)
        try {
            const agentsResult = await client.request('agents.list', {}, agentsListResultSchema)
            for (const agent of agentsResult.agents) {
                gatewayWorkspaceByAgent.set(agent.id, agent.workspace ?? null)
            }
        } finally {
            await client.close()
        }
    } catch {
        gatewayWorkspaceByAgent.clear()
    }

    const allAgentIds = new Set<string>([...diskAgentIds, ...gatewayWorkspaceByAgent.keys()])
    const orderedAgentIds = [...allAgentIds].sort((left, right) => left.localeCompare(right))

    const agents: RoomAgentExecutionTruth[] = []
    for (const agentId of orderedAgentIds) {
        const memoryPath = join(paths.engineStateDir, 'agents', agentId, 'agent')
        const sessionsPath = join(paths.engineStateDir, 'agents', agentId, 'sessions')
        const [memoryExists, sessionsExists, sessionsSnapshot] = await Promise.all([
            fileExists(memoryPath),
            fileExists(sessionsPath),
            collectSessionDirSnapshot(sessionsPath),
        ])

        agents.push({
            agentId,
            workspacePath:
                gatewayWorkspaceByAgent.get(agentId) ??
                runtimeConfigFile?.agents?.defaults?.workspace ??
                null,
            memoryPath,
            sessionsPath,
            memoryExists,
            sessionsExists,
            sessionFileCount: sessionsSnapshot.count,
            latestSessionUpdateAt: sessionsSnapshot.latestUpdateAt,
        })
    }

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
                  bind: runtimeConfigFile.gateway?.bind ?? null,
                  port: toNullableNumber(runtimeConfigFile.gateway?.port),
                  workspace: runtimeConfigFile.agents?.defaults?.workspace ?? null,
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

    const { client } = await connectGatewayClientForRoom(input.roomId)
    try {
        const [agentsResult, cronJobsResult, cronRunsResult] = await Promise.all([
            client.request('agents.list', {}, agentsListResultSchema),
            client.request(
                'cron.list',
                {
                    includeDisabled: true,
                    limit: GATEWAY_MAX_LIST_LIMIT,
                    offset: 0,
                    enabled: 'all',
                    sortBy: 'updatedAtMs',
                    sortDir: 'desc',
                },
                cronListResultSchema,
            ),
            client.request(
                'cron.runs',
                {
                    scope: 'all',
                    limit,
                    offset: 0,
                    sortDir: 'desc',
                },
                cronRunsResultSchema,
            ),
        ])

        const jobsById = new Map(cronJobsResult.jobs.map((job) => [job.id, job]))
        const entries = cronRunsResult.entries.map((entry, index) =>
            mapRunHistoryEntry({
                entry,
                index,
                job: jobsById.get(entry.jobId) ?? null,
                defaultAgentId: agentsResult.defaultId,
            }),
        )

        return {
            roomId: input.roomId,
            mismatchCount: entries.filter((entry) => entry.ownership === 'mismatch').length,
            entries,
        }
    } finally {
        await client.close()
    }
}

export const __testing = {
    buildGatewayRuntimeClientSpec,
    connectGatewayClient: async (
        input: {
            port: number
            token: string
            caps?: string[]
            onEvent?: (event: GatewayEventFrame) => void
        },
        deps: {
            createRuntimeClient?: (input: {
                port: number
                token: string
                caps?: string[]
                onEvent?: (event: GatewayEventFrame) => void
            }) => Promise<GatewayRuntimeClient>
        } = {},
    ) => {
        const client = await OpenClawGatewayClient.connect(input, deps)
        return {
            requestRaw: (method: string, params: Record<string, unknown>) =>
                client.requestRaw(method, params),
            close: () => client.close(),
        }
    },
    parseSessionAgentId,
    resolveRoomBrain,
    mapMessages,
    extractOpenClawMessageText,
    normalizeRole,
    formatCronSchedule,
    formatCronPayload,
    mapCronJob,
    mapCronRunResult,
    resolveOwnership,
    mapRunHistoryEntry,
}
