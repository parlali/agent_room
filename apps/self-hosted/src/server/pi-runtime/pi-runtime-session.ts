import { existsSync } from 'node:fs'
import {
    AuthStorage,
    createAgentSession,
    ModelRegistry,
    SessionManager,
    SettingsManager,
    type AgentSession,
    type ToolDefinition,
} from '@mariozechner/pi-coding-agent'
import { type Api, type Model, type SimpleStreamOptions, supportsXhigh } from '@mariozechner/pi-ai'
import {
    type OpenAICodexResponsesOptions,
    streamOpenAICodexResponses,
} from '@mariozechner/pi-ai/openai-codex-responses'
import type { RoomExecutionMessage } from '../rooms/execution-types'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import type { PiRuntimeThreadCreatePayload } from './protocol'
import { createPiResourceLoader } from './resource-loader'
import type { createMcpTools } from './mcp-bridge'
import { createInternalStateTools } from './internal-state-tools'
import { createNativeWorkspaceTools } from './native-workspace-tools'
import { createRoomTools, nativeWorkspaceToolNamesForCapabilities } from './room-tools'
import { createUrlFetchTools, createWebTools } from './web-tools'
import { createBrowserAutomationTools } from './browserbase-tools'
import type { BrowserAutomationController } from './browserbase-browser-types'
import { createDocumentTools } from './document-tools'
import { createImageTools } from './image-tools'
import { createSubagentTool } from './subagent-tool'
import { createDeepWorkTool } from './deep-work-tool'
import { rewriteNativePdfPayload } from './pdf-document-payload'
import type { ThreadKind, ThreadRecord } from './thread-records'
import type { RunKind } from './run-budget'
import { codexServiceTierForSpeedMode } from './runtime-speed-mode'
import {
    createOnboardingPersonalityTool,
    onboardingSystemPrompt,
} from './onboarding-personality-tool'

type CodexResponsesModel = Model<'openai-codex-responses'>

export interface PiRuntimeSessionInput {
    config: PiRuntimeConfig
    record: ThreadRecord
    systemPrompt: () => string
    mcpTools: Awaited<ReturnType<typeof createMcpTools>>
    browserAutomation: BrowserAutomationController
    audit: (event: string, payload: unknown) => Promise<void>
    shortText: (value: string, length?: number) => string
    redactString: (value: string) => string
    redactCommandOutput: (value: string) => string
    maxSubagentTaskChars: number
    maxActiveSubagents: number
    activeSubagentCount: () => number
    maxDeepWorkObjectiveChars: number
    maxDeepWorkResultChars: number
    maxActiveDeepWork: number
    activeDeepWorkCount: () => number
    reserveDeepWorkSlot: () => () => void
    readMemoryBrief: () => Promise<string>
    createThread: (input?: {
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
    }) => Promise<PiRuntimeThreadCreatePayload>
    findThread: (key: string) => ThreadRecord | null
    runPrompt: (input: {
        record: ThreadRecord
        message: string
        runId: string
        awaitCompletion: boolean
        runKind?: RunKind
    }) => Promise<string>
    readThreadMessages: (record: ThreadRecord, limit: number) => RoomExecutionMessage[]
    persistThreadIndex: () => Promise<void>
}

function isCodexResponsesModel(model: Model<Api>): model is CodexResponsesModel {
    return model.provider === 'openai-codex' && model.api === 'openai-codex-responses'
}

function codexReasoningEffort(
    model: CodexResponsesModel,
    reasoning: SimpleStreamOptions['reasoning'],
): OpenAICodexResponsesOptions['reasoningEffort'] {
    if (!reasoning) return undefined
    return supportsXhigh(model) ? reasoning : reasoning === 'xhigh' ? 'high' : reasoning
}

