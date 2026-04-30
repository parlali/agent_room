import { randomUUID, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { dirname } from 'node:path'
import {
    AuthStorage,
    createAgentSession,
    defineTool,
    ModelRegistry,
    SessionManager,
    SettingsManager,
    type AgentSession,
    type AgentSessionEvent,
    type SessionEntry,
    type ToolDefinition,
} from '@mariozechner/pi-coding-agent'
import { Type } from '@mariozechner/pi-ai'
import {
    emptyRuntimePart,
    extractTextFromRuntimeContent,
    normalizeRuntimeRole,
    toRuntimeSerializable,
} from '#/lib/runtime-message'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import type {
    RoomExecutionActivity,
    RoomExecutionAgent,
    RoomExecutionMessage,
    RoomExecutionMessagePart,
    RoomExecutionThread,
} from '../rooms/execution-types'
import type {
    PiRuntimeAbortPayload,
    PiRuntimeSendPayload,
    PiRuntimeSnapshotPayload,
    PiRuntimeThreadCreatePayload,
} from './protocol'
import { createPiResourceLoader } from './resource-loader'
import { closeMcpConnections, createMcpTools } from './mcp-bridge'
import { ensureInternalState } from './internal-state'
import { createInternalStateTools } from './internal-state-tools'
import { createRoomTools } from './room-tools'
import { buildAgentRoomSystemPrompt } from './system-prompt'
import { selectSnapshotThreadKey } from './snapshot-selection'

interface ThreadRecord {
    key: string
    sessionFile: string
    sessionId: string
    title: string
    status: string
    createdAt: number
    updatedAt: number
    lastMessagePreview: string | null
    modelProvider: string | null
    model: string | null
    activeRunId: string | null
    lastError: string | null
}

interface ThreadIndexFile {
    version: 1
    threads: ThreadRecord[]
}

interface ActiveThread {
    session: AgentSession
    unsubscribe: (() => void) | null
    queue: Promise<void>
}

const configPath = process.env.AGENT_ROOM_PI_RUNTIME_CONFIG_PATH
if (!configPath) {
    throw new Error('AGENT_ROOM_PI_RUNTIME_CONFIG_PATH is required')
}

const config = JSON.parse(await readFile(configPath, 'utf8')) as PiRuntimeConfig
const activeThreads = new Map<string, ActiveThread>()
const subscribers = new Map<string, Set<ReadableStreamDefaultController<Uint8Array>>>()
const subagentThreadKeys = new Set<string>()
const threadIndex = await readJsonFile<ThreadIndexFile>(config.paths.threadIndexPath, {
    version: 1,
    threads: [],
})
let eventSeq = 0

const maxRedactedStringChars = 4000
const maxRedactedArrayItems = 100
const maxRedactedObjectKeys = 100
const maxSubagentTaskChars = 24000

await ensureRuntimeLayout()
await writeJsonFile(config.paths.modelsPath, config.models)
const mcpTools = await createMcpTools({
    servers: config.mcpServers,
    cwd: config.paths.workspaceDir,
})
let systemPrompt = await buildAgentRoomSystemPrompt(config)

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNotFoundError(error: unknown): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        String((error as { code: unknown }).code) === 'ENOENT'
    )
}

async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
    try {
        return JSON.parse(await readFile(path, 'utf8')) as T
    } catch (error) {
        if (isNotFoundError(error)) {
            return fallback
        }
        throw new Error(`Failed to read runtime JSON file ${path}`)
    }
}

function isSensitiveEnvKey(key: string): boolean {
    return /TOKEN|SECRET|KEY|AUTH|PASSWORD|CREDENTIAL/i.test(key)
}

function bearerTokenParts(value: string): string[] {
    const match = value.match(/^Bearer\s+(.+)$/i)
    return match ? [value, match[1]!] : [value]
}

function redactionSecrets(): string[] {
    const values: string[] = [config.runtime.token]
    for (const server of config.mcpServers) {
        for (const value of [...Object.values(server.env), ...Object.values(server.headers)]) {
            values.push(...bearerTokenParts(value))
        }
    }
    for (const [key, value] of Object.entries(process.env)) {
        if (value && isSensitiveEnvKey(key)) {
            values.push(value)
        }
    }
    return [...new Set(values.filter((value) => value.trim().length >= 6))].sort(
        (left, right) => right.length - left.length,
    )
}

