import type {
    RoomCronJob,
    RoomExecutionModelState,
    RoomExecutionSnapshot,
    RoomExecutionThinkingLevel,
    RoomExecutionTruthSnapshot,
    RoomFileChangedPayload,
    RoomRealtimeEvent,
    RoomRunHistorySnapshot,
    RoomRuntimeOverview,
    RoomSessionWindow,
    RoomThreadAbortResult,
    RoomThreadCompactResult,
    RoomThreadForkResult,
    RoomThreadSendResult,
} from './execution-types'
import type { JobSchedule } from '#/lib/job-schedule'

export interface RoomExecutionAdapter {
    listRoomsWithRuntime: () => Promise<RoomRuntimeOverview[]>
    getRoomExecutionSnapshot: (input: {
        roomId: string
        selectedThreadKey?: string | null
        messageLimit?: number
        actorUserId?: string | null
    }) => Promise<RoomExecutionSnapshot>
    getRoomSessionWindow: (input: {
        roomId: string
        sessionKey: string
        before?: string | null
        after?: string | null
        limitRows?: number
    }) => Promise<RoomSessionWindow>
    sendRoomThreadMessage: (input: {
        roomId: string
        sessionKey: string
        message: string
        awaitCompletion?: boolean
    }) => Promise<RoomThreadSendResult>
    updateRoomThreadModel: (input: {
        roomId: string
        sessionKey: string
        provider: string
        model: string
        thinkingLevel?: RoomExecutionThinkingLevel | null
    }) => Promise<RoomExecutionModelState>
    abortRoomThreadMessage: (input: {
        roomId: string
        sessionKey: string
        runId?: string | null
    }) => Promise<RoomThreadAbortResult>
    compactRoomThread: (input: {
        roomId: string
        sessionKey: string
        instructions?: string | null
    }) => Promise<RoomThreadCompactResult>
    forkRoomThread: (input: {
        roomId: string
        sessionKey: string
        title?: string | null
        entryId?: string | null
    }) => Promise<RoomThreadForkResult>
    editRoomThreadMessage: (input: {
        roomId: string
        sessionKey: string
        messageId: string
        message: string
    }) => Promise<RoomThreadSendResult>
    createRoomSessionEventStream: (input: {
        roomId: string
        sessionKey: string
        abortSignal?: AbortSignal
    }) => ReadableStream<Uint8Array>
    createRoomEventStream: (input: {
        roomId: string
        abortSignal?: AbortSignal
    }) => ReadableStream<Uint8Array>
    publishRoomFileChanged: (input: RoomFileChangedPayload) => Promise<void>
    createRoomThread: (input: {
        roomId: string
        firstMessage?: string | null
    }) => Promise<{ key: string }>
    listRoomCronJobs: (input: { roomId: string; limit?: number }) => Promise<RoomCronJob[]>
    createRoomCronJob: (input: {
        roomId: string
        name: string
        message: string
        schedule: JobSchedule
    }) => Promise<RoomCronJob>
    updateRoomCronJob: (input: {
        roomId: string
        jobId: string
        name: string
        message: string
        schedule: JobSchedule
    }) => Promise<RoomCronJob>
    updateRoomCronJobEnabled: (input: {
        roomId: string
        jobId: string
        enabled: boolean
    }) => Promise<RoomCronJob>
    runRoomCronJobNow: (input: {
        roomId: string
        jobId: string
    }) => Promise<{ ran: boolean; reason: string | null }>
    removeRoomCronJob: (input: { roomId: string; jobId: string }) => Promise<void>
    wakeRoomRuntime: (input: {
        roomId: string
        text: string
        mode: 'now' | 'next-heartbeat'
    }) => Promise<void>
    getRoomExecutionTruthSnapshot: (input: {
        roomId: string
    }) => Promise<RoomExecutionTruthSnapshot>
    listRoomRunHistory: (input: {
        roomId: string
        limit?: number
    }) => Promise<RoomRunHistorySnapshot>
    deleteRoomSession: (input: { roomId: string; sessionKey: string }) => Promise<void>
    renameRoomSession: (input: {
        roomId: string
        sessionKey: string
        title: string
    }) => Promise<void>
}

export function encodeRoomSseEvent(event: string, data: unknown): Uint8Array {
    return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

export function toRoomRealtimeEvent(input: {
    event: string
    payload: unknown
    seq?: number | null
    stateVersion?: unknown
}): RoomRealtimeEvent {
    return {
        event: input.event,
        payload: input.payload,
        seq: typeof input.seq === 'number' ? input.seq : null,
        stateVersion: input.stateVersion ?? null,
        receivedAt: Date.now(),
    }
}
