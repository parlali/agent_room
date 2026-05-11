import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { isAbsolute, relative, sep } from 'node:path'
import {
    AuthStorage,
    createAgentSession,
    ModelRegistry,
    SessionManager,
    SettingsManager,
    type AgentSession,
    type AgentSessionEvent,
    type SessionEntry,
} from '@mariozechner/pi-coding-agent'
import { supportsXhigh, type Api, type Model } from '@mariozechner/pi-ai'
import { extractTextFromRuntimeContent } from '#/lib/runtime-message'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import type {
    RoomExecutionMessage,
    RoomExecutionModelOption,
    RoomExecutionModelState,
    RoomExecutionThinkingLevel,
    RoomFileChangedPayload,
    RoomFileChangeOperation,
    RoomExecutionThread,
} from '../rooms/execution-types'
import type { RoomFileSurface } from '../rooms/file-store'
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
import { extractSessionArtifacts } from './session-artifacts'
import {
    estimateSessionBranchContextBytes,
    proactiveCompactionContextBytes,
} from './session-context-budget'
import { createPiRuntimeSession } from './pi-runtime-session'
import { createPiResourceLoader } from './resource-loader'
import { createRuntimeEventBus } from './runtime-event-bus'
import { buildRuntimeSnapshot } from './runtime-snapshot'
import { createPiRuntimeRouter } from './pi-runtime-router'
import {
    sessionModelCostKnown,
    sessionUsageDelta,
    sessionUsageSnapshot,
    type RunUsageDelta,
} from './session-usage'

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
const { redactPayload, redactString, redactUnboundedString, errorMessage } =
    createRuntimeRedactor(config)
const activeThreads = new Map<string, ActiveThread>()
const threadIndex = await readJsonFile<ThreadIndexFile>(config.paths.threadIndexPath, {
    version: 1,
    threads: [],
})
let runtimeEventSeq = 0
const titleGenerationThreads = new Set<string>()

const maxSubagentTaskChars = 24000
const maxActiveSubagents = 5
const internalStoreRoots = new Set(['blobs', 'manifests', 'previews'])

type GeneratedThreadTitle = {
    title: string | null
    usage: RunUsageDelta
    durationMs: number
}

const THINKING_LEVELS: RoomExecutionThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high']
const THINKING_LEVELS_WITH_XHIGH: RoomExecutionThinkingLevel[] = [...THINKING_LEVELS, 'xhigh']

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
    redactPayload,
    stateVersionForThread: (sessionKey) =>
        threadIndex.threads.find((thread) => thread.key === sessionKey)?.updatedAt,
})

function normalizeFileChangeOperation(value: unknown): RoomFileChangeOperation {
    if (
        value === 'write' ||
        value === 'edit' ||
        value === 'artifact_import' ||
        value === 'artifact_export' ||
        value === 'upload'
    ) {
        return value
    }
    return 'runtime_activity'
}

function normalizeFileSurface(value: unknown): RoomFileSurface {
    return value === 'store' ? 'store' : 'workspace'
}

function rootPathForSurface(surface: RoomFileSurface): string {
    return surface === 'store' ? config.paths.storeDir : config.paths.workspaceDir
}

function normalizeVisibleRelativePath(surface: RoomFileSurface, path: unknown): string | null {
    if (typeof path !== 'string' || !path.trim()) {
        return null
    }
    const trimmed = path.trim()
    let relativePath = trimmed
    if (isAbsolute(trimmed)) {
        const display = relative(rootPathForSurface(surface), trimmed)
        if (display.startsWith('..') || isAbsolute(display)) {
            return null
        }
        relativePath = display
    }
    relativePath = relativePath
        .split(sep)
        .join('/')
        .replace(/^\.\/+/, '')
    if (!relativePath || relativePath === '.') {
        return null
    }
    if (surface === 'store') {
        const root = relativePath.split('/')[0] ?? relativePath
        if (internalStoreRoots.has(root)) {
            return null
        }
    }
    return relativePath
}