function boundRuntimeString(value: string): string {
    if (value.length <= maxRedactedStringChars) {
        return value
    }
    return `${value.slice(0, maxRedactedStringChars)}...[truncated]`
}

function redactString(value: string): string {
    let output = value
    for (const secret of redactionSecrets()) {
        output = output.replaceAll(secret, '[redacted]')
    }
    return boundRuntimeString(output)
}

function redactPayload(value: unknown, depth = 0): unknown {
    if (typeof value === 'string') {
        return redactString(value)
    }
    if (
        value === null ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        value === undefined
    ) {
        return value ?? null
    }
    if (depth > 8) {
        return '[truncated]'
    }
    if (Array.isArray(value)) {
        return value.slice(0, maxRedactedArrayItems).map((entry) => redactPayload(entry, depth + 1))
    }
    if (isRecord(value)) {
        const output: Record<string, unknown> = {}
        for (const [key, entry] of Object.entries(value).slice(0, maxRedactedObjectKeys)) {
            output[key] = redactPayload(entry, depth + 1)
        }
        return output
    }
    return redactString(String(value))
}

function errorMessage(error: unknown): string {
    return redactString(error instanceof Error ? error.message : 'Unknown Pi runtime error')
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), {
        recursive: true,
        mode: 0o700,
    })
    const tempPath = `${path}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
    await writeFile(tempPath, JSON.stringify(value, null, 4), {
        encoding: 'utf8',
        mode: 0o600,
    })
    await rename(tempPath, path)
}

async function appendRuntimeEvent(event: string, payload: unknown): Promise<void> {
    await writeFile(
        config.paths.runtimeEventsPath,
        `${JSON.stringify({
            ts: Date.now(),
            event,
            payload: redactPayload(payload),
        })}\n`,
        {
            encoding: 'utf8',
            flag: 'a',
            mode: 0o600,
        },
    )
}

async function ensureRuntimeLayout(): Promise<void> {
    await Promise.all([
        mkdir(config.paths.stateDir, { recursive: true, mode: 0o700 }),
        mkdir(config.paths.sessionsDir, { recursive: true, mode: 0o700 }),
        mkdir(config.paths.internalStateDir, { recursive: true, mode: 0o700 }),
        mkdir(config.paths.workspaceDir, { recursive: true, mode: 0o700 }),
        mkdir(config.paths.storeDir, { recursive: true, mode: 0o700 }),
        mkdir(config.paths.homeDir, { recursive: true, mode: 0o700 }),
        mkdir(config.paths.tmpDir, { recursive: true, mode: 0o700 }),
    ])
    await ensureInternalState(config)
}

async function refreshSystemPrompt(active?: ActiveThread): Promise<void> {
    systemPrompt = await buildAgentRoomSystemPrompt(config)
    if (active) {
        await active.session.reload()
    }
}

function encodeSse(event: string, payload: unknown): Uint8Array {
    return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
}

function broadcast(sessionKey: string, event: string, payload: unknown): void {
    const targets = subscribers.get(sessionKey)
    if (!targets || targets.size === 0) {
        return
    }
    const redactedPayload = redactPayload(payload)
    const frame = encodeSse('room-event', {
        event,
        payload: redactedPayload,
        seq: ++eventSeq,
        stateVersion: threadIndex.threads.find((thread) => thread.key === sessionKey)?.updatedAt,
        receivedAt: Date.now(),
    })
    for (const controller of targets) {
        try {
            controller.enqueue(frame)
        } catch {
            targets.delete(controller)
        }
    }
}

function getRequestBody(request: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
        let body = ''
        request.on('data', (chunk) => {
            body += String(chunk)
            if (body.length > 1_000_000) {
                reject(new Error('Request body is too large'))
                request.destroy()
            }
        })
        request.on('end', () => {
            if (!body.trim()) {
                resolve(null)
                return
            }
            try {
                resolve(JSON.parse(body))
            } catch {
                reject(new Error('Request body is not valid JSON'))
            }
        })
        request.on('error', reject)
    })
}

function assertAuthorized(request: IncomingMessage): void {
    const expected = `Bearer ${config.runtime.token}`
    const received = request.headers.authorization ?? ''
    const expectedBytes = Buffer.from(expected)
    const receivedBytes = Buffer.from(received)
    const matches =
        expectedBytes.byteLength === receivedBytes.byteLength &&
        timingSafeEqual(expectedBytes, receivedBytes)
    if (!matches) {
        throw new HttpError(401, 'Invalid runtime token')
    }
}

class HttpError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message)
    }
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
    response.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
    })
    response.end(JSON.stringify(payload))
}

function sendError(response: ServerResponse, error: unknown): void {
    const status = error instanceof HttpError ? error.status : 500
    sendJson(response, status, { message: errorMessage(error) })
}

function shortText(value: string, length = 120): string {
    const trimmed = value.replace(/\s+/g, ' ').trim()
    return trimmed.length > length ? `${trimmed.slice(0, length - 3)}...` : trimmed
}

function textPart(text: string): RoomExecutionMessagePart {
    return emptyRuntimePart({
        type: 'text',
        text,
    })
}

function toolCallPart(
    block: Record<string, unknown>,
    completedToolCallIds: Set<string>,
): RoomExecutionMessagePart {
    const toolCallId = typeof block.id === 'string' ? block.id : null
    return emptyRuntimePart({
        type: 'tool_call',
        text: typeof block.name === 'string' ? block.name : '',
        toolName: typeof block.name === 'string' ? block.name : null,
        toolCallId,
        status: toolCallId && completedToolCallIds.has(toolCallId) ? 'complete' : 'running',
        input: toRuntimeSerializable(block.arguments ?? {}),
        rawType: 'toolCall',
    })
}

function toolResultPart(message: Record<string, unknown>): RoomExecutionMessagePart {
    const text = extractTextFromRuntimeContent(message.content)
    return emptyRuntimePart({
        type: 'tool_result',
        text,
        toolCallId: typeof message.toolCallId === 'string' ? message.toolCallId : null,
        toolName: typeof message.toolName === 'string' ? message.toolName : null,
        status: 'complete',
        result: toRuntimeSerializable(message.content ?? text),
        rawType: 'toolResult',
    })
}

function entryTimestamp(entry: SessionEntry): number | null {
    return Number.isFinite(Date.parse(entry.timestamp)) ? Date.parse(entry.timestamp) : null
}

function mapCompactionEntry(entry: SessionEntry, index: number): RoomExecutionMessage | null {
    if (entry.type !== 'compaction') {
        return null
    }
    const tokensBefore =
        typeof entry.tokensBefore === 'number' && Number.isFinite(entry.tokensBefore)
            ? entry.tokensBefore
            : null
    const text = tokensBefore
        ? `Context compacted after ${tokensBefore.toLocaleString()} tokens. Recent work and a summary were kept.`
        : 'Context compacted. Recent work and a summary were kept.'
    return {
        id: entry.id || `compaction-${index + 1}`,
        role: 'system',
        text,
        parts: [
            emptyRuntimePart({
                type: 'raw',
                text,
                status: 'complete',
                rawType: 'compaction',
                result: toRuntimeSerializable({
                    tokensBefore,
                }),
            }),
        ],
        timestamp: entryTimestamp(entry),
    }
}

function mapSessionEntry(
    entry: SessionEntry,
    index: number,
    completedToolCallIds: Set<string>,
): RoomExecutionMessage | null {
    const compaction = mapCompactionEntry(entry, index)
    if (compaction) {
        return compaction
    }
    if (entry.type !== 'message') {
        return null
    }
    const message = entry.message as unknown as Record<string, unknown>
    const role = normalizeRuntimeRole(message.role)
    if (role === 'tool') {
        const part = toolResultPart(message)
        return {
            id: entry.id || `message-${index + 1}`,
            role,
            text: part.text,
            parts: [part],
            timestamp: entryTimestamp(entry),
        }
    }
    const content = message.content
    const parts: RoomExecutionMessagePart[] = []
    if (Array.isArray(content)) {
        for (const block of content) {
            if (!isRecord(block)) {
                continue
            }
            if (block.type === 'text') {
                const text = extractTextFromRuntimeContent(block)
                if (text) {
                    parts.push(textPart(text))
                }
            } else if (block.type === 'thinking') {
                continue
            } else if (block.type === 'toolCall') {
                parts.push(toolCallPart(block, completedToolCallIds))
            } else {
                parts.push(
                    emptyRuntimePart({
                        rawType: typeof block.type === 'string' ? block.type : null,
                        input: toRuntimeSerializable(block),
                    }),
                )
            }
        }
    } else {
        const text = extractTextFromRuntimeContent(content)
        if (text) {
            parts.push(textPart(text))
        }
    }
    const text =
        extractTextFromRuntimeContent(content) ||
        (typeof message.errorMessage === 'string' ? message.errorMessage : '')

    return {
        id: entry.id || `message-${index + 1}`,
        role,
        text,
        parts,
        timestamp: entryTimestamp(entry),
    }
}

function completedToolCallIds(entries: SessionEntry[]): Set<string> {
    const out = new Set<string>()
    for (const entry of entries) {
        if (entry.type !== 'message') {
            continue
        }
        const message = entry.message as unknown as Record<string, unknown>
        if (typeof message.toolCallId === 'string') {
            out.add(message.toolCallId)
        }
    }
    return out
}

function readThreadEntries(record: ThreadRecord): SessionEntry[] {
    const active = activeThreads.get(record.key)
    if (active) {
        return active.session.sessionManager.getEntries()
    }
    if (!existsSync(record.sessionFile)) {
        return []
    }
    return SessionManager.open(
        record.sessionFile,
        config.paths.sessionsDir,
        config.paths.workspaceDir,
    ).getEntries()
}

function readThreadMessages(record: ThreadRecord, limit: number): RoomExecutionMessage[] {
    try {
        const entries = readThreadEntries(record)
        const completed = completedToolCallIds(entries)
        return entries
            .map((entry, index) => mapSessionEntry(entry, index, completed))
            .filter((entry): entry is RoomExecutionMessage => entry !== null)
            .slice(-limit)
    } catch {
        return []
    }
}

function compactionStats(record: ThreadRecord): RoomExecutionThread['compaction'] {
    const active = activeThreads.get(record.key)
    try {
        const compactions = readThreadEntries(record).filter(
            (entry): entry is Extract<SessionEntry, { type: 'compaction' }> =>
                entry.type === 'compaction',
        )
        const latest = compactions[compactions.length - 1]
        return {
            enabled: config.compaction.enabled,
            compacting: active?.session.isCompacting ?? record.status === 'compacting',
            count: compactions.length,
            lastCompactedAt: latest ? entryTimestamp(latest) : null,
            lastTokensBefore:
                latest &&
                typeof latest.tokensBefore === 'number' &&
                Number.isFinite(latest.tokensBefore)
                    ? latest.tokensBefore
                    : null,
            lastError: record.status === 'error' ? record.lastError : null,
        }
    } catch {
        return {
            enabled: config.compaction.enabled,
            compacting: record.status === 'compacting',
            count: 0,
            lastCompactedAt: null,
            lastTokensBefore: null,
            lastError: record.status === 'error' ? record.lastError : null,
        }
    }
}

function latestMessagePreview(messages: RoomExecutionMessage[]): string | null {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i]!
        if (message.text.trim()) {
            return shortText(message.text)
        }
    }
    return null
}

function firstUserTitle(messages: RoomExecutionMessage[], fallback: string): string {
    const firstUser = messages.find((message) => message.role === 'user' && message.text.trim())
    return firstUser ? shortText(firstUser.text, 80) : fallback
}

function latestAssistantErrorMessage(record: ThreadRecord): string | null {
    try {
        const entries = readThreadEntries(record)
        for (let index = entries.length - 1; index >= 0; index -= 1) {
            const entry = entries[index]
            if (!entry || entry.type !== 'message') {
                continue
            }
            const message = entry.message as unknown as Record<string, unknown>
            if (message.role !== 'assistant') {
                continue
            }
            if (message.stopReason === 'aborted') {
                return null
            }
            if (typeof message.errorMessage === 'string' && message.errorMessage.trim()) {
                return shortText(redactString(message.errorMessage), 600)
            }
            if (message.stopReason === 'error') {
                return 'Provider returned stop reason error'
            }
        }
        return null
    } catch {
        return null
    }
}

async function persistThreadIndex(): Promise<void> {
    await writeJsonFile(config.paths.threadIndexPath, threadIndex)
}

function updateThreadFromMessages(record: ThreadRecord): void {
    const messages = readThreadMessages(record, 500)
    const latestError = latestAssistantErrorMessage(record)
    record.title = firstUserTitle(messages, record.title)
    record.lastMessagePreview = latestMessagePreview(messages)
    record.updatedAt = Date.now()
    record.modelProvider = config.provider.piProvider
    record.model = config.provider.piModel
    if (latestError) {
        record.lastError = latestError
    }
}

function createSubagentTool(): ToolDefinition {
    return defineTool({
        name: 'agent_room_subagent',
        label: 'Subagent',
        description:
            'Run a bounded child Pi session inside this Agent Room and return its final text.',
        parameters: Type.Object({
            task: Type.String(),
            name: Type.Optional(Type.String()),
        }),
        execute: async (_toolCallId, input) => {
            const task = String(input.task ?? '').trim()
            if (!task) {
                throw new Error('Subagent task cannot be empty')
            }
            if (task.length > maxSubagentTaskChars) {
                throw new Error('Subagent task is too large')
            }
            const name = typeof input.name === 'string' ? shortText(input.name, 80) : null
            const child = await createThread({
                title: name ? `Subagent: ${name}` : 'Subagent',
            })
            subagentThreadKeys.add(child.key)
            const record = findThread(child.key)
            if (!record) {
                throw new Error('Subagent thread was not created')
            }
            await runPrompt({
                record,
                message: task,
                runId: randomUUID(),
                awaitCompletion: true,
            })
            const messages = readThreadMessages(record, 200)
            const finalAssistant = [...messages]
                .reverse()
                .find((message) => message.role === 'assistant' && message.text.trim())
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            threadKey: record.key,
                            status: record.status,
                            text: redactString(finalAssistant?.text ?? ''),
                        }),
                    },
                ],
                details: {
                    threadKey: record.key,
                    status: record.status,
                },
            }
        },
    })
}

async function createPiSession(record: ThreadRecord): Promise<AgentSession> {
    const authStorage = AuthStorage.create(config.paths.authPath)
    const modelRegistry = ModelRegistry.create(authStorage, config.paths.modelsPath)
    const model = modelRegistry.find(config.provider.piProvider, config.provider.piModel)
    if (!model) {
        throw new Error(
            `Pi model ${config.provider.piProvider}/${config.provider.piModel} is not available`,
        )
    }
    const settingsManager = SettingsManager.inMemory({
        compaction: {
            enabled: config.compaction.enabled,
            reserveTokens: config.compaction.reserveTokens,
            keepRecentTokens: config.compaction.keepRecentTokens,
        },
        retry: {
            enabled: false,
            provider: {
                timeoutMs: 120000,
                maxRetries: 0,
                maxRetryDelayMs: 0,
            },
        },
    })
    const sessionManager = existsSync(record.sessionFile)
        ? SessionManager.open(
              record.sessionFile,
              config.paths.sessionsDir,
              config.paths.workspaceDir,
          )
        : SessionManager.create(config.paths.workspaceDir, config.paths.sessionsDir)
    if (!existsSync(record.sessionFile)) {
        sessionManager.newSession({
            id: record.sessionId,
        })
        record.sessionFile = sessionManager.getSessionFile() ?? record.sessionFile
    }
    const customTools = [
        ...createInternalStateTools({
            config,
            audit: appendRuntimeEvent,
        }),
        ...createRoomTools({
            config,
            audit: appendRuntimeEvent,
        }),
        ...(subagentThreadKeys.has(record.key) ? [] : [createSubagentTool()]),
        ...mcpTools,
    ]
    const { session } = await createAgentSession({
        cwd: config.paths.workspaceDir,
        agentDir: config.paths.stateDir,
        authStorage,
        modelRegistry,
        model,
        thinkingLevel: 'medium',
        resourceLoader: createPiResourceLoader(() => systemPrompt),
        sessionManager,
        settingsManager,
        tools: customTools.map((tool) => tool.name),
        customTools,
    })
    session.setAutoCompactionEnabled(config.compaction.enabled)
    session.setAutoRetryEnabled(false)
    return session
}

async function getActiveThread(record: ThreadRecord): Promise<ActiveThread> {
    const existing = activeThreads.get(record.key)
    if (existing) {
        return existing
    }

    const session = await createPiSession(record)
    const active: ActiveThread = {
        session,
        unsubscribe: null,
        queue: Promise.resolve(),
    }
    active.unsubscribe = session.subscribe((event) => {
        void handleSessionEvent(record, event)
    })
    activeThreads.set(record.key, active)
    return active
}

async function handleSessionEvent(record: ThreadRecord, event: AgentSessionEvent): Promise<void> {
    updateThreadFromMessages(record)
    if (event.type === 'agent_start' || event.type === 'turn_start') {
        record.status = 'running'
    }
    if (event.type === 'compaction_start') {
        record.status = 'compacting'
    }
    if (event.type === 'compaction_end') {
        const active = activeThreads.get(record.key)
        record.status = event.errorMessage
            ? 'error'
            : active?.session.isStreaming || active?.session.isCompacting
              ? 'running'
              : 'idle'
        record.lastError = event.errorMessage ? redactString(event.errorMessage) : null
    }
    if (event.type === 'agent_end') {
        const latestError = latestAssistantErrorMessage(record)
        record.status = latestError ? 'error' : 'idle'
        record.lastError = latestError
        record.activeRunId = null
    }
    await persistThreadIndex()
    await appendRuntimeEvent(event.type, {
        sessionKey: record.key,
        event,
    })
    broadcast(record.key, event.type, {
        sessionKey: record.key,
        event,
    })
}

function findThread(key: string): ThreadRecord | null {
    return threadIndex.threads.find((thread) => thread.key === key) ?? null
}

async function createThread(
    input: {
        firstMessage?: string | null
        title?: string | null
    } = {},
): Promise<PiRuntimeThreadCreatePayload> {
    const key = randomUUID()
    const sessionId = key
    const sessionFile = `${config.paths.sessionsDir}/${new Date()
        .toISOString()
        .replaceAll(':', '-')}_${sessionId}.jsonl`
    const now = Date.now()
    const record: ThreadRecord = {
        key,
        sessionFile,
        sessionId,
        title: input.title?.trim() || 'Conversation',
        status: 'idle',
        createdAt: now,
        updatedAt: now,
        lastMessagePreview: null,
        modelProvider: config.provider.piProvider,
        model: config.provider.piModel,
        activeRunId: null,
        lastError: null,
    }
    threadIndex.threads.unshift(record)
    await persistThreadIndex()
    if (input.firstMessage?.trim()) {
        await runPrompt({
            record,
            message: input.firstMessage,
            runId: randomUUID(),
            awaitCompletion: false,
        })
    }
    return {
        key,
    }
}

async function runPrompt(input: {
    record: ThreadRecord
    message: string
    runId: string
    awaitCompletion: boolean
}): Promise<string> {
    const execute = async () => {
        await refreshSystemPrompt(activeThreads.get(input.record.key))
        const active = await getActiveThread(input.record)
        input.record.status = 'running'
        input.record.activeRunId = input.runId
        input.record.lastError = null
        updateThreadFromMessages(input.record)
        await persistThreadIndex()
        broadcast(input.record.key, 'run.accepted', {
            sessionKey: input.record.key,
            runId: input.runId,
        })
        try {
            await active.session.prompt(
                input.message,
                active.session.isStreaming
                    ? {
                          streamingBehavior: 'followUp',
                          source: 'rpc',
                      }
                    : {
                          source: 'rpc',
                      },
            )
            const latestError = latestAssistantErrorMessage(input.record)
            input.record.status = latestError ? 'error' : 'idle'
            input.record.lastError = latestError
        } catch (error) {
            input.record.status = 'error'
            input.record.lastError = errorMessage(error)
            broadcast(input.record.key, 'run.error', {
                sessionKey: input.record.key,
                runId: input.runId,
                message: input.record.lastError,
            })
        } finally {
            input.record.activeRunId = null
            updateThreadFromMessages(input.record)
            await persistThreadIndex()
            broadcast(input.record.key, 'run.finished', {
                sessionKey: input.record.key,
                runId: input.runId,
                status: input.record.status,
                error: input.record.lastError,
            })
        }
    }

    const active = await getActiveThread(input.record)
    active.queue = active.queue.then(execute, execute)
    if (input.awaitCompletion) {
        await active.queue
    }
    return input.record.status
}

function mapThread(record: ThreadRecord): RoomExecutionThread {
    return {
        key: record.key,
        sessionId: record.sessionId,
        agentId: 'main',
        title: record.title,
        lastMessagePreview: record.lastMessagePreview,
        status: record.status,
        updatedAt: record.updatedAt,
        runtimeMs: null,
        model: record.model,
        modelProvider: record.modelProvider,
        totalTokens: null,
        estimatedCostUsd: null,
        compaction: compactionStats(record),
    }
}

function roomAgent(threads: RoomExecutionThread[]): RoomExecutionAgent {
    return {
        id: 'main',
        name: config.runtime.displayName,
        workspace: config.paths.workspaceDir,
        modelPrimary: `${config.provider.piProvider}/${config.provider.piModel}`,
        modelFallbacks: config.provider.fallbackModels,
        identity: {
            name: config.runtime.displayName,
            theme: 'agent-room',
            emoji: null,
            avatarUrl: null,
        },
        threadCount: threads.length,
        activeThreadCount: threads.filter((thread) => thread.status === 'running').length,
        latestActivityAt: threads.reduce<number | null>((latest, thread) => {
            if (thread.updatedAt === null) {
                return latest
            }
            return latest === null || thread.updatedAt > latest ? thread.updatedAt : latest
        }, null),
    }
}

function snapshot(input: {
    selectedThreadKey?: string | null
    messageLimit?: number
}): PiRuntimeSnapshotPayload {
    const limit =
        input.messageLimit && Number.isFinite(input.messageLimit)
            ? Math.max(1, Math.floor(input.messageLimit))
            : 200
    const orderedRecords = [...threadIndex.threads].sort(
        (left, right) => right.updatedAt - left.updatedAt,
    )
    const threads = orderedRecords.map(mapThread)
    const selectedThreadKey = selectSnapshotThreadKey({
        requestedThreadKey: input.selectedThreadKey,
        orderedThreadKeys: threads.map((thread) => thread.key),
    })
    const selectedRecord = selectedThreadKey ? findThread(selectedThreadKey) : null
    const selectedThreadMessages = selectedRecord ? readThreadMessages(selectedRecord, limit) : []

    return {
        roomAgent: roomAgent(threads),
        extraAgentIds: [],
        threads,
        selectedThreadKey,
        selectedThreadMessages,
        recentActivity: threads.slice(0, 30).map(
            (thread): RoomExecutionActivity => ({
                key: thread.key,
                agentId: thread.agentId,
                title: thread.title,
                status: thread.status,
                updatedAt: thread.updatedAt,
                runtimeMs: thread.runtimeMs,
                totalTokens: thread.totalTokens,
                estimatedCostUsd: thread.estimatedCostUsd,
            }),
        ),
    }
}

function createEventStream(sessionKey: string): ReadableStream<Uint8Array> {
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null
    let timer: ReturnType<typeof setInterval> | null = null

    const removeController = () => {
        if (timer) {
            clearInterval(timer)
            timer = null
        }
        const set = subscribers.get(sessionKey)
        if (!set || !controllerRef) {
            return
        }
        set.delete(controllerRef)
        if (set.size === 0) {
            subscribers.delete(sessionKey)
        }
    }

    return new ReadableStream<Uint8Array>({
        start(controller) {
            controllerRef = controller
            const set = subscribers.get(sessionKey) ?? new Set()
            set.add(controller)
            subscribers.set(sessionKey, set)
            controller.enqueue(
                encodeSse('ready', {
                    roomId: config.runtime.roomId,
                    sessionKey,
                    subscribed: true,
                }),
            )
            timer = setInterval(() => {
                try {
                    controller.enqueue(
                        encodeSse('heartbeat', {
                            ts: Date.now(),
                        }),
                    )
                } catch {
                    removeController()
                }
            }, 15000)
            timer.unref?.()
        },
        cancel() {
            removeController()
        },
    })
}

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(
        request.url ?? '/',
        `http://${config.runtime.bindHost}:${config.runtime.port}`,
    )
    if (url.pathname === '/health') {
        sendJson(response, 200, {
            healthy: true,
            roomId: config.runtime.roomId,
            runtime: 'pi',
        })
        return
    }

    assertAuthorized(request)

    if (request.method === 'GET' && url.pathname === '/snapshot') {
        sendJson(
            response,
            200,
            snapshot({
                selectedThreadKey: url.searchParams.get('selectedThreadKey'),
                messageLimit: Number(url.searchParams.get('messageLimit') ?? 200),
            }),
        )
        return
    }

    if (request.method === 'POST' && url.pathname === '/threads') {
        const body = await getRequestBody(request)
        const firstMessage =
            isRecord(body) && typeof body.firstMessage === 'string' ? body.firstMessage : null
        sendJson(response, 200, await createThread({ firstMessage }))
        return
    }

    const threadSendMatch = url.pathname.match(/^\/threads\/([^/]+)\/send$/)
    if (request.method === 'POST' && threadSendMatch) {
        const sessionKey = decodeURIComponent(threadSendMatch[1]!)
        const record = findThread(sessionKey)
        if (!record) {
            throw new HttpError(404, `Thread ${sessionKey} does not exist`)
        }
        const body = await getRequestBody(request)
        const message =
            isRecord(body) && typeof body.message === 'string' ? body.message.trim() : ''
        if (!message) {
            throw new HttpError(400, 'Message cannot be empty')
        }
        const runId = randomUUID()
        const awaitCompletion = isRecord(body) && body.awaitCompletion === true
        const finalStatus = await runPrompt({
            record,
            message,
            runId,
            awaitCompletion,
        })
        const payload: PiRuntimeSendPayload = {
            runId,
            status: awaitCompletion ? finalStatus : 'accepted',
            messageSeq: null,
            interruptedActiveRun: false,
            error: record.lastError,
        }
        sendJson(response, 200, payload)
        return
    }

    const threadAbortMatch = url.pathname.match(/^\/threads\/([^/]+)\/abort$/)
    if (request.method === 'POST' && threadAbortMatch) {
        const sessionKey = decodeURIComponent(threadAbortMatch[1]!)
        const record = findThread(sessionKey)
        if (!record) {
            throw new HttpError(404, `Thread ${sessionKey} does not exist`)
        }
        const active = activeThreads.get(sessionKey)
        if (active) {
            await active.session.abort()
        }
        const abortedRunId = record.activeRunId
        record.status = 'idle'
        record.activeRunId = null
        await persistThreadIndex()
        const payload: PiRuntimeAbortPayload = {
            abortedRunId,
            status: abortedRunId ? 'aborted' : 'no-active-run',
        }
        sendJson(response, 200, payload)
        return
    }

    const eventsMatch = url.pathname.match(/^\/threads\/([^/]+)\/events$/)
    if (request.method === 'GET' && eventsMatch) {
        const sessionKey = decodeURIComponent(eventsMatch[1]!)
        if (!findThread(sessionKey)) {
            throw new HttpError(404, `Thread ${sessionKey} does not exist`)
        }
        response.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-store',
            connection: 'keep-alive',
        })
        const reader = createEventStream(sessionKey).getReader()
        request.on('close', () => {
            void reader.cancel()
        })
        while (true) {
            const next = await reader.read()
            if (next.done) {
                response.end()
                return
            }
            response.write(next.value)
        }
    }

    throw new HttpError(404, `Pi runtime route ${url.pathname} was not found`)
}

const server = createServer((request, response) => {
    void route(request, response).catch((error) => {
        sendError(response, error)
    })
})

process.on('SIGTERM', () => {
    for (const active of activeThreads.values()) {
        active.unsubscribe?.()
        active.session.dispose()
    }
    void closeMcpConnections().finally(() => {
        server.close(() => {
            process.exit(0)
        })
    })
    setTimeout(() => process.exit(0), 5000).unref()
})

server.listen(config.runtime.port, config.runtime.bindHost, () => {
    void appendRuntimeEvent('runtime.started', {
        roomId: config.runtime.roomId,
        port: config.runtime.port,
    })
})
