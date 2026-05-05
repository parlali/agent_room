import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import type {
    RoomExecutionActivity,
    RoomExecutionAgent,
    RoomExecutionMessage,
    RoomExecutionThread,
} from '../rooms/execution-types'
import type { PiRuntimeSnapshotPayload } from './protocol'
import { selectSnapshotThreadKey } from './snapshot-selection'
import { subagentAgentId, type ThreadRecord } from './thread-records'

interface RuntimeSnapshotInput {
    config: PiRuntimeConfig
    records: ThreadRecord[]
    selectedThreadKey?: string | null
    messageLimit?: number
    findThread: (key: string) => ThreadRecord | null
    readThreadMessages: (record: ThreadRecord, limit: number) => RoomExecutionMessage[]
    compactionStats: (record: ThreadRecord) => RoomExecutionThread['compaction']
}

function mapThread(
    record: ThreadRecord,
    compactionStats: RuntimeSnapshotInput['compactionStats'],
): RoomExecutionThread {
    const agentId = record.kind === 'subagent' ? subagentAgentId(record) : 'main'
    return {
        key: record.key,
        sessionId: record.sessionId,
        agentId,
        kind: record.kind,
        parentThreadKey: record.parentThreadKey,
        title: record.title,
        lastMessagePreview: record.lastMessagePreview,
        status: record.status,
        updatedAt: record.updatedAt,
        runtimeMs: record.activeDurationMs > 0 ? record.activeDurationMs : null,
        model: record.model,
        modelProvider: record.modelProvider,
        totalTokens: null,
        estimatedCostUsd: null,
        compaction: compactionStats(record),
    }
}

function roomAgent(config: PiRuntimeConfig, threads: RoomExecutionThread[]): RoomExecutionAgent {
    return {
        id: 'main',
        name: config.runtime.displayName,
        workspace: config.paths.workspaceDir,
        modelPrimary: `${config.provider.piProvider}/${config.provider.piModel}`,
        modelFallbacks: config.provider.fallbackModels,
        identity: {
            name: config.runtime.displayName,
            theme: 'agent-room',
            emoji: null,
            avatarUrl: null,
        },
        threadCount: threads.length,
        activeThreadCount: threads.filter((thread) => thread.status === 'running').length,
        latestActivityAt: threads.reduce<number | null>((latest, thread) => {
            if (thread.updatedAt === null) {
                return latest
            }
            return latest === null || thread.updatedAt > latest ? thread.updatedAt : latest
        }, null),
    }
}

export function buildRuntimeSnapshot(input: RuntimeSnapshotInput): PiRuntimeSnapshotPayload {
    const limit =
        input.messageLimit && Number.isFinite(input.messageLimit)
            ? Math.max(1, Math.floor(input.messageLimit))
            : 200
    const orderedRecords = [...input.records].sort(
        (left, right) => right.updatedAt - left.updatedAt,
    )
    const threads = orderedRecords.map((record) => mapThread(record, input.compactionStats))
    const extraAgentIds = orderedRecords
        .filter((record) => record.kind === 'subagent')
        .map(subagentAgentId)
    const selectedThreadKey = selectSnapshotThreadKey({
        requestedThreadKey: input.selectedThreadKey,
        orderedThreadKeys: threads.map((thread) => thread.key),
    })
    const selectedRecord = selectedThreadKey ? input.findThread(selectedThreadKey) : null
    const selectedThreadMessages = selectedRecord
        ? input.readThreadMessages(selectedRecord, limit)
        : []

    return {
        roomAgent: roomAgent(input.config, threads),
        extraAgentIds,
        threads,
        selectedThreadKey,
        selectedThreadMessages,
        recentActivity: threads.slice(0, 30).map(
            (thread): RoomExecutionActivity => ({
                key: thread.key,
                agentId: thread.agentId,
                title: thread.title,
                status: thread.status,
                updatedAt: thread.updatedAt,
                runtimeMs: thread.runtimeMs,
                totalTokens: thread.totalTokens,
                estimatedCostUsd: thread.estimatedCostUsd,
            }),
        ),
    }
}
