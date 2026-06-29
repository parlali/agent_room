import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import type {
    RoomExecutionActivity,
    RoomExecutionAgent,
    RoomBrowserSessionSnapshot,
    RoomExecutionModelState,
    RoomExecutionMessage,
    RoomSessionArtifact,
    RoomExecutionThread,
} from '../rooms/execution-types'
import type { PiRuntimeSnapshotPayload } from './protocol'
import type { RoomViewThreadsReadModel } from '../rooms/room-view-readmodel-contract'
import { selectSnapshotThreadKey } from './snapshot-selection'
import { threadAgentId, type ThreadRecord } from './thread-records'

interface RuntimeSnapshotInput {
    config: PiRuntimeConfig
    records: ThreadRecord[]
    selectedThreadKey?: string | null
    messageLimit?: number
    findThread: (key: string) => ThreadRecord | null
    readThreadMessages: (record: ThreadRecord, limit: number) => RoomExecutionMessage[]
    readThreadArtifacts: (record: ThreadRecord) => RoomSessionArtifact[]
    compactionStats: (record: ThreadRecord) => RoomExecutionThread['compaction']
    selectedThreadModelState: (record: ThreadRecord) => RoomExecutionModelState | null
    browserSession: (sessionKey: string | null) => RoomBrowserSessionSnapshot | null
}

export function mapThread(
    record: ThreadRecord,
    compactionStats: RuntimeSnapshotInput['compactionStats'],
): RoomExecutionThread {
    const agentId = threadAgentId(record)
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
        runStartedAt: record.runStartedAt,
        runtimeMs: record.activeDurationMs > 0 ? record.activeDurationMs : null,
        model: record.model,
        modelProvider: record.modelProvider,
        totalTokens: null,
        estimatedCostUsd: null,
        badgeState: {
            completedClearedAt: null,
            completed: false,
        },
        compaction: compactionStats(record),
    }
}

function buildRoomAgent(config: PiRuntimeConfig, threads: RoomExecutionThread[]): RoomExecutionAgent {
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

export function buildThreadsView(
    config: PiRuntimeConfig,
    records: ThreadRecord[],
    compactionStats: RuntimeSnapshotInput['compactionStats'],
): RoomViewThreadsReadModel {
    const orderedRecords = [...records].sort((left, right) => right.updatedAt - left.updatedAt)
    const threads = orderedRecords.map((record) => mapThread(record, compactionStats))
    const extraAgentIds = orderedRecords
        .filter((record) => record.kind !== 'main')
        .map(threadAgentId)
    return {
        roomAgent: buildRoomAgent(config, threads),
        threads,
        extraAgentIds,
    }
}

export function buildRuntimeSnapshot(input: RuntimeSnapshotInput): PiRuntimeSnapshotPayload {
    const limit =
        typeof input.messageLimit === 'number' && Number.isFinite(input.messageLimit)
            ? Math.max(0, Math.floor(input.messageLimit))
            : 200
    const { roomAgent: agent, threads, extraAgentIds } = buildThreadsView(
        input.config,
        input.records,
        input.compactionStats,
    )
    const selectedThreadKey = selectSnapshotThreadKey({
        requestedThreadKey: input.selectedThreadKey,
        orderedThreadKeys: threads.map((thread) => thread.key),
    })
    const selectedRecord = selectedThreadKey ? input.findThread(selectedThreadKey) : null
    const selectedThreadMessages =
        selectedRecord && limit > 0 ? input.readThreadMessages(selectedRecord, limit) : []
    const selectedThreadModel = selectedRecord
        ? input.selectedThreadModelState(selectedRecord)
        : null
    const selectedThreadArtifacts =
        selectedRecord && limit > 0 ? input.readThreadArtifacts(selectedRecord) : []

    return {
        roomAgent: agent,
        extraAgentIds,
        threads,
        selectedThreadKey,
        selectedThreadModel,
        selectedThreadMessages,
        selectedThreadArtifacts,
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
        browserSession: input.browserSession(selectedThreadKey),
    }
}