export function createPiRuntimeCustomTools(input: PiRuntimeSessionInput): ToolDefinition[] {
    const { config, record } = input
    if (record.kind === 'onboarding') {
        return [
            createOnboardingPersonalityTool({
                config,
                audit: input.audit,
            }),
            ...createUrlFetchTools({
                config,
                audit: input.audit,
            }),
        ]
    }
    return [
        ...createNativeWorkspaceTools({
            config,
            audit: input.audit,
        }),
        ...createInternalStateTools({
            config,
            audit: input.audit,
        }),
        ...createRoomTools({
            config,
            audit: input.audit,
            redactString: input.redactString,
            redactCommandOutput: input.redactCommandOutput,
        }),
        ...createWebTools({
            config,
            audit: input.audit,
        }),
        ...createBrowserAutomationTools({
            config,
            record,
            browserAutomation: input.browserAutomation,
        }),
        ...createDocumentTools({
            config,
            audit: input.audit,
        }),
        ...createImageTools({
            config,
            audit: input.audit,
        }),
        ...(record.kind === 'main'
            ? [
                  createSubagentTool({
                      parentRecord: record,
                      maxTaskChars: input.maxSubagentTaskChars,
                      activeCount: input.activeSubagentCount,
                      maxActive: input.maxActiveSubagents,
                      shortText: input.shortText,
                      redactString: input.redactString,
                      createThread: input.createThread,
                      findThread: input.findThread,
                      runPrompt: input.runPrompt,
                      readThreadMessages: input.readThreadMessages,
                      audit: input.audit,
                  }),
                  createDeepWorkTool({
                      parentRecord: record,
                      maxObjectiveChars: input.maxDeepWorkObjectiveChars,
                      maxResultChars: input.maxDeepWorkResultChars,
                      activeCount: input.activeDeepWorkCount,
                      maxActive: input.maxActiveDeepWork,
                      shortText: input.shortText,
                      redactString: input.redactString,
                      readMemoryBrief: input.readMemoryBrief,
                      reserveActive: input.reserveDeepWorkSlot,
                      createThread: input.createThread,
                      findThread: input.findThread,
                      runPrompt: input.runPrompt,
                      readThreadMessages: input.readThreadMessages,
                      persistThreadIndex: input.persistThreadIndex,
                      audit: input.audit,
                  }),
              ]
            : []),
        ...input.mcpTools,
    ]
}

export function enabledToolNamesForSession(
    config: PiRuntimeConfig,
    customTools: readonly ToolDefinition[],
): string[] {
    return Array.from(
        new Set([
            ...nativeWorkspaceToolNamesForCapabilities(config.capabilities),
            ...customTools.map((tool) => tool.name),
        ]),
    )
}

export async function createPiRuntimeSession(input: PiRuntimeSessionInput): Promise<AgentSession> {
    const { config, record } = input
    const authStorage = AuthStorage.create(config.paths.authPath)
    const modelRegistry = ModelRegistry.create(authStorage, config.paths.modelsPath)
    const sessionExists = existsSync(record.sessionFile)
    const configuredModel = modelRegistry.find(config.provider.piProvider, config.provider.piModel)
    if (!configuredModel) {
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
                timeoutMs: config.budgets.providerIdleTimeoutMs,
                maxRetries: 0,
                maxRetryDelayMs: 0,
            },
        },
    })
    const sessionManager = sessionExists
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
    const hasPersistedModelState = sessionManager
        .getBranch()
        .some((entry) => entry.type === 'model_change' || entry.type === 'thinking_level_change')
    const customTools = createPiRuntimeCustomTools(input)
    const enabledTools = enabledToolNamesForSession(config, customTools)
    const { session } = await createAgentSession({
        cwd: config.paths.workspaceDir,
        agentDir: config.paths.stateDir,
        authStorage,
        modelRegistry,
        model: hasPersistedModelState ? undefined : configuredModel,
        thinkingLevel: hasPersistedModelState ? undefined : (record.thinkingLevel ?? 'medium'),
        resourceLoader: createPiResourceLoader(() =>
            record.kind === 'onboarding'
                ? onboardingSystemPrompt(input.systemPrompt())
                : input.systemPrompt(),
        ),
        sessionManager,
        settingsManager,
        tools: enabledTools,
        customTools,
    })
    const streamWithRuntimeOptions = session.agent.streamFn
    session.agent.streamFn = async (model, context, options) => {
        const serviceTier = codexServiceTierForSpeedMode(model, record.speedMode)
        if (!serviceTier || !isCodexResponsesModel(model)) {
            return streamWithRuntimeOptions(model, context, options)
        }
        const auth = await modelRegistry.getApiKeyAndHeaders(model)
        if (!auth.ok) {
            throw new Error(auth.error)
        }
        const providerRetrySettings = settingsManager.getProviderRetrySettings()
        return streamOpenAICodexResponses(model, context, {
            ...options,
            apiKey: auth.apiKey,
            timeoutMs: options?.timeoutMs ?? providerRetrySettings.timeoutMs,
            maxRetries: options?.maxRetries ?? providerRetrySettings.maxRetries,
            maxRetryDelayMs: options?.maxRetryDelayMs ?? providerRetrySettings.maxRetryDelayMs,
            headers:
                auth.headers || options?.headers
                    ? { ...auth.headers, ...options?.headers }
                    : undefined,
            reasoningEffort: codexReasoningEffort(model, options?.reasoning),
            serviceTier,
        })
    }
    session.agent.onPayload = async (payload, model) => {
        const rewritten = rewriteNativePdfPayload(payload)
        if (rewritten.count > 0) {
            await input.audit('attachment.pdf_native_payload_mapped', {
                provider: config.provider.sourceProvider,
                model: config.provider.sourceModel,
                piProvider: model.provider,
                piModel: model.id,
                documentBlocks: rewritten.count,
            })
        }
        return rewritten.payload
    }
    session.setAutoCompactionEnabled(config.compaction.enabled)
    session.setAutoRetryEnabled(false)
    return session
}
