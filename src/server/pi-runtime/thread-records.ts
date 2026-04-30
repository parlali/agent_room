export type ThreadKind = 'main' | 'subagent'

export interface ThreadRecord {
    key: string
    sessionFile: string
    sessionId: string
    title: string
    status: string
    createdAt: number
    updatedAt: number
    lastMessagePreview: string | null
    modelProvider: string | null
    model: string | null
    activeRunId: string | null
    lastError: string | null
    kind: ThreadKind
    parentThreadKey: string | null
    parentRunId: string | null
    subagentRunId: string | null
    subagentName: string | null
    subagentTask: string | null
    completedAt: number | null
}

export interface ThreadIndexFile {
    version: 1
    threads: ThreadRecord[]
}

export function normalizeThreadRecord(record: Partial<ThreadRecord> & {
    key: string
    sessionFile: string
    sessionId: string
    title: string
    status: string
    createdAt: number
    updatedAt: number
    lastMessagePreview?: string | null
    modelProvider?: string | null
    model?: string | null
    activeRunId?: string | null
    lastError?: string | null
}): ThreadRecord {
    return {
        key: record.key,
        sessionFile: record.sessionFile,
        sessionId: record.sessionId,
        title: record.title,
        status: record.status,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        lastMessagePreview: record.lastMessagePreview ?? null,
        modelProvider: record.modelProvider ?? null,
        model: record.model ?? null,
        activeRunId: record.activeRunId ?? null,
        lastError: record.lastError ?? null,
        kind: record.kind === 'subagent' ? 'subagent' : 'main',
        parentThreadKey: record.parentThreadKey ?? null,
        parentRunId: record.parentRunId ?? null,
        subagentRunId: record.subagentRunId ?? null,
        subagentName: record.subagentName ?? null,
        subagentTask: record.subagentTask ?? null,
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
