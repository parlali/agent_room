import { randomUUID } from 'node:crypto'
import {
    type AgentSession,
    AuthStorage,
    createAgentSession,
    ModelRegistry,
    SessionManager,
    SettingsManager,
} from '@mariozechner/pi-coding-agent'
import { extractTextFromRuntimeContent } from '#/domain/runtime-message'
import type { RoomExecutionMessage } from '../rooms/execution-types'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import { hostedRuntimeManagedOpenRouterEnvKey } from '../rooms/pi-runtime-contract'
import type { ThreadRecord } from './thread-records'
import { createPiResourceLoader } from './resource-loader'
import { isRecord } from './runtime-redaction'
import { shortText } from './session-entry-mapper'
import {
    runUsageDeltaWithActualCostMicros,
    sessionModelCostKnown,
    sessionUsageDelta,
    sessionUsageSnapshot,
    type RunUsageDelta,
} from './session-usage'
import {
    hostedProviderReservationCollectionFromError,
    hostedProviderUsageChargeCostMicros,
    withHostedProviderReservationCollection,
    type HostedProviderUsageCharge,
} from './hosted-provider-reservation-context'

interface GeneratedThreadTitle {
    title: string | null
    usage: RunUsageDelta
    durationMs: number
    hostedProviderReservationIds: string[]
    hostedProviderUsageCharges: HostedProviderUsageCharge[]
    error: string | null
}

interface ThreadTitleGeneratorDependencies {
    config: PiRuntimeConfig
    readThreadMessages: (record: ThreadRecord, limit: number) => RoomExecutionMessage[]
    persistThreadIndex: () => Promise<void>
    appendRuntimeEvent: (event: string, payload: unknown) => Promise<void>
    broadcast: (sessionKey: string, event: string, payload: unknown) => void
    errorMessage: (error: unknown) => string
}

export function cleanManualThreadTitle(value: string): string {
    return value.replace(/\s+/g, ' ').trim().slice(0, 200)
}

export function createThreadTitleGenerator(dependencies: ThreadTitleGeneratorDependencies) {
    const titleGenerationThreads = new Set<string>()

    function modelCostKnown(session: AgentSession): boolean {
        return process.env[hostedRuntimeManagedOpenRouterEnvKey] === '1'
            ? false
            : sessionModelCostKnown(session)
    }

    async function generateThreadTitle(record: ThreadRecord): Promise<GeneratedThreadTitle | null> {
        const messages = dependencies.readThreadMessages(record, 20)
        const firstUser = messages.find((message) => message.role === 'user' && message.text.trim())
        const firstAssistant = messages.find(
            (message) => message.role === 'assistant' && message.text.trim(),
        )
        if (!firstUser || !firstAssistant) return null

        const authStorage = AuthStorage.create(dependencies.config.paths.authPath)
        const modelRegistry = ModelRegistry.create(
            authStorage,
            dependencies.config.paths.modelsPath,
        )
        const model = modelRegistry.find(
            dependencies.config.provider.piProvider,
            dependencies.config.provider.piModel,
        )
        if (!model) {
            throw new Error(
                `Pi model ${dependencies.config.provider.piProvider}/${dependencies.config.provider.piModel} is not available`,
            )
        }
        const settingsManager = SettingsManager.inMemory({
            retry: {
                enabled: false,
                provider: {
                    timeoutMs: dependencies.config.budgets.providerIdleTimeoutMs,
                    maxRetries: 0,
                    maxRetryDelayMs: 0,
                },
            },
        })
        const sessionManager = SessionManager.inMemory(dependencies.config.paths.workspaceDir)
        sessionManager.newSession({ id: randomUUID() })
        const { session } = await createAgentSession({
            cwd: dependencies.config.paths.workspaceDir,
            agentDir: dependencies.config.paths.stateDir,
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
            let prompt: Awaited<ReturnType<typeof withHostedProviderReservationCollection>>
            try {
                prompt = await withHostedProviderReservationCollection(
                    async () =>
                        session.prompt(titlePrompt(firstUser.text, firstAssistant.text), {
                            source: 'rpc',
                        }),
                    {
                        sessionKey: record.key,
                        runId: null,
                        jobId: null,
                    },
                )
            } catch (error) {
                const collection = hostedProviderReservationCollectionFromError(error)
                if (!collection || collection.reservationIds.length === 0) {
                    throw error
                }
                const durationMs = Math.max(0, Date.now() - startedAt)
                const usage = runUsageDeltaWithActualCostMicros(
                    sessionUsageDelta(
                        usageBefore,
                        sessionUsageSnapshot(session),
                        modelCostKnown(session),
                    ),
                    hostedProviderUsageChargeCostMicros(collection.usageCharges),
                )
                return {
                    title: null,
                    usage,
                    durationMs,
                    hostedProviderReservationIds: collection.reservationIds,
                    hostedProviderUsageCharges: collection.usageCharges,
                    error: dependencies.errorMessage(error),
                }
            }
            const durationMs = Math.max(0, Date.now() - startedAt)
            const usage = runUsageDeltaWithActualCostMicros(
                sessionUsageDelta(
                    usageBefore,
                    sessionUsageSnapshot(session),
                    modelCostKnown(session),
                ),
                hostedProviderUsageChargeCostMicros(prompt.usageCharges),
            )
            return {
                title: cleanGeneratedTitle(latestAssistantText(session.messages)),
                usage,
                durationMs,
                hostedProviderReservationIds: prompt.reservationIds,
                hostedProviderUsageCharges: prompt.usageCharges,
                error: null,
            }
        } finally {
            session.dispose()
        }
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
            await dependencies.appendRuntimeEvent('provider.finished', {
                sessionKey: record.key,
                purpose: 'thread_title',
                provider: dependencies.config.provider.sourceProvider,
                model: dependencies.config.provider.sourceModel,
                durationMs: result.durationMs,
                usage: result.usage,
                ...(result.hostedProviderReservationIds.length > 0
                    ? { hostedProviderReservationIds: result.hostedProviderReservationIds }
                    : {}),
                ...(result.hostedProviderUsageCharges.length > 0
                    ? { hostedProviderUsageCharges: result.hostedProviderUsageCharges }
                    : {}),
                ...(result.error ? { error: result.error } : {}),
            })
            if (result.error) {
                await dependencies.appendRuntimeEvent('thread.title_generation_failed', {
                    sessionKey: record.key,
                    error: result.error,
                })
                return
            }
            if (!result.title || record.titleSource !== 'initial') return
            record.title = result.title
            record.titleSource = 'generated'
            record.updatedAt = Date.now()
            await dependencies.persistThreadIndex()
            await dependencies.appendRuntimeEvent('thread.title_generated', {
                sessionKey: record.key,
                title: result.title,
                source: 'main_model',
                provider: dependencies.config.provider.sourceProvider,
                model: dependencies.config.provider.sourceModel,
            })
            dependencies.broadcast(record.key, 'thread.renamed', {
                sessionKey: record.key,
                title: result.title,
                source: 'generated',
            })
        } catch (error) {
            await dependencies.appendRuntimeEvent('thread.title_generation_failed', {
                sessionKey: record.key,
                error: dependencies.errorMessage(error),
            })
        } finally {
            titleGenerationThreads.delete(record.key)
        }
    }

    return {
        maybeGenerateThreadTitle,
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
