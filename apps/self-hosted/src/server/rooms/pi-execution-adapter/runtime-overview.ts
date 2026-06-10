import type { RoomMode, RoomRuntimeMetadataRecord, RoomStatus } from '#/domain/domain-types'
import type {
    RoomExecutionSnapshot,
    RoomRuntimeOverview,
    RoomSetupSnapshot,
} from '../execution-types'

export function mapRuntimeOverview(input: {
    roomId: string
    displayName: string
    slug: string
    status: RoomStatus
    desiredState: 'running' | 'stopped'
    roomMode: RoomMode
    runtimeMetadata: RoomRuntimeMetadataRecord | null
}): RoomRuntimeOverview {
    return {
        roomId: input.roomId,
        displayName: input.displayName,
        slug: input.slug,
        status: input.status,
        desiredState: input.desiredState,
        roomMode: input.roomMode,
        healthStatus: input.runtimeMetadata?.healthStatus ?? null,
        port: input.runtimeMetadata?.port ?? null,
        pid: input.runtimeMetadata?.pid ?? null,
        lastError: input.runtimeMetadata?.lastError ?? null,
        lastHealthAt: input.runtimeMetadata?.lastHealthAt
            ? input.runtimeMetadata.lastHealthAt.toISOString()
            : null,
    }
}

export function buildRoomExecutionCapabilities(connected: boolean) {
    return {
        canStreamTokens: connected,
        canStreamToolEvents: connected,
        canAbortGeneration: connected,
        canEditMessages: connected,
        editMessageUnsupportedReason: null,
    }
}

export function emptySnapshot(input: {
    room: RoomRuntimeOverview
    setup: RoomSetupSnapshot
    state: RoomExecutionSnapshot['executionState']
    message: string
}): RoomExecutionSnapshot {
    return {
        room: input.room,
        setup: input.setup,
        executionState: input.state,
        executionMessage: input.message,
        capabilities: buildRoomExecutionCapabilities(input.state === 'connected'),
        roomAgent: null,
        extraAgentIds: [],
        threads: [],
        selectedThreadKey: null,
        selectedThreadModel: null,
        selectedThreadMessages: [],
        selectedThreadArtifacts: [],
        recentActivity: [],
        browserSession: null,
    }
}
