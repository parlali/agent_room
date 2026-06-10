import type { AgentSession } from '@mariozechner/pi-coding-agent'
import type { AssistantMessage, Usage } from '@mariozechner/pi-ai'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import {
    appendHiddenProjectionForLatestUserMessage,
    appendHiddenProjectionForPromptText,
} from './hidden-projection'
import {
    preparePromptWithAttachments,
    promptAttachmentMetadataType,
    type PreparedPrompt,
} from './prompt-attachments'
import type { PendingUserMessageRecord, ThreadRecord } from './thread-records'
import { readMemory } from './memory'
import { withToolRunContext } from './tool-run-context'
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
import { sessionModelCostKnown, sessionUsageDelta, sessionUsageSnapshot } from './session-usage'
import {
    memoryCaptureExpectationReasons,
    memoryWasCaptured,
    summarizeRunToolActivity,
} from './runtime-tool-activity'
import { isSessionCompactionLeaf } from './session-compaction-state'

const zeroUsage: Usage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
    },
}

export interface ActiveThread {
    session: AgentSession
    unsubscribe: (() => void) | null
    queue: Promise<void>
    abortController: AbortController | null
    touchRunHeartbeat: ((reason: string) => Promise<void>) | null
}

export interface RunPromptInput {
    record: ThreadRecord
    message: string
    runId: string
    awaitCompletion: boolean
    runKind?: RunKind
    editMessageId?: string | null
    hideUserMessage?: boolean
}

interface RuntimeRunnerDependencies {
    config: PiRuntimeConfig
    activeThreads: Map<string, ActiveThread>
    refreshSystemPrompt: (active?: ActiveThread) => Promise<void>
    getActiveThread: (record: ThreadRecord) => Promise<ActiveThread>
    compactOversizedThreadContext: (input: {
        record: ThreadRecord
        active: ActiveThread
    }) => Promise<void>
    updateThreadFromMessages: (record: ThreadRecord) => void
    persistThreadIndex: () => Promise<void>
    broadcast: (sessionKey: string, event: string, payload: unknown) => void
    appendRuntimeEvent: (event: string, payload: unknown) => Promise<void>
    latestAssistantErrorMessage: (record: ThreadRecord) => string | null
    maybeGenerateThreadTitle: (record: ThreadRecord) => Promise<void>
    errorMessage: (error: unknown) => string
}

function assertPromptMetadataCanBePersisted(active: ActiveThread): void {
    const model = active.session.model
    if (!model) {
        throw new Error('No model is selected')
    }
    if (!active.session.modelRegistry.hasConfiguredAuth(model)) {
        throw new Error(`Model ${model.provider}/${model.id} is not authenticated`)
    }
}

function addPendingUserMessage(record: ThreadRecord, message: PendingUserMessageRecord): void {
    const current = record.pendingUserMessages ?? []
    if (current.some((candidate) => candidate.messageId === message.messageId)) return
    record.pendingUserMessages = [...current, message]
    record.updatedAt = Math.max(record.updatedAt, message.queuedAt)
}

function removePendingUserMessage(record: ThreadRecord, runId: string): void {
    const current = record.pendingUserMessages ?? []
    const next = current.filter((message) => message.runId !== runId)
    if (next.length === current.length) return
    record.pendingUserMessages = next
    record.updatedAt = Date.now()
}

async function appendAttachmentIngestionEvents(input: {
    dependencies: RuntimeRunnerDependencies
    record: ThreadRecord
    runId: string
    preparedPrompt: PreparedPrompt
}): Promise<void> {
    const ingestions = input.preparedPrompt.metadata?.ingestions ?? []
    for (const ingestion of ingestions) {
        await input.dependencies.appendRuntimeEvent('attachment.pdf_ingested', {
            sessionKey: input.record.key,
            runId: input.runId,
            attachmentId: ingestion.attachmentId,
            name: ingestion.name,
            relativePath: ingestion.relativePath,
            mediaType: ingestion.mediaType,
            ingestionMode: ingestion.ingestionMode,
            pageCount: ingestion.pageCount,
            pages: ingestion.pages,
            requestedPages: ingestion.requestedPages,
            inputBlocks: ingestion.inputBlocks,
            degraded: ingestion.degraded,
            degradedReason: ingestion.degradedReason,
        })
    }
}

