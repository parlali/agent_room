import type {
    HealthStatus,
    JsonValue,
    RoomDesiredState,
    RoomMode,
    RoomStatus,
} from './domain-types'
import type { RoomFileSurface } from './room-file-types'
import type { JobSchedule } from '#/lib/job-schedule'

export interface RoomRuntimeOverview {
    roomId: string
    displayName: string
    slug: string
    status: RoomStatus
    desiredState: RoomDesiredState
    roomMode: RoomMode
    healthStatus: HealthStatus | null
    port: number | null
    pid: number | null
    lastError: string | null
    lastHealthAt: string | null
}

export interface RoomExecutionAgent {
    id: string
    name: string | null
    workspace: string | null
    modelPrimary: string | null
    modelFallbacks: string[]
    identity: {
        name: string | null
        theme: string | null
        emoji: string | null
        avatarUrl: string | null
    }
    threadCount: number
    activeThreadCount: number
    latestActivityAt: number | null
}

export interface RoomExecutionThread {
    key: string
    sessionId: string | null
    agentId: string
    kind: 'main' | 'subagent'
    parentThreadKey: string | null
    title: string
    lastMessagePreview: string | null
    status: string | null
    updatedAt: number | null
    runStartedAt: number | null
    runtimeMs: number | null
    model: string | null
    modelProvider: string | null
    totalTokens: number | null
    estimatedCostUsd: number | null
    readState: {
        readAt: number | null
        unread: boolean
    }
    compaction: {
        enabled: boolean
        compacting: boolean
        count: number
        lastCompactedAt: number | null
        lastTokensBefore: number | null
        lastError: string | null
    }
}

export type RoomExecutionThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export interface RoomExecutionModelOption {
    value: string
    provider: string
    model: string
    label: string
    supportsReasoning: boolean
    availableThinkingLevels: RoomExecutionThinkingLevel[]
}

export interface RoomExecutionModelState {
    value: string
    provider: string
    model: string
    label: string
    thinkingLevel: RoomExecutionThinkingLevel
    availableThinkingLevels: RoomExecutionThinkingLevel[]
    options: RoomExecutionModelOption[]
}

export interface RoomExecutionMessage {
    id: string
    role: 'user' | 'assistant' | 'tool' | 'system' | 'other'
    text: string
    parts: RoomExecutionMessagePart[]
    timestamp: number | null
}

export interface RoomExecutionMessagePart {
    type: 'text' | 'tool_call' | 'tool_result' | 'raw'
    text: string
    toolName: string | null
    toolCallId: string | null
    status: string | null
    input: JsonValue
    result: JsonValue
    rawType: string | null
}

export type RoomSessionArtifactKind = 'attached' | 'created' | 'edited' | 'referenced'

export interface RoomSessionArtifact {
    id: string
    name: string
    surface: RoomFileSurface
    relativePath: string
    kind: RoomSessionArtifactKind
    source: string
    toolName: string | null
    operation: string | null
    artifactId: string | null
    byteLength: number | null
    timestamp: number | null
    messageId: string | null
}

export interface RoomExecutionCapabilities {
    canStreamTokens: boolean
    canStreamToolEvents: boolean
    canAbortGeneration: boolean
    canEditMessages: boolean
    editMessageUnsupportedReason: string | null
}

export interface RoomExecutionActivity {
    key: string
    agentId: string
    title: string
    status: string | null
    updatedAt: number | null
    runtimeMs: number | null
    totalTokens: number | null
    estimatedCostUsd: number | null
}

export interface RoomExecutionSnapshot {
    room: RoomRuntimeOverview
    executionState: 'connected' | 'unavailable' | 'error'
    executionMessage: string | null
    capabilities: RoomExecutionCapabilities
    roomAgent: RoomExecutionAgent | null
    extraAgentIds: string[]
    threads: RoomExecutionThread[]
    selectedThreadKey: string | null
    selectedThreadModel: RoomExecutionModelState | null
    selectedThreadMessages: RoomExecutionMessage[]
    selectedThreadArtifacts: RoomSessionArtifact[]
    recentActivity: RoomExecutionActivity[]
}

export interface RoomThreadSendResult {
    runId: string | null
    status: string
    messageSeq: number | null
    interruptedActiveRun: boolean
    error: string | null
}

export interface RoomThreadAbortResult {
    abortedRunId: string | null
    status: string
}

export interface RoomThreadCompactResult {
    status: string
    error: string | null
    compactionCount: number
}

export interface RoomThreadForkResult {
    key: string
    parentThreadKey: string
    parentSessionFile: string
}

export interface RoomRealtimeEvent {
    event: string
    payload: unknown
    seq: number | null
    stateVersion: unknown
    receivedAt: number
}

export type RoomFileChangeOperation =
    | 'write'
    | 'edit'
    | 'artifact_import'
    | 'artifact_export'
    | 'upload'
    | 'runtime_activity'

export interface RoomFileChangedPayload {
    roomId: string
    sessionKey: string | null
    runId: string | null
    surface: RoomFileSurface
    relativePath: string | null
    operation: RoomFileChangeOperation
    byteLength: number | null
    changedAt: number
}

export interface RoomCronJob {
    id: string
    agentId: string | null
    sessionKey: string | null
    name: string
    description: string | null
    enabled: boolean
    sessionTarget: string | null
    wakeMode: string | null
    everyMinutes: number
    schedule: JobSchedule
    timezone: string
    scheduleSummary: string
    payloadSummary: string | null
    nextRunAt: number | null
    runningAt: number | null
    lastRunAt: number | null
    lastRunStatus: string | null
    lastError: string | null
    lastDurationMs: number | null
}

export interface RoomAgentExecutionTruth {
    agentId: string
    workspacePath: string | null
    memoryPath: string
    sessionsPath: string
    memoryExists: boolean
    sessionsExists: boolean
    sessionFileCount: number
    latestSessionUpdateAt: number | null
}

export interface RoomExecutionTruthSnapshot {
    roomId: string
    stateDirPath: string
    workspaceDirPath: string
    storeDirPath: string
    runtimeConfigPath: string
    runtimeMetadataPath: string
    runtimeHealthPath: string
    runtimeMetadataFile: {
        port: number | null
        pid: number | null
        startedAt: string | null
        configVersion: number | null
        tokenVersion: number | null
    } | null
    runtimeHealthFile: {
        healthy: boolean
        message: string
        checkedAt: string
    } | null
    runtimeConfigFile: {
        bind: string | null
        port: number | null
        workspace: string | null
    } | null
    agents: RoomAgentExecutionTruth[]
}

export interface RoomRunHistoryEntry {
    id: string
    ts: number
    jobId: string
    jobName: string | null
    status: string | null
    summary: string | null
    error: string | null
    sessionId: string | null
    sessionKey: string | null
    declaredAgentId: string | null
    effectiveAgentId: string | null
    resolvedSessionAgentId: string | null
    ownership: 'owned' | 'mismatch' | 'unknown'
    durationMs: number | null
    nextRunAtMs: number | null
    model: string | null
    provider: string | null
}

export interface RoomRunHistorySnapshot {
    roomId: string
    mismatchCount: number
    entries: RoomRunHistoryEntry[]
}