function roomFileChangedPayload(input: {
    payload: unknown
    sessionKey: string | null
    runId: string | null
}): RoomFileChangedPayload | null {
    const payload = isRecord(input.payload) ? input.payload : null
    const fileChange = isRecord(payload?.fileChange) ? payload.fileChange : null
    if (!fileChange) {
        return null
    }
    const surface = normalizeFileSurface(fileChange.root ?? payload?.root)
    const relativePath = normalizeVisibleRelativePath(surface, fileChange.path ?? payload?.path)
    if (!relativePath) {
        return null
    }
    return {
        roomId: config.runtime.roomId,
        sessionKey: input.sessionKey,
        runId: input.runId,
        surface,
        relativePath,
        operation: normalizeFileChangeOperation(fileChange.kind),
        byteLength:
            typeof fileChange.byteLength === 'number' && Number.isFinite(fileChange.byteLength)
                ? fileChange.byteLength
                : null,
        changedAt: Date.now(),
    }
}

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
    const fileChanged = roomFileChangedPayload({
        payload,
        sessionKey,
        runId,
    })
    if (fileChanged) {
        broadcast(sessionKey ?? '__room__', 'room.files.changed', fileChanged)
    }
}

function createModelRegistry(): ModelRegistry {
    return ModelRegistry.create(AuthStorage.create(config.paths.authPath), config.paths.modelsPath)
}

function normalizeThinkingLevel(value: unknown): RoomExecutionThinkingLevel {
    return typeof value === 'string' && (THINKING_LEVELS_WITH_XHIGH as string[]).includes(value)
        ? (value as RoomExecutionThinkingLevel)
        : 'medium'
}

function availableThinkingLevels(model: Model<Api> | undefined): RoomExecutionThinkingLevel[] {
    if (!model?.reasoning) return ['off']
    return supportsXhigh(model) ? THINKING_LEVELS_WITH_XHIGH : THINKING_LEVELS
}

function clampThinkingLevel(
    value: RoomExecutionThinkingLevel,
    levels: RoomExecutionThinkingLevel[],
): RoomExecutionThinkingLevel {
    if (levels.includes(value)) return value
    const requestedIndex = THINKING_LEVELS_WITH_XHIGH.indexOf(value)
    for (let index = requestedIndex; index < THINKING_LEVELS_WITH_XHIGH.length; index += 1) {
        const candidate = THINKING_LEVELS_WITH_XHIGH[index]!
        if (levels.includes(candidate)) return candidate
    }
    for (let index = requestedIndex - 1; index >= 0; index -= 1) {
        const candidate = THINKING_LEVELS_WITH_XHIGH[index]!
        if (levels.includes(candidate)) return candidate
    }
    return levels[0] ?? 'off'
}

function modelValue(provider: string, model: string): string {
    return `${provider}/${model}`
}

function modelLabel(model: Model<Api> | undefined, fallback: string): string {
    return model?.name?.trim() || fallback
}

function modelOption(model: Model<Api>): RoomExecutionModelOption {
    return {
        value: modelValue(model.provider, model.id),
        provider: model.provider,
        model: model.id,
        label: modelLabel(model, model.id),
        supportsReasoning: Boolean(model.reasoning),
        availableThinkingLevels: availableThinkingLevels(model),
    }
}

function modelOptions(registry: ModelRegistry, current?: Model<Api>): RoomExecutionModelOption[] {
    const provider = current?.provider ?? config.provider.piProvider
    const options = registry
        .getAll()
        .filter((model) => model.provider === provider)
        .map(modelOption)
        .sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true }))
    if (
        !current ||
        options.some((option) => option.value === modelValue(current.provider, current.id))
    ) {
        return options
    }
    return [modelOption(current), ...options]
}

function persistedThreadModel(record: ThreadRecord): {
    provider: string
    model: string
    thinkingLevel: RoomExecutionThinkingLevel
} {
    try {
        if (existsSync(record.sessionFile)) {
            const sessionManager = SessionManager.open(
                record.sessionFile,
                config.paths.sessionsDir,
                config.paths.workspaceDir,
            )
            const context = sessionManager.buildSessionContext()
            return {
                provider:
                    context.model?.provider ?? record.modelProvider ?? config.provider.piProvider,
                model: context.model?.modelId ?? record.model ?? config.provider.piModel,
                thinkingLevel: normalizeThinkingLevel(
                    context.thinkingLevel ?? record.thinkingLevel,
                ),
            }
        }
    } catch (error) {
        void error
    }
    return {
        provider: record.modelProvider ?? config.provider.piProvider,
        model: record.model ?? config.provider.piModel,
        thinkingLevel: normalizeThinkingLevel(record.thinkingLevel),
    }
}

