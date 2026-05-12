import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import {
    SessionManager,
    type AgentSession,
    type AgentSessionEvent,
    type SessionEntry,
} from '@mariozechner/pi-coding-agent'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import type {
    RoomExecutionMessage,
    RoomExecutionModelState,
    RoomExecutionThinkingLevel,
    RoomExecutionThread,
} from '../rooms/execution-types'
import type {
    PiRuntimeCompactPayload,
    PiRuntimeForkPayload,
    PiRuntimeThreadCreatePayload,
} from './protocol'
import { closeMcpConnections, createMcpTools } from './mcp-bridge'
import { buildAgentRoomSystemPrompt } from './system-prompt'
import { normalizeThreadIndexFile, type ThreadIndexFile, type ThreadRecord } from './thread-records'
import { timeoutMessage, RunWatchdog } from './run-budget'
import { cleanupBackgroundCommands } from './background-commands'
import { createRuntimeRedactor } from './runtime-redaction'
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
import { extractSessionArtifacts } from './session-artifacts'
import {
    estimateSessionBranchContextBytes,
    proactiveCompactionContextBytes,
} from './session-context-budget'
import { createPiRuntimeSession } from './pi-runtime-session'
import { createRuntimeEventBus } from './runtime-event-bus'
import { buildRuntimeSnapshot, mapThread } from './runtime-snapshot'
import { createSessionWindowStore } from './session-display-window'
import { createPiRuntimeRouter } from './pi-runtime-router'
import { createRuntimeEventAppender } from './runtime-event-log'
import { createRuntimeRunPrompt, type ActiveThread } from './runtime-runner'
import { createRuntimeModelState } from './runtime-model-state'
import { cleanManualThreadTitle, createThreadTitleGenerator } from './runtime-title-generator'

const configPath = process.env.AGENT_ROOM_PI_RUNTIME_CONFIG_PATH
if (!configPath) {
    throw new Error('AGENT_ROOM_PI_RUNTIME_CONFIG_PATH is required')
}

const config = JSON.parse(await readFile(configPath, 'utf8')) as PiRuntimeConfig
const { redactPayload, redactUnboundedPayload, redactString, redactUnboundedString, errorMessage } =
    createRuntimeRedactor(config)
const activeThreads = new Map<string, ActiveThread>()
const threadIndex = await readJsonFile<ThreadIndexFile>(config.paths.threadIndexPath, {
    version: 1,
    threads: [],
})

threadIndex.threads = normalizeThreadIndexFile(threadIndex).threads
await ensureRuntimeLayout(config)
await writeJsonFile(config.paths.modelsPath, config.models)
const mcpTools = await createMcpTools({
    servers: config.mcpServers,
    cwd: config.paths.workspaceDir,
})
let systemPrompt = await buildAgentRoomSystemPrompt(config)
const { broadcast, createEventStream, createRoomEventStream } = createRuntimeEventBus({
    roomId: config.runtime.roomId,
    redactPayload: redactUnboundedPayload,
    stateVersionForThread: (sessionKey) =>
        threadIndex.threads.find((thread) => thread.key === sessionKey)?.updatedAt,
})
const appendRuntimeEvent = createRuntimeEventAppender({
    config,
    redactPayload,
    broadcast,
})
const {
    createModelRegistry,
    normalizeThinkingLevel,
    syncRecordModelState,
    selectedThreadModelState,
} = createRuntimeModelState({
    config,
    activeThreads,
})
const { maybeGenerateThreadTitle } = createThreadTitleGenerator({
    config,
    readThreadMessages,
    persistThreadIndex,
    appendRuntimeEvent,
    broadcast,
    errorMessage,
})

async function refreshSystemPrompt(active?: ActiveThread): Promise<void> {
    systemPrompt = await buildAgentRoomSystemPrompt(config)
    if (active) {
        await active.session.reload()
    }
}

