import type {
    RoomCronJob,
    RoomExecutionSnapshot,
    RoomExecutionTruthSnapshot,
    RoomRealtimeEvent,
    RoomRunHistorySnapshot,
    RoomRuntimeOverview,
    RoomThreadAbortResult,
    RoomThreadSendResult,
} from './execution-types'

export interface RoomExecutionAdapter {
    listRoomsWithRuntime: () => Promise<RoomRuntimeOverview[]>
    getRoomExecutionSnapshot: (input: {
        roomId: string
        selectedThreadKey?: string | null
        messageLimit?: number
    }) => Promise<RoomExecutionSnapshot>
    sendRoomThreadMessage: (input: {
        roomId: string
        sessionKey: string
        message: string
        awaitCompletion?: boolean
    }) => Promise<RoomThreadSendResult>
    abortRoomThreadMessage: (input: {
        roomId: string
        sessionKey: string
        runId?: string | null
    }) => Promise<RoomThreadAbortResult>
    editRoomThreadMessage: (input: {
        roomId: string
        sessionKey: string
        messageId: string
        message: string
    }) => Promise<never>
    createRoomSessionEventStream: (input: {
        roomId: string
        sessionKey: string
        abortSignal?: AbortSignal
    }) => ReadableStream<Uint8Array>
    createRoomThread: (input: {
        roomId: string
        firstMessage?: string | null
    }) => Promise<{ key: string }>
    listRoomCronJobs: (input: { roomId: string; limit?: number }) => Promise<RoomCronJob[]>
    createRoomCronJob: (input: {
        roomId: string
        name: string
        message: string
        everyMinutes: number
    }) => Promise<RoomCronJob>
    updateRoomCronJob: (input: {
        roomId: string
        jobId: string
        name: string
        message: string
        everyMinutes: number
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