function syncRecordModelState(record: ThreadRecord, session?: AgentSession): void {
    if (session?.model) {
        record.modelProvider = session.model.provider
        record.model = session.model.id
        record.thinkingLevel = normalizeThinkingLevel(session.thinkingLevel)
        return
    }
    const persisted = persistedThreadModel(record)
    record.modelProvider = persisted.provider
    record.model = persisted.model
    record.thinkingLevel = persisted.thinkingLevel
}

function selectedThreadModelState(record: ThreadRecord): RoomExecutionModelState | null {
    const active = activeThreads.get(record.key)
    const registry = createModelRegistry()
    const persisted = persistedThreadModel(record)
    const activeModel = active?.session.model
    const provider = activeModel?.provider ?? persisted.provider
    const modelId = activeModel?.id ?? persisted.model
    const model = activeModel ?? registry.find(provider, modelId)
    if (!model && !modelId) return null
    const levels = active?.session.getAvailableThinkingLevels() ?? availableThinkingLevels(model)
    const thinkingLevel = clampThinkingLevel(
        active ? normalizeThinkingLevel(active.session.thinkingLevel) : persisted.thinkingLevel,
        levels,
    )
    return {
        value: modelValue(provider, modelId),
        provider,
        model: modelId,
        label: modelLabel(model, modelId),
        thinkingLevel,
        availableThinkingLevels: levels,
        options: modelOptions(registry, model),
    }
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
    const title = cleanManualTitle(input.title)
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

async function maybeGenerateThreadTitle(record: ThreadRecord): Promise<void> {
    if (record.kind !== 'main') return
    if (record.titleSource !== 'initial') return
    if (record.status === 'running' || record.status === 'compacting') return
    if (titleGenerationThreads.has(record.key)) return

    titleGenerationThreads.add(record.key)
    try {
        const result = await generateThreadTitle(record)
        if (!result) return
        await appendRuntimeEvent('provider.finished', {
            sessionKey: record.key,
            purpose: 'thread_title',
            provider: config.provider.sourceProvider,
            model: config.provider.sourceModel,
            durationMs: result.durationMs,
            usage: result.usage,
        })
        if (!result.title || record.titleSource !== 'initial') return
        record.title = result.title
        record.titleSource = 'generated'
        record.updatedAt = Date.now()
        await persistThreadIndex()
        await appendRuntimeEvent('thread.title_generated', {
            sessionKey: record.key,
            title: result.title,
            source: 'main_model',
            provider: config.provider.sourceProvider,
            model: config.provider.sourceModel,
        })
        broadcast(record.key, 'thread.renamed', {
            sessionKey: record.key,
            title: result.title,
            source: 'generated',
        })
    } catch (error) {
        await appendRuntimeEvent('thread.title_generation_failed', {
            sessionKey: record.key,
            error: errorMessage(error),
        })
    } finally {
        titleGenerationThreads.delete(record.key)
    }
}

async function generateThreadTitle(record: ThreadRecord): Promise<GeneratedThreadTitle | null> {
    const messages = readThreadMessages(record, 20)
    const firstUser = messages.find((message) => message.role === 'user' && message.text.trim())
    const firstAssistant = messages.find(
        (message) => message.role === 'assistant' && message.text.trim(),
    )
    if (!firstUser || !firstAssistant) return null

    const authStorage = AuthStorage.create(config.paths.authPath)
    const modelRegistry = ModelRegistry.create(authStorage, config.paths.modelsPath)
    const model = modelRegistry.find(config.provider.piProvider, config.provider.piModel)
    if (!model) {
        throw new Error(
            `Pi model ${config.provider.piProvider}/${config.provider.piModel} is not available`,
        )
    }
    const settingsManager = SettingsManager.inMemory({
        retry: {
            enabled: false,
            provider: {
                timeoutMs: config.budgets.providerIdleTimeoutMs,
                maxRetries: 0,
                maxRetryDelayMs: 0,
            },
        },
    })
    const sessionManager = SessionManager.inMemory(config.paths.workspaceDir)
    sessionManager.newSession({ id: randomUUID() })
    const { session } = await createAgentSession({
        cwd: config.paths.workspaceDir,
        agentDir: config.paths.stateDir,
        authStorage,
        modelRegistry,
        model,
        thinkingLevel: 'low',
        resourceLoader: createPiResourceLoader(
            'You write concise conversation titles. Return only the title text.',
        ),
        sessionManager,
        settingsManager,
        noTools: 'all',
    })

    try {
        const startedAt = Date.now()
        const usageBefore = sessionUsageSnapshot(session)
        await session.prompt(titlePrompt(firstUser.text, firstAssistant.text), {
            source: 'rpc',
        })
        const durationMs = Math.max(0, Date.now() - startedAt)
        const usage = sessionUsageDelta(
            usageBefore,
            sessionUsageSnapshot(session),
            sessionModelCostKnown(session),
        )
        return {
            title: cleanGeneratedTitle(latestAssistantText(session.messages)),
            usage,
            durationMs,
        }
    } finally {
        session.dispose()
    }
}

function titlePrompt(firstUser: string, firstAssistant: string): string {
    return [
        'Create a short title for this conversation.',
        'Rules: 3 to 8 words, no quotes, no trailing punctuation, no generic words like Conversation.',
        '',
        `User: ${shortText(firstUser, 800)}`,
        '',
        `Assistant: ${shortText(firstAssistant, 800)}`,
    ].join('\n')
}

function latestAssistantText(messages: unknown[]): string {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index]
        if (!isRecord(message) || message.role !== 'assistant') continue
        const text = extractTextFromRuntimeContent(message.content)
        if (text.trim()) return text
    }
    return ''
}