function readThreadEntries(record: ThreadRecord): SessionEntry[] {
    const active = activeThreads.get(record.key)
    if (active) {
        return active.session.sessionManager.getBranch()
    }
    if (!existsSync(record.sessionFile)) {
        return []
    }
    return SessionManager.open(
        record.sessionFile,
        config.paths.sessionsDir,
        config.paths.workspaceDir,
    ).getBranch()
}

async function compactOversizedThreadContext(input: {
    record: ThreadRecord
    active: ActiveThread
}): Promise<void> {
    if (!config.compaction.enabled) return
    if (input.active.session.isCompacting || input.active.session.isStreaming) return

    const contextBytes = estimateSessionBranchContextBytes(
        input.active.session.sessionManager.getBranch(),
    )
    if (contextBytes < proactiveCompactionContextBytes) return

    input.record.status = 'compacting'
    input.record.lastError = null
    await persistThreadIndex()
    try {
        await input.active.session.compact(
            [
                'Summarize the durable user goals, decisions, file paths, and final results.',
                'Do not preserve raw command output, raw fetched response bodies, duplicated tool text, or transient errors unless they changed the plan.',
            ].join(' '),
        )
        input.record.status = input.active.session.isStreaming ? 'running' : 'idle'
        input.record.lastError = null
    } catch (error) {
        input.record.status = 'error'
        input.record.lastError = errorMessage(error)
        throw error
    } finally {
        updateThreadFromMessages(input.record)
        await persistThreadIndex()
        broadcast(input.record.key, 'thread.compacted', {
            sessionKey: input.record.key,
            status: input.record.status,
            error: input.record.lastError,
            contextBytes,
            thresholdBytes: proactiveCompactionContextBytes,
        })
    }
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

const sessionWindowStore = createSessionWindowStore({
    config,
    readThreadEntries,
})

function readThreadArtifacts(record: ThreadRecord) {
    try {
        return extractSessionArtifacts(config, readThreadEntries(record))
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
    syncRecordModelState(record, activeThreads.get(record.key)?.session)
    const messages = readThreadMessages(record, 500)
    const latestError = latestAssistantErrorMessage(record)
    if (record.titleSource === 'initial') {
        record.title = firstUserTitle(messages, record.title)
    }
    record.lastMessagePreview = latestMessagePreview(messages)
    record.updatedAt = Date.now()
    if (latestError) {
        record.lastError = latestError
    }
}

async function renameThread(input: { record: ThreadRecord; title: string }): Promise<void> {
    const title = cleanManualThreadTitle(input.title)
    if (!title) {
        throw new Error('Session title cannot be empty')
    }
    input.record.title = title
    input.record.titleSource = 'manual'
    input.record.updatedAt = Date.now()
    await persistThreadIndex()
    await appendRuntimeEvent('thread.renamed', {
        sessionKey: input.record.key,
        title,
        source: 'manual',
    })
    broadcast(input.record.key, 'thread.renamed', {
        sessionKey: input.record.key,
        title,
        source: 'manual',
    })
}

async function deleteThread(record: ThreadRecord): Promise<void> {
    const index = threadIndex.threads.findIndex((thread) => thread.key === record.key)
    if (index < 0) {
        throw new Error(`Thread ${record.key} does not exist`)
    }
    const active = activeThreads.get(record.key)
    if (active) {
        active.abortController?.abort(
            new RunWatchdog('explicit_abort', timeoutMessage('explicit_abort')),
        )
        active.unsubscribe?.()
        active.session.dispose()
        activeThreads.delete(record.key)
    }
    threadIndex.threads.splice(index, 1)
    await rm(record.sessionFile, { force: true })
    await persistThreadIndex()
    await appendRuntimeEvent('thread.deleted', {
        sessionKey: record.key,
    })
    broadcast(record.key, 'thread.deleted', {
        sessionKey: record.key,
    })
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
        redactCommandOutput: redactUnboundedString,
        maxSubagentTaskChars: 24000,
        maxActiveSubagents: 5,
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
        titleSource: input.title?.trim() ? 'manual' : 'initial',
        status: 'idle',
        createdAt: now,
        updatedAt: now,
        lastMessagePreview: null,
        modelProvider: config.provider.piProvider,
        model: config.provider.piModel,
        thinkingLevel: 'medium',
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

const runPrompt = createRuntimeRunPrompt({
    config,
    activeThreads,
    refreshSystemPrompt,
    getActiveThread,
    compactOversizedThreadContext,
    updateThreadFromMessages,
    persistThreadIndex,
    broadcast,
    appendRuntimeEvent,
    latestAssistantErrorMessage,
    maybeGenerateThreadTitle,
    errorMessage,
})

async function editThreadMessage(input: {
    record: ThreadRecord
    messageId: string
    message: string
    runId: string
    awaitCompletion: boolean
}): Promise<string> {
    return runPrompt({
        record: input.record,
        message: input.message,
        runId: input.runId,
        awaitCompletion: input.awaitCompletion,
        runKind: 'manual',
        editMessageId: input.messageId,
    })
}

async function updateThreadModel(input: {
    record: ThreadRecord
    provider: string
    model: string
    thinkingLevel?: RoomExecutionThinkingLevel | null
}): Promise<RoomExecutionModelState> {
    if (input.record.activeRunId) {
        throw new Error('Cannot change model while a run is active')
    }
    const provider = input.provider.trim()
    const modelId = input.model.trim()
    if (!provider || !modelId) {
        throw new Error('Model provider and model are required')
    }
    const registry = createModelRegistry()
    const model = registry.find(provider, modelId)
    if (!model) {
        throw new Error(`Model ${provider}/${modelId} is not available`)
    }

    const active = await getActiveThread(input.record)
    await active.queue
    await active.session.setModel(model)
    if (input.thinkingLevel) {
        active.session.setThinkingLevel(normalizeThinkingLevel(input.thinkingLevel))
    }
    syncRecordModelState(input.record, active.session)
    input.record.updatedAt = Date.now()
    await persistThreadIndex()
    await appendRuntimeEvent('thread.model_changed', {
        sessionKey: input.record.key,
        provider: input.record.modelProvider,
        model: input.record.model,
        thinkingLevel: input.record.thinkingLevel,
    })
    broadcast(input.record.key, 'thread.model_changed', {
        sessionKey: input.record.key,
        provider: input.record.modelProvider,
        model: input.record.model,
        thinkingLevel: input.record.thinkingLevel,
    })

    const state = selectedThreadModelState(input.record)
    if (!state) {
        throw new Error('Model state could not be read after update')
    }
    return state
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
        titleSource: input.title?.trim() ? 'manual' : 'generated',
        status: 'idle',
        createdAt: now,
        updatedAt: now,
        lastMessagePreview: null,
        modelProvider: config.provider.piProvider,
        model: config.provider.piModel,
        thinkingLevel: 'medium',
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
        readThreadArtifacts,
        compactionStats,
        selectedThreadModelState,
    })
}

function sessionWindow(input: {
    record: ThreadRecord
    before?: string | null
    after?: string | null
    limitRows?: number
}) {
    return sessionWindowStore.window({
        record: input.record,
        thread: mapThread(input.record, compactionStats),
        before: input.before,
        after: input.after,
        limitRows: input.limitRows ?? 40,
    })
}

const route = createPiRuntimeRouter({
    config,
    activeThreads,
    findThread,
    createThread,
    runPrompt,
    updateThreadModel,
    renameThread,
    deleteThread,
    compactThread,
    forkThread,
    editThreadMessage,
    snapshot,
    sessionWindow,
    createEventStream,
    createRoomEventStream,
    publishRoomFileChanged: (payload) => {
        broadcast(payload.sessionKey ?? '__room__', 'room.files.changed', payload)
    },
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
