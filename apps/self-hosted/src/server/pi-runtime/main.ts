import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
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
import {
    normalizeThreadIndexFile,
    type ThreadIndexFile,
    type ThreadKind,
    type ThreadRecord,
} from './thread-records'
import { timeoutMessage, RunWatchdog } from './run-budget'
import { cleanupBackgroundCommands } from './background-commands'
import { createRuntimeRedactor } from './runtime-redaction'
import { createHostedRuntimeStateSync } from './hosted-runtime-state-sync'
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
import { readMemory } from './memory'
import {
    estimateRuntimeMessageContextBytes,
    proactiveCompactionContextBytes,
} from './session-context-budget'
import { isSessionCompactionLeaf } from './session-compaction-state'
import { createPiRuntimeSession } from './pi-runtime-session'
import {
    BrowserbaseBrowserAutomationManager,
    browserbaseRuntimeShutdownGraceMs,
} from './browserbase-browser'
import { createRuntimeEventBus } from './runtime-event-bus'
import { buildRuntimeSnapshot, mapThread } from './runtime-snapshot'
import { createSessionWindowStore } from './session-display-window'
import { createPiRuntimeRouter } from './pi-runtime-router'
import { createRuntimeEventAppender, drainPendingHostedRuntimeUsage } from './runtime-event-log'
import { createRuntimeRunPrompt, type ActiveThread } from './runtime-runner'
import { createRuntimeModelState } from './runtime-model-state'
import { cleanManualThreadTitle, createThreadTitleGenerator } from './runtime-title-generator'
import { promptAttachmentMetadataByEntryId } from './prompt-attachments'
import { createSessionEventQueue } from './session-event-queue'
import { removeDeliveredPendingUserMessage } from './pending-user-messages'
import { visibleProjectionEntries } from './hidden-projection'
import { piRuntimeFileBundleEnvKey } from '../rooms/pi-runtime-contract'

const configPath = process.env.AGENT_ROOM_PI_RUNTIME_CONFIG_PATH
if (!configPath) {
    throw new Error('AGENT_ROOM_PI_RUNTIME_CONFIG_PATH is required')
}

interface RuntimeFileBundleEntry {
    path: string
    contentBase64: string
    mode?: number
}

function readFileBundleRaw(): string | null {
    const base = process.env[piRuntimeFileBundleEnvKey]
    if (base === undefined) {
        return null
    }
    let raw = base
    let index = 1
    for (;;) {
        const chunk = process.env[`${piRuntimeFileBundleEnvKey}_${index}`]
        if (chunk === undefined) {
            break
        }
        raw += chunk
        index += 1
    }
    return raw
}

function decodeFileBundle(): RuntimeFileBundleEntry[] {
    const raw = readFileBundleRaw()
    if (!raw) {
        return []
    }
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown
    if (!Array.isArray(parsed)) {
        throw new Error('Runtime file bundle must be an array')
    }
    return parsed.map((entry) => {
        if (!entry || typeof entry !== 'object') {
            throw new Error('Runtime file bundle entry must be an object')
        }
        const record = entry as Record<string, unknown>
        if (typeof record.path !== 'string' || typeof record.contentBase64 !== 'string') {
            throw new Error('Runtime file bundle entry is missing path or content')
        }
        return {
            path: record.path,
            contentBase64: record.contentBase64,
            mode: typeof record.mode === 'number' ? record.mode : undefined,
        }
    })
}

function assertRuntimeBundlePath(path: string): void {
    if (!isAbsolute(path)) {
        throw new Error('Runtime file bundle path must be absolute')
    }
    const resolved = resolve(path)
    const allowedRoot = '/workspace/runtime'
    const relativePath = relative(allowedRoot, resolved)
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
        throw new Error('Runtime file bundle path is outside the hosted runtime root')
    }
}

