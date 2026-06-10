import type {
    RoomExecutionActivity,
    RoomExecutionAgent,
    RoomExecutionModelState,
    RoomExecutionMessage,
    RoomBrowserSessionSnapshot,
    RoomSessionWindow,
    RoomSessionArtifact,
    RoomExecutionThread,
} from '../rooms/execution-types'

export interface PiRuntimeSnapshotPayload {
    roomAgent: RoomExecutionAgent
    extraAgentIds: string[]
    threads: RoomExecutionThread[]
    selectedThreadKey: string | null
    selectedThreadModel: RoomExecutionModelState | null
    selectedThreadMessages: RoomExecutionMessage[]
    selectedThreadArtifacts: RoomSessionArtifact[]
    recentActivity: RoomExecutionActivity[]
    browserSession: RoomBrowserSessionSnapshot | null
}

export type PiRuntimeSessionWindowPayload = RoomSessionWindow

export interface PiRuntimeThreadCreatePayload {
    key: string
}

export interface PiRuntimeSendPayload {
    runId: string | null
    status: string
    messageSeq: number | null
    interruptedActiveRun: boolean
    error: string | null
}

export interface PiRuntimeAbortPayload {
    abortedRunId: string | null
    status: string
}

export interface PiRuntimeCompactPayload {
    status: string
    error: string | null
    compactionCount: number
}

export interface PiRuntimeForkPayload {
    key: string
    parentThreadKey: string
    parentSessionFile: string
}

export type PiRuntimeThreadModelPayload = RoomExecutionModelState

export interface PiRuntimeErrorPayload {
    message: string
}
