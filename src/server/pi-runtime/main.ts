import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import {
    SessionManager,
    type AgentSession,
    type AgentSessionEvent,
    type SessionEntry,
} from '@mariozechner/pi-coding-agent'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import type { RoomExecutionMessage, RoomExecutionThread } from '../rooms/execution-types'
import type {
    PiRuntimeCompactPayload,
    PiRuntimeForkPayload,
    PiRuntimeThreadCreatePayload,
} from './protocol'
import { closeMcpConnections, createMcpTools } from './mcp-bridge'
import { buildAgentRoomSystemPrompt } from './system-prompt'
import { normalizeThreadIndexFile, type ThreadIndexFile, type ThreadRecord } from './thread-records'
import { currentToolRunContext, withToolRunContext } from './tool-run-context'
import {
    budgetForRunKind,
    createRunHeartbeat,
    timeoutMessage,
    timeoutReasonForHeartbeat,
    touchRunHeartbeat,
    RunWatchdog,
    type RunHeartbeatRecord,
    type RunKind,
} from './run-budget'
import { cleanupBackgroundCommands } from './background-commands'
import { createRuntimeRedactor, isRecord } from './runtime-redaction'
import { readJsonFile, writeJsonFile } from './runtime-files'
import { ensureRuntimeLayout } from './runtime-layout'
import { sendError } from './runtime-http'
import {
    completedToolCallIds,
    entryTimestamp,
    latestAssistantErrorMessage as latestAssistantErrorMessageFromEntries,
    mapSessionEntry,
    shortText,
} from './session-entry-mapper'
import { createPiRuntimeSession } from './pi-runtime-session'
import { createRuntimeEventBus } from './runtime-event-bus'
import { buildRuntimeSnapshot } from './runtime-snapshot'
import { createPiRuntimeRouter } from './pi-runtime-router'

interface ActiveThread {
    session: AgentSession
    unsubscribe: (() => void) | null
    queue: Promise<void>
    abortController: AbortController | null
    touchRunHeartbeat: ((reason: string) => Promise<void>) | null
}

const configPath = process.env.AGENT_ROOM_PI_RUNTIME_CONFIG_PATH
if (!configPath) {
    throw new Error('AGENT_ROOM_PI_RUNTIME_CONFIG_PATH is required')
}

const config = JSON.parse(await readFile(configPath, 'utf8')) as PiRuntimeConfig
const { redactPayload, redactString, errorMessage } = createRuntimeRedactor(config)
const activeThreads = new Map<string, ActiveThread>()
const threadIndex = await readJsonFile<ThreadIndexFile>(config.paths.threadIndexPath, {
    version: 1,
    threads: [],
})
let runtimeEventSeq = 0

const maxSubagentTaskChars = 24000
const maxActiveSubagents = 5

threadIndex.threads = normalizeThreadIndexFile(threadIndex).threads
await ensureRuntimeLayout(config)
await writeJsonFile(config.paths.modelsPath, config.models)
const mcpTools = await createMcpTools({
    servers: config.mcpServers,
    cwd: config.paths.workspaceDir,
})
let systemPrompt = await buildAgentRoomSystemPrompt(config)
const { broadcast, createEventStream } = createRuntimeEventBus({
    roomId: config.runtime.roomId,
    redactPayload,
    stateVersionForThread: (sessionKey) =>
        threadIndex.threads.find((thread) => thread.key === sessionKey)?.updatedAt,
})

async function appendRuntimeEvent(event: string, payload: unknown): Promise<void> {
    const runContext = currentToolRunContext()
    const payloadObject = isRecord(payload) ? payload : {}
    const sessionKey =
        runContext?.sessionKey ??
        (typeof payloadObject.sessionKey === 'string' ? payloadObject.sessionKey : null)
    const runId =
        runContext?.runId ?? (typeof payloadObject.runId === 'string' ? payloadObject.runId : null)
    const redactedPayload = redactPayload(payload)
    await writeFile(
        config.paths.runtimeEventsPath,
        `${JSON.stringify({
            ts: Date.now(),
            seq: ++runtimeEventSeq,
            event,
            sessionKey,
            runId,
            payload: redactedPayload,
        })}\n`,
        {
            encoding: 'utf8',
            flag: 'a',
            mode: 0o600,
        },
    )
}