for (const entry of decodeFileBundle()) {
    assertRuntimeBundlePath(entry.path)
    await mkdir(dirname(entry.path), {
        recursive: true,
        mode: 0o700,
    })
    await writeFile(entry.path, Buffer.from(entry.contentBase64, 'base64url'), {
        mode: entry.mode ?? 0o600,
    })
    if (entry.mode) {
        await chmod(entry.path, entry.mode)
    }
}

const config = JSON.parse(await readFile(configPath, 'utf8')) as PiRuntimeConfig
const { redactPayload, redactString, redactUnboundedString, errorMessage } =
    createRuntimeRedactor(config)
const hostedRuntimeStateSync = createHostedRuntimeStateSync(config)
const activeThreads = new Map<string, ActiveThread>()
const maxSubagentTaskChars = 24000
const maxActiveSubagents = 5
const maxDeepWorkObjectiveChars = 48000
const maxDeepWorkResultChars = 60000
const maxActiveDeepWork = 2
let activeDeepWorkReservations = 0
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
    restrictPrivateNetwork: config.sandboxHardening.restrictPrivateNetwork,
})
let systemPrompt = await buildAgentRoomSystemPrompt(config)
const { broadcast, createEventStream, createRoomEventStream } = createRuntimeEventBus({
    roomId: config.runtime.roomId,
    redactPayload,
    stateVersionForThread: (sessionKey) =>
        threadIndex.threads.find((thread) => thread.key === sessionKey)?.updatedAt,
})
const appendRuntimeEvent = createRuntimeEventAppender({
    config,
    redactPayload,
    broadcast,
})
const browserAutomation = new BrowserbaseBrowserAutomationManager({
    config,
    audit: appendRuntimeEvent,
    broadcast,
})
const {
    createModelRegistry,
    normalizeThinkingLevel,
    normalizeSpeedMode,
    availableSpeedModes,
    clampSpeedMode,
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
    if (isSessionCompactionLeaf(input.active.session.sessionManager)) return

    const contextBytes = estimateRuntimeMessageContextBytes(
        input.active.session.sessionManager.buildSessionContext().messages,
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
        const attachmentMetadata = promptAttachmentMetadataByEntryId(entries)
        return visibleProjectionEntries(entries)
            .map((entry, index) => mapSessionEntry(entry, index, completed, attachmentMetadata))
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
    await hostedRuntimeStateSync.upsert(config.paths.threadIndexPath)
}

async function restoreThreadIndex(input: {
    threads: ThreadRecord[]
    context: string
}): Promise<void> {
    threadIndex.threads.splice(0, threadIndex.threads.length, ...input.threads)
    try {
        await writeJsonFile(config.paths.threadIndexPath, threadIndex)
    } catch (error) {
        console.warn(
            `${input.context}: failed to restore local thread index`,
            error instanceof Error ? error.message : error,
        )
    }
}

async function deleteHostedRuntimeStateBestEffort(path: string, context: string): Promise<void> {
    try {
        await hostedRuntimeStateSync.delete(path)
    } catch (error) {
        console.warn(context, error instanceof Error ? error.message : error)
    }
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
    const before = [...threadIndex.threads]
    threadIndex.threads.splice(index, 1)
    try {
        await persistThreadIndex()
    } catch (error) {
        await restoreThreadIndex({
            threads: before,
            context: 'Thread delete rollback failed',
        })
        throw error
    }
    if (active) {
        active.abortController?.abort(
            new RunWatchdog('explicit_abort', timeoutMessage('explicit_abort')),
        )
        active.unsubscribe?.()
        active.session.dispose()
        activeThreads.delete(record.key)
    }
    await rm(record.sessionFile, { force: true })
    await deleteHostedRuntimeStateBestEffort(
        record.sessionFile,
        'Hosted deleted thread session cleanup failed',
    )
    await appendRuntimeEvent('thread.deleted', {
        sessionKey: record.key,
    })
    broadcast(record.key, 'thread.deleted', {
        sessionKey: record.key,
    })
}

async function createPiSession(record: ThreadRecord): Promise<AgentSession> {
    const session = await createPiRuntimeSession({
        config,
        record,
        systemPrompt: () => systemPrompt,
        mcpTools,
        browserAutomation,
        audit: appendRuntimeEvent,
        shortText,
        redactString,
        redactCommandOutput: redactUnboundedString,
        maxSubagentTaskChars,
        maxActiveSubagents,
        activeSubagentCount: () =>
            threadIndex.threads.filter(
                (thread) => thread.kind === 'subagent' && thread.status === 'running',
            ).length,
        maxDeepWorkObjectiveChars,
        maxDeepWorkResultChars,
        maxActiveDeepWork,
        activeDeepWorkCount: () =>
            activeDeepWorkReservations +
            threadIndex.threads.filter(
                (thread) => thread.kind === 'deep_work' && thread.status === 'running',
            ).length,
        reserveDeepWorkSlot: () => {
            activeDeepWorkReservations += 1
            let released = false
            return () => {
                if (released) {
                    return
                }
                released = true
                activeDeepWorkReservations = Math.max(0, activeDeepWorkReservations - 1)
            }
        },
        readMemoryBrief: async () => (await readMemory(config)).brief,
        createThread,
        findThread,
        runPrompt,
        readThreadMessages,
        persistThreadIndex,
    })
    if (record.kind === 'main') {
        await appendRuntimeEvent('deep_work.available', {
            threadKey: record.key,
            maxObjectiveChars: maxDeepWorkObjectiveChars,
            maxResultChars: maxDeepWorkResultChars,
            maxActive: maxActiveDeepWork,
        })
    }
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
        abortController: null,
        touchRunHeartbeat: null,
    }
    const sessionEventQueue = createSessionEventQueue<AgentSessionEvent>({
        handle: (event) => handleSessionEvent(record, event),
        onError: logSessionEventError,
    })
    active.unsubscribe = session.subscribe((event) => {
        sessionEventQueue.enqueue(event)
    })
    activeThreads.set(record.key, active)
    return active
}