function appendFailedPromptMessages(
    active: ActiveThread,
    input: RunPromptInput,
    message: string,
    timestamp: number,
): void {
    if (!input.hideUserMessage) {
        active.session.sessionManager.appendMessage({
            role: 'user',
            content: [
                {
                    type: 'text',
                    text: input.message,
                },
            ],
            timestamp,
        })
    }
    appendAssistantRunError(active, input.record, message, timestamp)
}

async function appendAssistantRunErrorIfMissing(input: {
    active: ActiveThread
    record: ThreadRecord
    message: string
    branchLengthBeforePrompt: number
}): Promise<void> {
    if (hasAssistantRunErrorSince(input.active, input.branchLengthBeforePrompt)) return
    appendAssistantRunError(input.active, input.record, input.message, Date.now())
}

function appendAssistantRunError(
    active: ActiveThread,
    record: ThreadRecord,
    message: string,
    timestamp: number,
): void {
    const assistantMessage: AssistantMessage = {
        role: 'assistant',
        content: [
            {
                type: 'text',
                text: providerFailureDisplayMessage(message),
            },
        ],
        api: active.session.model?.api ?? 'unknown',
        provider: active.session.model?.provider ?? record.modelProvider ?? 'unknown',
        model: record.model ?? active.session.model?.id ?? 'unknown',
        usage: zeroUsage,
        stopReason: 'error',
        errorMessage: message,
        timestamp,
    }
    active.session.sessionManager.appendMessage(assistantMessage)
}

function providerFailureDisplayMessage(message: string): string {
    if (isProviderPolicyRejection(message)) {
        return [
            'The model provider rejected this request under its safety policy, so Agent Room stopped the run without executing further work.',
            '',
            `Provider detail: ${message}`,
            '',
            'Try again with the defensive goal, authorized scope, and concrete artifact you want reviewed.',
        ].join('\n')
    }
    return [
        'The model provider failed before returning a response, so Agent Room stopped the run.',
        '',
        `Provider detail: ${message}`,
    ].join('\n')
}

function isProviderPolicyRejection(message: string): boolean {
    return /cyber_policy|cybersecurity|safety policy|content filter|content_filter|rejected|flagged/i.test(
        message,
    )
}

function hasAssistantRunErrorSince(active: ActiveThread, startIndex: number): boolean {
    return active.session.sessionManager
        .getBranch()
        .slice(startIndex)
        .some((entry: unknown) => isAssistantErrorEntry(entry))
}

