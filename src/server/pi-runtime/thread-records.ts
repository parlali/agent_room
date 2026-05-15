import type { RunKind } from './run-budget'

export type ThreadKind = 'main' | 'subagent' | 'deep_work'
export type ThreadTitleSource = 'initial' | 'generated' | 'manual'
export type ThreadRunKind = RunKind

export interface PendingUserMessageRecord {
    id: string
    runId: string
    runKind: ThreadRunKind
    text: string
    queuedAt: number
}

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
    pendingUserMessages?: PendingUserMessageRecord[]
}

export interface ThreadIndexFile {
    version: 1
    threads: ThreadRecord[]
}

/**
 * Normalize a partial thread record into a complete ThreadRecord with defaults and validated fields.
 *
 * @param record - Partial thread record containing required identity, title, status, and timestamps; optional fields will be coerced or validated.
 * @returns A normalized ThreadRecord where optional fields are set to sensible defaults (null, 0, or normalized enums), `titleSource` is restricted to `'generated' | 'manual' | 'initial'`, durations are finite numbers, `kind` is normalized to `'main' | 'subagent' | 'deep_work'`, and `pendingUserMessages` is validated and normalized.
 */
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
        pendingUserMessages: normalizePendingUserMessages(record.pendingUserMessages),
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

/**
 * Selects the agent identifier corresponding to a thread's role.
 *
 * @param record - The thread record whose `kind` and identifiers determine the agent id
 * @returns The agent identifier: `main` for main threads, `subagent:{id}` for subagent threads, or `deep_work:{id}` for deep work threads
 */
export function threadAgentId(record: ThreadRecord): string {
    if (record.kind === 'subagent') {
        return subagentAgentId(record)
    }
    if (record.kind === 'deep_work') {
        return deepWorkAgentId(record)
    }
    return 'main'
}

/**
 * Validate and normalize an unknown input into a list of pending user message records.
 *
 * @param value - The input to validate, expected to be an array of objects representing pending user messages.
 * @returns An array of `PendingUserMessageRecord` entries constructed from valid items in `value`; invalid or malformed items are omitted. The `runKind` field is normalized to one of `scheduled`, `subagent`, `deep_work`, or `maintenance`, defaulting to `manual` when missing or unrecognized.
 */
function normalizePendingUserMessages(value: unknown): PendingUserMessageRecord[] {
    if (!Array.isArray(value)) return []
    return value.flatMap((item): PendingUserMessageRecord[] => {
        if (!item || typeof item !== 'object') return []
        const record = item as Partial<PendingUserMessageRecord>
        if (
            typeof record.id !== 'string' ||
            typeof record.runId !== 'string' ||
            typeof record.text !== 'string' ||
            typeof record.queuedAt !== 'number' ||
            !Number.isFinite(record.queuedAt)
        ) {
            return []
        }
        return [
            {
                id: record.id,
                runId: record.runId,
                runKind:
                    record.runKind === 'scheduled' ||
                    record.runKind === 'subagent' ||
                    record.runKind === 'deep_work' ||
                    record.runKind === 'maintenance'
                        ? record.runKind
                        : 'manual',
                text: record.text,
                queuedAt: record.queuedAt,
            },
        ]
    })
}