function logSessionEventError(error: unknown, event: AgentSessionEvent): void {
    console.error(`Session event handler failed for ${event.type}`, error)
}

async function handleSessionEvent(record: ThreadRecord, event: AgentSessionEvent): Promise<void> {
    const active = activeThreads.get(record.key)
    await active?.touchRunHeartbeat?.(event.type)
    const deliveredPending = removeDeliveredPendingUserMessage(record, event)
    const pendingChanged = deliveredPending.changed
    const eventForLog = deliveredPending.event
    updateThreadFromMessages(record)
    if (eventForLog.type === 'agent_start' || eventForLog.type === 'turn_start') {
        record.status = 'running'
    }
    if (eventForLog.type === 'compaction_start') {
        record.status = 'compacting'
    }
    if (eventForLog.type === 'compaction_end') {
        record.status = eventForLog.errorMessage
            ? 'error'
            : active?.session.isStreaming || active?.session.isCompacting
              ? 'running'
              : 'idle'
        record.lastError = eventForLog.errorMessage ? redactString(eventForLog.errorMessage) : null
    }
    if (eventForLog.type === 'agent_end') {
        const latestError = latestAssistantErrorMessage(record)
        record.status = latestError ? 'error' : 'idle'
        record.lastError = latestError
        record.activeRunId = null
    }
    await persistThreadIndex()
    await hostedRuntimeStateSync.upsert(record.sessionFile)
    await appendRuntimeEvent(eventForLog.type, {
        sessionKey: record.key,
        event: eventForLog,
    })
    broadcast(record.key, eventForLog.type, {
        sessionKey: record.key,
        event: eventForLog,
    })
    if (pendingChanged) {
        await appendRuntimeEvent('thread.pending_messages_changed', {
            sessionKey: record.key,
            pendingCount: record.pendingUserMessages?.length ?? 0,
        })
        broadcast(record.key, 'thread.pending_messages_changed', {
            sessionKey: record.key,
            pendingCount: record.pendingUserMessages?.length ?? 0,
        })
    }
}

