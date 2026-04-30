import type {
    RoomExecutionActivity,
    RoomExecutionAgent,
    RoomExecutionMessage,
    RoomExecutionThread,
} from '../rooms/execution-types'

export interface PiRuntimeSnapshotPayload {
    roomAgent: RoomExecutionAgent
    extraAgentIds: string[]
    threads: RoomExecutionThread[]
    selectedThreadKey: string | null
    selectedThreadMessages: RoomExecutionMessage[]
    recentActivity: RoomExecutionActivity[]
}

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

export interface PiRuntimeErrorPayload {
    message: string
}
