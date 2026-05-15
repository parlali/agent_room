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
import type { RoomExecutionMessage } from '../rooms/execution-types'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import type { PiRuntimeThreadCreatePayload } from './protocol'
import { createPiResourceLoader } from './resource-loader'
import type { createMcpTools } from './mcp-bridge'
import { createInternalStateTools } from './internal-state-tools'
import { createRoomTools } from './room-tools'
import { createWebTools } from './web-tools'
import { createDocumentTools } from './document-tools'
import { createImageTools } from './image-tools'
import { createSubagentTool } from './subagent-tool'
import { createDeepWorkTool } from './deep-work-tool'
import { rewriteNativePdfPayload } from './pdf-document-payload'
import type { ThreadKind, ThreadRecord } from './thread-records'
import type { RunKind } from './run-budget'

export interface PiRuntimeSessionInput {
    config: PiRuntimeConfig
    record: ThreadRecord
    systemPrompt: () => string
    mcpTools: Awaited<ReturnType<typeof createMcpTools>>
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

export function createPiRuntimeCustomTools(input: PiRuntimeSessionInput): ToolDefinition[] {
    const { config, record } = input
    return [
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
    const { session } = await createAgentSession({
        cwd: config.paths.workspaceDir,
        agentDir: config.paths.stateDir,
        authStorage,
        modelRegistry,
        model: hasPersistedModelState ? undefined : configuredModel,
        thinkingLevel: hasPersistedModelState ? undefined : (record.thinkingLevel ?? 'medium'),
        resourceLoader: createPiResourceLoader(input.systemPrompt),
        sessionManager,
        settingsManager,
        tools: customTools.map((tool) => tool.name),
        customTools,
    })
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