function cleanManualTitle(value: string): string {
    return value.replace(/\s+/g, ' ').trim().slice(0, 200)
}

function cleanGeneratedTitle(value: string): string | null {
    const cleaned = value
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^["'`]+|["'`.!?]+$/g, '')
        .trim()
    if (cleaned.length < 3) return null
    if (/^conversation$/i.test(cleaned)) return null
    return shortText(cleaned, 80)
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

async function runPrompt(input: {
    record: ThreadRecord
    message: string
    runId: string
    awaitCompletion: boolean
    runKind?: RunKind
    editMessageId?: string | null
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
        try {
            if (input.editMessageId) {
                if (active.session.isStreaming || input.record.activeRunId) {
                    throw new Error('Cannot edit a message while a run is active')
                }
                const target = active.session.sessionManager.getEntry(input.editMessageId)
                if (!target || target.type !== 'message' || target.message.role !== 'user') {
                    throw new Error('Only user messages on this thread can be edited')
                }
                const result = await active.session.navigateTree(input.editMessageId, {
                    summarize: false,
                })
                if (result.cancelled) {
                    throw new Error('Message edit was cancelled')
                }
                updateThreadFromMessages(input.record)
                await persistThreadIndex()
            }
            await compactOversizedThreadContext({
                record: input.record,
                active,
            })
        } catch (error) {
            input.record.status = 'error'
            input.record.lastError = errorMessage(error)
            updateThreadFromMessages(input.record)
            await persistThreadIndex()
            broadcast(input.record.key, 'run.error', {
                sessionKey: input.record.key,
                runId: input.runId,
                message: input.record.lastError,
                reason: null,
            })
            return
        }
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
        const usageBefore = sessionUsageSnapshot(active.session)
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
            const usage = sessionUsageDelta(
                usageBefore,
                sessionUsageSnapshot(active.session),
                sessionModelCostKnown(active.session),
            )
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
                usage,
                startedAt: new Date(runStartedAt).toISOString(),
                finishedAt: new Date(finishedAt).toISOString(),
            })
            broadcast(input.record.key, 'run.finished', {
                sessionKey: input.record.key,
                runId: input.runId,
                status: input.record.status,
                error: input.record.lastError,
            })
            void maybeGenerateThreadTitle(input.record)
        }
    }

    const active = await getActiveThread(input.record)
    active.queue = active.queue.then(execute, execute)
    if (input.awaitCompletion) {
        await active.queue
    }
    return input.record.status
}

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