function isAssistantErrorEntry(entry: unknown): boolean {
    if (!isRecord(entry)) return false
    if (entry.type !== 'message' || !isRecord(entry.message)) return false
    const message = entry.message
    if (message.role !== 'assistant') return false
    if (typeof message.errorMessage === 'string' && message.errorMessage.trim()) return true
    return message.stopReason === 'error'
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function restoreSessionLeaf(active: ActiveThread, leafId: string | null): void {
    if (leafId === null) {
        active.session.sessionManager.resetLeaf()
        return
    }
    active.session.sessionManager.branch(leafId)
}

export function createRuntimeRunPrompt(dependencies: RuntimeRunnerDependencies) {
    return async function runPrompt(input: RunPromptInput): Promise<string> {
        const execute = async () => {
            const runKind =
                input.runKind ??
                (input.record.kind === 'subagent'
                    ? 'subagent'
                    : input.record.kind === 'deep_work'
                      ? 'deep_work'
                      : 'manual')
            const budget = budgetForRunKind(dependencies.config.budgets, runKind)
            let heartbeat: RunHeartbeatRecord = createRunHeartbeat({
                runId: input.runId,
                runKind,
                budget,
            })
            let watchdogError: RunWatchdog | null = null
            let watchdog: ReturnType<typeof setInterval> | null = null
            let preparedPrompt: PreparedPrompt = {
                text: input.message,
            }
            let branchLengthBeforePrompt = 0
            let memoryHashBeforeRun: string | null = null
            let editLeafBeforeNavigation: string | null | undefined
            await dependencies.refreshSystemPrompt(dependencies.activeThreads.get(input.record.key))
            const active = await dependencies.getActiveThread(input.record)
            try {
                if (input.editMessageId) {
                    if (active.session.isStreaming || input.record.activeRunId) {
                        throw new Error('Cannot edit a message while a run is active')
                    }
                    const target = active.session.sessionManager.getEntry(input.editMessageId)
                    if (!target || target.type !== 'message' || target.message.role !== 'user') {
                        throw new Error('Only user messages on this thread can be edited')
                    }
                    editLeafBeforeNavigation = active.session.sessionManager.getLeafId()
                    const result = await active.session.navigateTree(input.editMessageId, {
                        summarize: false,
                    })
                    if (result.cancelled) {
                        throw new Error('Message edit was cancelled')
                    }
                    dependencies.updateThreadFromMessages(input.record)
                    await dependencies.persistThreadIndex()
                    await dependencies.appendRuntimeEvent('thread.message_edited', {
                        sessionKey: input.record.key,
                        runId: input.runId,
                        messageId: input.editMessageId,
                    })
                    dependencies.broadcast(input.record.key, 'thread.message_edited', {
                        sessionKey: input.record.key,
                        runId: input.runId,
                        messageId: input.editMessageId,
                    })
                }
                const skipPrePromptCompaction =
                    input.editMessageId && isSessionCompactionLeaf(active.session.sessionManager)
                if (!skipPrePromptCompaction) {
                    await dependencies.compactOversizedThreadContext({
                        record: input.record,
                        active,
                    })
                }
                preparedPrompt = await preparePromptWithAttachments({
                    config: dependencies.config,
                    model: active.session.model,
                    message: input.message,
                })
                if (preparedPrompt.metadata && active.session.isStreaming) {
                    throw new Error('Attached files cannot be queued while a run is active')
                }
                if (preparedPrompt.metadata) {
                    assertPromptMetadataCanBePersisted(active)
                }
            } catch (error) {
                let finalError = error
                if (input.editMessageId && editLeafBeforeNavigation !== undefined) {
                    try {
                        restoreSessionLeaf(active, editLeafBeforeNavigation)
                    } catch (restoreError) {
                        finalError = new Error(
                            [
                                dependencies.errorMessage(error),
                                `Failed to restore edited thread branch: ${dependencies.errorMessage(restoreError)}`,
                            ].join('\n'),
                        )
                    }
                }
                input.record.status = 'error'
                input.record.lastError = dependencies.errorMessage(finalError)
                if (!input.editMessageId) {
                    appendFailedPromptMessages(active, input, input.record.lastError, Date.now())
                    removePendingUserMessage(input.record, input.runId)
                }
                dependencies.updateThreadFromMessages(input.record)
                await dependencies.persistThreadIndex()
                dependencies.broadcast(input.record.key, 'run.error', {
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
                input.record.idleDurationMs = Math.max(
                    0,
                    heartbeat.heartbeatAt - previousHeartbeatAt,
                )
                await dependencies.persistThreadIndex()
                dependencies.broadcast(input.record.key, 'run.heartbeat', {
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
            dependencies.updateThreadFromMessages(input.record)
            await dependencies.persistThreadIndex()
            dependencies.broadcast(input.record.key, 'run.accepted', {
                sessionKey: input.record.key,
                runId: input.runId,
                runKind,
                runBudgetMs: budget.runBudgetMs,
                idleTimeoutMs: budget.idleTimeoutMs,
                startedAt: new Date(heartbeat.startedAt).toISOString(),
                startedAtMs: heartbeat.startedAt,
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
            branchLengthBeforePrompt = active.session.sessionManager.getBranch().length
            try {
                memoryHashBeforeRun = (await readMemory(dependencies.config)).hash
            } catch {
                memoryHashBeforeRun = null
            }
            try {
                await withToolRunContext(
                    {
                        sessionKey: input.record.key,
                        runId: input.runId,
                        signal: abortController.signal,
                    },
                    async () => {
                        if (preparedPrompt.metadata) {
                            active.session.sessionManager.appendCustomEntry(
                                promptAttachmentMetadataType,
                                preparedPrompt.metadata,
                            )
                        }
                        await appendAttachmentIngestionEvents({
                            dependencies,
                            record: input.record,
                            runId: input.runId,
                            preparedPrompt,
                        })
                        if (input.hideUserMessage) {
                            appendHiddenProjectionForPromptText(active.session, preparedPrompt.text)
                        }
                        const promptResult = await active.session.prompt(
                            preparedPrompt.text,
                            active.session.isStreaming
                                ? {
                                      streamingBehavior: 'followUp',
                                      source: 'rpc',
                                      images: preparedPrompt.images,
                                  }
                                : {
                                      source: 'rpc',
                                      images: preparedPrompt.images,
                                  },
                        )
                        if (input.hideUserMessage) {
                            appendHiddenProjectionForLatestUserMessage(active.session)
                        }
                        return promptResult
                    },
                )
                if (watchdogError) {
                    throw watchdogError
                }
                const latestError = dependencies.latestAssistantErrorMessage(input.record)
                input.record.status = latestError ? 'error' : 'idle'
                input.record.lastError = latestError
            } catch (error) {
                const abortReason =
                    abortController.signal.reason instanceof RunWatchdog
                        ? abortController.signal.reason
                        : watchdogError
                if (input.hideUserMessage) {
                    appendHiddenProjectionForLatestUserMessage(active.session)
                }
                if (abortReason?.reason === 'explicit_abort') {
                    input.record.status = 'idle'
                    input.record.lastError = null
                } else {
                    input.record.status = 'error'
                    input.record.lastError = dependencies.errorMessage(abortReason ?? error)
                    await appendAssistantRunErrorIfMissing({
                        active,
                        record: input.record,
                        message: input.record.lastError,
                        branchLengthBeforePrompt,
                    })
                    removePendingUserMessage(input.record, input.runId)
                }
                dependencies.broadcast(input.record.key, 'run.error', {
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
                input.record.activeDurationMs = durationMs
                input.record.idleDurationMs = idleDurationMs
                dependencies.updateThreadFromMessages(input.record)
                await dependencies.persistThreadIndex()
                const usage = sessionUsageDelta(
                    usageBefore,
                    sessionUsageSnapshot(active.session),
                    sessionModelCostKnown(active.session),
                )
                const toolActivity = summarizeRunToolActivity(
                    active.session.sessionManager.getBranch().slice(branchLengthBeforePrompt),
                )
                await dependencies.appendRuntimeEvent('run.finished', {
                    sessionKey: input.record.key,
                    runId: input.runId,
                    runKind,
                    status: input.record.status,
                    error: input.record.lastError,
                    provider: dependencies.config.provider.sourceProvider,
                    model: dependencies.config.provider.sourceModel,
                    durationMs,
                    activeDurationMs,
                    idleDurationMs,
                    usage,
                    startedAt: new Date(runStartedAt).toISOString(),
                    finishedAt: new Date(finishedAt).toISOString(),
                })
                dependencies.broadcast(input.record.key, 'run.finished', {
                    sessionKey: input.record.key,
                    runId: input.runId,
                    status: input.record.status,
                    error: input.record.lastError,
                    durationMs,
                    activeDurationMs,
                    idleDurationMs,
                    startedAt: new Date(runStartedAt).toISOString(),
                    finishedAt: new Date(finishedAt).toISOString(),
                })
                let memoryHashAfterRun: string | null = null
                try {
                    memoryHashAfterRun = (await readMemory(dependencies.config)).hash
                } catch (error) {
                    await dependencies.appendRuntimeEvent('memory.maintenance_failed', {
                        sessionKey: input.record.key,
                        runId: input.runId,
                        message: dependencies.errorMessage(error),
                    })
                }
                const captureReasons = memoryCaptureExpectationReasons(toolActivity)
                if (
                    input.record.status === 'idle' &&
                    captureReasons.length > 0 &&
                    !memoryWasCaptured({
                        beforeHash: memoryHashBeforeRun,
                        afterHash: memoryHashAfterRun,
                        counts: toolActivity,
                    })
                ) {
                    await dependencies.appendRuntimeEvent('memory.capture_expected_but_missing', {
                        sessionKey: input.record.key,
                        runId: input.runId,
                        runKind,
                        status: input.record.status,
                        reasons: captureReasons,
                        toolCounts: toolActivity,
                    })
                }
                void dependencies.maybeGenerateThreadTitle(input.record)
            }
        }

        const active = await dependencies.getActiveThread(input.record)
        if (!input.editMessageId && !input.hideUserMessage) {
            addPendingUserMessage(input.record, {
                messageId: input.runId,
                runId: input.runId,
                runKind:
                    input.runKind ??
                    (input.record.kind === 'subagent'
                        ? 'subagent'
                        : input.record.kind === 'deep_work'
                          ? 'deep_work'
                          : 'manual'),
                text: input.message,
                queuedAt: Date.now(),
            })
            await dependencies.persistThreadIndex()
            await dependencies.appendRuntimeEvent('thread.pending_messages_changed', {
                sessionKey: input.record.key,
                runId: input.runId,
                pendingCount: input.record.pendingUserMessages?.length ?? 0,
            })
            dependencies.broadcast(input.record.key, 'thread.pending_messages_changed', {
                sessionKey: input.record.key,
                runId: input.runId,
                pendingCount: input.record.pendingUserMessages?.length ?? 0,
            })
        }
        active.queue = active.queue.then(execute, execute)
        if (input.awaitCompletion) {
            await active.queue
        }
        return input.record.status
    }
}