async function refreshSystemPrompt(active?: ActiveThread): Promise<void> {
    systemPrompt = await buildAgentRoomSystemPrompt(config)
    if (active) {
        await active.session.reload()
    }
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
        return latestAssistantErrorMessageFromEntries(readThreadEntries(record), redactString)
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

async function createPiSession(record: ThreadRecord): Promise<AgentSession> {
    return createPiRuntimeSession({
        config,
        record,
        systemPrompt: () => systemPrompt,
        mcpTools,
        audit: appendRuntimeEvent,
        shortText,
        redactString,
        maxSubagentTaskChars,
        maxActiveSubagents,
        activeSubagentCount: () =>
            threadIndex.threads.filter(
                (thread) => thread.kind === 'subagent' && thread.status === 'running',
            ).length,
        createThread,
        findThread,
        runPrompt,
        readThreadMessages,
    })
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
        abortController: null,
        touchRunHeartbeat: null,
    }
    active.unsubscribe = session.subscribe((event) => {
        void handleSessionEvent(record, event)
    })
    activeThreads.set(record.key, active)
    return active
}

async function handleSessionEvent(record: ThreadRecord, event: AgentSessionEvent): Promise<void> {
    const active = activeThreads.get(record.key)
    await active?.touchRunHeartbeat?.(event.type)
    updateThreadFromMessages(record)
    if (event.type === 'agent_start' || event.type === 'turn_start') {
        record.status = 'running'
    }
    if (event.type === 'compaction_start') {
        record.status = 'compacting'
    }
    if (event.type === 'compaction_end') {
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
        kind?: 'main' | 'subagent'
        parentThreadKey?: string | null
        parentRunId?: string | null
        subagentRunId?: string | null
        subagentName?: string | null
        subagentTask?: string | null
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
        activeRunKind: null,
        heartbeatAt: null,
        runStartedAt: null,
        runBudgetExpiresAt: null,
        idleTimeoutExpiresAt: null,
        activeDurationMs: 0,
        idleDurationMs: 0,
        lastError: null,
        kind: input.kind ?? 'main',
        parentThreadKey: input.parentThreadKey ?? null,
        parentRunId: input.parentRunId ?? null,
        subagentRunId: input.subagentRunId ?? null,
        subagentName: input.subagentName ?? null,
        subagentTask: input.subagentTask ?? null,
        completedAt: null,
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
    runKind?: RunKind
}): Promise<string> {
    const execute = async () => {
        const runKind = input.runKind ?? (input.record.kind === 'subagent' ? 'subagent' : 'manual')
        const budget = budgetForRunKind(config.budgets, runKind)
        let heartbeat: RunHeartbeatRecord = createRunHeartbeat({
            runId: input.runId,
            runKind,
            budget,
        })
        let watchdogError: RunWatchdog | null = null
        let watchdog: ReturnType<typeof setInterval> | null = null
        await refreshSystemPrompt(activeThreads.get(input.record.key))
        const active = await getActiveThread(input.record)
        const abortController = new AbortController()
        active.abortController = abortController
        const touch = async (reason: string) => {
            const previousHeartbeatAt = heartbeat.heartbeatAt
            heartbeat = touchRunHeartbeat({
                record: heartbeat,
                budget,
                reason,
            })
            input.record.heartbeatAt = heartbeat.heartbeatAt
            input.record.idleTimeoutExpiresAt = heartbeat.idleTimeoutExpiresAt
            input.record.activeDurationMs = heartbeat.heartbeatAt - heartbeat.startedAt
            input.record.idleDurationMs = Math.max(0, heartbeat.heartbeatAt - previousHeartbeatAt)
            await persistThreadIndex()
            broadcast(input.record.key, 'run.heartbeat', {
                sessionKey: input.record.key,
                runId: input.runId,
                runKind,
                reason,
                heartbeatAt: heartbeat.heartbeatAt,
                runBudgetExpiresAt: heartbeat.totalBudgetExpiresAt,
                idleTimeoutExpiresAt: heartbeat.idleTimeoutExpiresAt,
            })
        }
        active.touchRunHeartbeat = touch
        input.record.status = 'running'
        input.record.activeRunId = input.runId
        input.record.activeRunKind = runKind
        input.record.heartbeatAt = heartbeat.heartbeatAt
        input.record.runStartedAt = heartbeat.startedAt
        input.record.runBudgetExpiresAt = heartbeat.totalBudgetExpiresAt
        input.record.idleTimeoutExpiresAt = heartbeat.idleTimeoutExpiresAt
        input.record.activeDurationMs = 0
        input.record.idleDurationMs = 0
        input.record.lastError = null
        updateThreadFromMessages(input.record)
        await persistThreadIndex()
        broadcast(input.record.key, 'run.accepted', {
            sessionKey: input.record.key,
            runId: input.runId,
            runKind,
            runBudgetMs: budget.runBudgetMs,
            idleTimeoutMs: budget.idleTimeoutMs,
        })
        watchdog = setInterval(() => {
            const reason = timeoutReasonForHeartbeat({
                record: heartbeat,
            })
            if (!reason) {
                return
            }
            watchdogError = new RunWatchdog(reason, timeoutMessage(reason))
            abortController.abort(watchdogError)
            void active.session.abort()
            if (watchdog) {
                clearInterval(watchdog)
                watchdog = null
            }
        }, 1000)
        watchdog.unref?.()
        const runStartedAt = heartbeat.startedAt
        try {
            await withToolRunContext(
                {
                    sessionKey: input.record.key,
                    runId: input.runId,
                    signal: abortController.signal,
                },
                () =>
                    active.session.prompt(
                        input.message,
                        active.session.isStreaming
                            ? {
                                  streamingBehavior: 'followUp',
                                  source: 'rpc',
                              }
                            : {
                                  source: 'rpc',
                              },
                    ),
            )
            if (watchdogError) {
                throw watchdogError
            }
            const latestError = latestAssistantErrorMessage(input.record)
            input.record.status = latestError ? 'error' : 'idle'
            input.record.lastError = latestError
        } catch (error) {
            const abortReason =
                abortController.signal.reason instanceof RunWatchdog
                    ? abortController.signal.reason
                    : watchdogError
            if (abortReason?.reason === 'explicit_abort') {
                input.record.status = 'idle'
                input.record.lastError = null
            } else {
                input.record.status = 'error'
                input.record.lastError = errorMessage(abortReason ?? error)
            }
            broadcast(input.record.key, 'run.error', {
                sessionKey: input.record.key,
                runId: input.runId,
                message: input.record.lastError,
                reason: abortReason?.reason ?? null,
            })
        } finally {
            const finishedAt = Date.now()
            const durationMs = Math.max(0, finishedAt - heartbeat.startedAt)
            const activeDurationMs = Math.min(durationMs, input.record.activeDurationMs)
            const idleDurationMs = Math.max(0, durationMs - activeDurationMs)
            if (watchdog) {
                clearInterval(watchdog)
                watchdog = null
            }
            if (active.abortController === abortController) {
                active.abortController = null
            }
            if (active.touchRunHeartbeat === touch) {
                active.touchRunHeartbeat = null
            }
            input.record.activeRunId = null
            input.record.activeRunKind = null
            input.record.heartbeatAt = heartbeat.heartbeatAt
            input.record.runStartedAt = null
            input.record.runBudgetExpiresAt = null
            input.record.idleTimeoutExpiresAt = null
            updateThreadFromMessages(input.record)
            await persistThreadIndex()
            await appendRuntimeEvent('run.finished', {
                sessionKey: input.record.key,
                runId: input.runId,
                runKind,
                status: input.record.status,
                error: input.record.lastError,
                provider: config.provider.sourceProvider,
                model: config.provider.sourceModel,
                durationMs,
                activeDurationMs,
                idleDurationMs,
                startedAt: new Date(runStartedAt).toISOString(),
                finishedAt: new Date(finishedAt).toISOString(),
            })
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

async function compactThread(input: {
    record: ThreadRecord
    instructions?: string | null
}): Promise<PiRuntimeCompactPayload> {
    const active = await getActiveThread(input.record)
    input.record.status = 'compacting'
    input.record.lastError = null
    await persistThreadIndex()
    try {
        await active.session.compact(input.instructions?.trim() || undefined)
        input.record.status = active.session.isStreaming ? 'running' : 'idle'
    } catch (error) {
        input.record.status = 'error'
        input.record.lastError = errorMessage(error)
    } finally {
        updateThreadFromMessages(input.record)
        await persistThreadIndex()
        broadcast(input.record.key, 'thread.compacted', {
            sessionKey: input.record.key,
            status: input.record.status,
            error: input.record.lastError,
        })
    }

    return {
        status: input.record.status,
        error: input.record.lastError,
        compactionCount: compactionStats(input.record).count,
    }
}

async function forkThread(input: {
    record: ThreadRecord
    title?: string | null
    entryId?: string | null
}): Promise<PiRuntimeForkPayload> {
    const manager = SessionManager.open(
        input.record.sessionFile,
        config.paths.sessionsDir,
        config.paths.workspaceDir,
    )
    const leafId = input.entryId?.trim() || manager.getLeafId()
    if (!leafId) {
        throw new Error('Cannot fork an empty thread')
    }
    const sessionFile = manager.createBranchedSession(leafId)
    if (!sessionFile) {
        throw new Error('Pi did not create a forked session file')
    }
    const forkManager = SessionManager.open(
        sessionFile,
        config.paths.sessionsDir,
        config.paths.workspaceDir,
    )
    const now = Date.now()
    const key = randomUUID()
    const record: ThreadRecord = {
        key,
        sessionFile,
        sessionId: forkManager.getSessionId(),
        title: input.title?.trim() || `Fork: ${input.record.title}`,
        status: 'idle',
        createdAt: now,
        updatedAt: now,
        lastMessagePreview: null,
        modelProvider: config.provider.piProvider,
        model: config.provider.piModel,
        activeRunId: null,
        activeRunKind: null,
        heartbeatAt: null,
        runStartedAt: null,
        runBudgetExpiresAt: null,
        idleTimeoutExpiresAt: null,
        activeDurationMs: 0,
        idleDurationMs: 0,
        lastError: null,
        kind: input.record.kind,
        parentThreadKey: input.record.key,
        parentRunId: input.record.activeRunId,
        subagentRunId: input.record.subagentRunId,
        subagentName: input.record.subagentName,
        subagentTask: input.record.subagentTask,
        completedAt: null,
    }
    threadIndex.threads.unshift(record)
    updateThreadFromMessages(record)
    await persistThreadIndex()
    await appendRuntimeEvent('thread.forked', {
        parentThreadKey: input.record.key,
        threadKey: record.key,
        parentSessionFile: input.record.sessionFile,
        sessionFile,
        entryId: leafId,
    })

    return {
        key: record.key,
        parentThreadKey: input.record.key,
        parentSessionFile: input.record.sessionFile,
    }
}

function snapshot(input: { selectedThreadKey?: string | null; messageLimit?: number }) {
    return buildRuntimeSnapshot({
        config,
        records: threadIndex.threads,
        selectedThreadKey: input.selectedThreadKey,
        messageLimit: input.messageLimit,
        findThread,
        readThreadMessages,
        compactionStats,
    })
}

const route = createPiRuntimeRouter({
    config,
    activeThreads,
    findThread,
    createThread,
    runPrompt,
    compactThread,
    forkThread,
    snapshot,
    createEventStream,
    persistThreadIndex,
})

const server = createServer((request, response) => {
    void route(request, response).catch((error) => {
        sendError(response, error, errorMessage)
    })
})

process.on('SIGTERM', () => {
    for (const active of activeThreads.values()) {
        active.unsubscribe?.()
        active.session.dispose()
    }
    void cleanupBackgroundCommands(config).finally(() => {
        void closeMcpConnections().finally(() => {
            server.close(() => {
                process.exit(0)
            })
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
