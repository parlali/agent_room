import type { RunKind } from './run-budget'

export type ThreadKind = 'main' | 'subagent' | 'deep_work'
export type ThreadTitleSource = 'initial' | 'generated' | 'manual'
export type ThreadRunKind = RunKind

export interface ThreadRecord {
    key: string
    sessionFile: string
    sessionId: string
    title: string
    titleSource: ThreadTitleSource
    status: string
    createdAt: number
    updatedAt: number
    lastMessagePreview: string | null
    modelProvider: string | null
    model: string | null
    thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | null
    activeRunId: string | null
    activeRunKind: ThreadRunKind | null
    heartbeatAt: number | null
    runStartedAt: number | null
    runBudgetExpiresAt: number | null
    idleTimeoutExpiresAt: number | null
    activeDurationMs: number
    idleDurationMs: number
    lastError: string | null
    kind: ThreadKind
    parentThreadKey: string | null
    parentRunId: string | null
    subagentRunId: string | null
    subagentName: string | null
    subagentTask: string | null
    deepWorkRunId: string | null
    deepWorkObjective: string | null
    completedAt: number | null
}

export interface ThreadIndexFile {
    version: 1
    threads: ThreadRecord[]
}

export function normalizeThreadRecord(
    record: Partial<ThreadRecord> & {
        key: string
        sessionFile: string
        sessionId: string
        title: string
        status: string
        createdAt: number
        updatedAt: number
        titleSource?: ThreadTitleSource
        lastMessagePreview?: string | null
        modelProvider?: string | null
        model?: string | null
        thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | null
        activeRunId?: string | null
        activeRunKind?: ThreadRunKind | null
        heartbeatAt?: number | null
        runStartedAt?: number | null
        runBudgetExpiresAt?: number | null
        idleTimeoutExpiresAt?: number | null
        activeDurationMs?: number
        idleDurationMs?: number
        lastError?: string | null
    },
): ThreadRecord {
    return {
        key: record.key,
        sessionFile: record.sessionFile,
        sessionId: record.sessionId,
        title: record.title,
        titleSource:
            record.titleSource === 'generated' || record.titleSource === 'manual'
                ? record.titleSource
                : 'initial',
        status: record.status,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        lastMessagePreview: record.lastMessagePreview ?? null,
        modelProvider: record.modelProvider ?? null,
        model: record.model ?? null,
        thinkingLevel: record.thinkingLevel ?? null,
        activeRunId: record.activeRunId ?? null,
        activeRunKind: record.activeRunKind ?? null,
        heartbeatAt: record.heartbeatAt ?? null,
        runStartedAt: record.runStartedAt ?? null,
        runBudgetExpiresAt: record.runBudgetExpiresAt ?? null,
        idleTimeoutExpiresAt: record.idleTimeoutExpiresAt ?? null,
        activeDurationMs:
            typeof record.activeDurationMs === 'number' && Number.isFinite(record.activeDurationMs)
                ? record.activeDurationMs
                : 0,
        idleDurationMs:
            typeof record.idleDurationMs === 'number' && Number.isFinite(record.idleDurationMs)
                ? record.idleDurationMs
                : 0,
        lastError: record.lastError ?? null,
        kind: record.kind === 'subagent' || record.kind === 'deep_work' ? record.kind : 'main',
        parentThreadKey: record.parentThreadKey ?? null,
        parentRunId: record.parentRunId ?? null,
        subagentRunId: record.subagentRunId ?? null,
        subagentName: record.subagentName ?? null,
        subagentTask: record.subagentTask ?? null,
        deepWorkRunId: record.deepWorkRunId ?? null,
        deepWorkObjective: record.deepWorkObjective ?? null,
        completedAt: record.completedAt ?? null,
    }
}

export function normalizeThreadIndexFile(file: ThreadIndexFile): ThreadIndexFile {
    return {
        version: 1,
        threads: file.threads.map((thread) => normalizeThreadRecord(thread)),
    }
}

export function subagentAgentId(record: ThreadRecord): string {
    return record.subagentRunId ? `subagent:${record.subagentRunId}` : `subagent:${record.key}`
}

export function deepWorkAgentId(record: ThreadRecord): string {
    return record.deepWorkRunId ? `deep_work:${record.deepWorkRunId}` : `deep_work:${record.key}`
}

export function threadAgentId(record: ThreadRecord): string {
    if (record.kind === 'subagent') {
        return subagentAgentId(record)
    }
    if (record.kind === 'deep_work') {
        return deepWorkAgentId(record)
    }
    return 'main'
}
