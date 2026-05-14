import type { AgentSession } from '@mariozechner/pi-coding-agent'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import {
    preparePromptWithAttachments,
    promptAttachmentMetadataType,
    type PreparedPrompt,
} from './prompt-attachments'
import type { ThreadRecord } from './thread-records'
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
                await dependencies.compactOversizedThreadContext({
                    record: input.record,
                    active,
                })
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
                input.record.status = 'error'
                input.record.lastError = dependencies.errorMessage(error)
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
                    () => {
                        if (preparedPrompt.metadata) {
                            active.session.sessionManager.appendCustomEntry(
                                promptAttachmentMetadataType,
                                preparedPrompt.metadata,
                            )
                        }
                        return active.session.prompt(
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
                if (abortReason?.reason === 'explicit_abort') {
                    input.record.status = 'idle'
                    input.record.lastError = null
                } else {
                    input.record.status = 'error'
                    input.record.lastError = dependencies.errorMessage(abortReason ?? error)
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
        active.queue = active.queue.then(execute, execute)
        if (input.awaitCompletion) {
            await active.queue
        }
        return input.record.status
    }
}