function findThread(key: string): ThreadRecord | null {
    return threadIndex.threads.find((thread) => thread.key === key) ?? null
}

function defaultSpeedModeForConfiguredProvider(): RoomExecutionModelState['speedMode'] {
    return config.provider.piProvider === 'openai-codex' &&
        config.provider.api === 'openai-codex-responses'
        ? 'normal'
        : null
}

async function createThread(
    input: {
        firstMessage?: string | null
        title?: string | null
        kind?: ThreadKind
        parentThreadKey?: string | null
        parentRunId?: string | null
        subagentRunId?: string | null
        subagentName?: string | null
        subagentTask?: string | null
        deepWorkRunId?: string | null
        deepWorkObjective?: string | null
        hideUserMessage?: boolean
        internalInstruction?: string | null
        awaitInitialRun?: boolean
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
        speedMode: defaultSpeedModeForConfiguredProvider(),
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
        deepWorkRunId: input.deepWorkRunId ?? null,
        deepWorkObjective: input.deepWorkObjective ?? null,
        completedAt: null,
    }
    const before = [...threadIndex.threads]
    threadIndex.threads.unshift(record)
    try {
        await persistThreadIndex()
    } catch (error) {
        await restoreThreadIndex({
            threads: before,
            context: 'Thread create rollback failed',
        })
        throw error
    }
    const instruction = input.internalInstruction?.trim() || input.firstMessage?.trim() || ''
    if (instruction) {
        await runPrompt({
            record,
            message: instruction,
            runId: randomUUID(),
            awaitCompletion: input.awaitInitialRun === true,
            hideUserMessage: input.hideUserMessage === true,
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
    speedMode?: RoomExecutionModelState['speedMode']
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
    input.record.speedMode = clampSpeedMode(
        normalizeSpeedMode(input.speedMode ?? input.record.speedMode),
        availableSpeedModes(model),
    )
    input.record.updatedAt = Date.now()
    await persistThreadIndex()
    await appendRuntimeEvent('thread.model_changed', {
        sessionKey: input.record.key,
        provider: input.record.modelProvider,
        model: input.record.model,
        thinkingLevel: input.record.thinkingLevel,
        speedMode: input.record.speedMode,
    })
    broadcast(input.record.key, 'thread.model_changed', {
        sessionKey: input.record.key,
        provider: input.record.modelProvider,
        model: input.record.model,
        thinkingLevel: input.record.thinkingLevel,
        speedMode: input.record.speedMode,
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
        speedMode: input.record.speedMode ?? defaultSpeedModeForConfiguredProvider(),
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
        deepWorkRunId: input.record.deepWorkRunId,
        deepWorkObjective: input.record.deepWorkObjective,
        completedAt: null,
    }
    updateThreadFromMessages(record)
    await hostedRuntimeStateSync.upsert(record.sessionFile)
    const before = [...threadIndex.threads]
    threadIndex.threads.unshift(record)
    try {
        await persistThreadIndex()
    } catch (error) {
        await restoreThreadIndex({
            threads: before,
            context: 'Thread fork rollback failed',
        })
        await deleteHostedRuntimeStateBestEffort(
            record.sessionFile,
            'Hosted forked thread session cleanup failed',
        )
        await rm(record.sessionFile, { force: true })
        throw error
    }
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
        browserSession: (sessionKey) => browserAutomation.snapshot(sessionKey),
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
    void browserAutomation.closeAll().finally(() => {
        void cleanupBackgroundCommands(config).finally(() => {
            void closeMcpConnections().finally(() => {
                void drainPendingHostedRuntimeUsage().finally(() => {
                    server.close(() => {
                        process.exit(0)
                    })
                })
            })
        })
    })
    setTimeout(() => process.exit(0), browserbaseRuntimeShutdownGraceMs).unref()
})

server.listen(config.runtime.port, config.runtime.bindHost, () => {
    void appendRuntimeEvent('runtime.started', {
        roomId: config.runtime.roomId,
        port: config.runtime.port,
    })
})
