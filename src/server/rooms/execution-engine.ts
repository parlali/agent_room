import type {
    RoomCronJob,
    RoomExecutionSnapshot,
    RoomExecutionTruthSnapshot,
    RoomRunHistorySnapshot,
    RoomRuntimeOverview,
    RoomThreadAbortResult,
    RoomThreadSendResult,
} from './execution-types'

export type {
    RoomAgentExecutionTruth,
    RoomCronJob,
    RoomExecutionActivity,
    RoomExecutionAgent,
    RoomExecutionCapabilities,
    RoomExecutionMessage,
    RoomExecutionMessagePart,
    RoomExecutionSnapshot,
    RoomExecutionThread,
    RoomExecutionTruthSnapshot,
    RoomRealtimeEvent,
    RoomRunHistoryEntry,
    RoomRunHistorySnapshot,
    RoomRuntimeOverview,
    RoomThreadAbortResult,
    RoomThreadSendResult,
} from './execution-types'

interface RoomExecutionAdapter {
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

const loadExecutionEngineModule = () =>
    import('./openclaw-execution-adapter') as Promise<RoomExecutionAdapter>

export async function listRoomsWithRuntime(): Promise<RoomRuntimeOverview[]> {
    const module = await loadExecutionEngineModule()
    return module.listRoomsWithRuntime()
}

export async function getRoomExecutionSnapshot(input: {
    roomId: string
    selectedThreadKey?: string | null
    messageLimit?: number
}): Promise<RoomExecutionSnapshot> {
    const module = await loadExecutionEngineModule()
    return module.getRoomExecutionSnapshot(input)
}

export async function sendRoomThreadMessage(input: {
    roomId: string
    sessionKey: string
    message: string
}): Promise<RoomThreadSendResult> {
    const module = await loadExecutionEngineModule()
    return module.sendRoomThreadMessage(input)
}

export async function abortRoomThreadMessage(input: {
    roomId: string
    sessionKey: string
    runId?: string | null
}): Promise<RoomThreadAbortResult> {
    const module = await loadExecutionEngineModule()
    return module.abortRoomThreadMessage(input)
}

export async function editRoomThreadMessage(input: {
    roomId: string
    sessionKey: string
    messageId: string
    message: string
}): Promise<never> {
    const module = await loadExecutionEngineModule()
    return module.editRoomThreadMessage(input)
}

export function createRoomSessionEventStream(input: {
    roomId: string
    sessionKey: string
    abortSignal?: AbortSignal
}): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
        start(controller) {
            loadExecutionEngineModule()
                .then((module) => {
                    const stream = module.createRoomSessionEventStream(input)
                    const reader = stream.getReader()

                    async function pump(): Promise<void> {
                        try {
                            while (true) {
                                const result = await reader.read()
                                if (result.done) {
                                    controller.close()
                                    return
                                }
                                controller.enqueue(result.value)
                            }
                        } catch (error) {
                            controller.error(error)
                        }
                    }

                    void pump()
                })
                .catch((error) => controller.error(error))
        },
    })
}

export async function createRoomThread(input: {
    roomId: string
    firstMessage?: string | null
}): Promise<{ key: string }> {
    const module = await loadExecutionEngineModule()
    return module.createRoomThread(input)
}

export async function listRoomCronJobs(input: {
    roomId: string
    limit?: number
}): Promise<RoomCronJob[]> {
    const module = await loadExecutionEngineModule()
    return module.listRoomCronJobs(input)
}

export async function createRoomCronJob(input: {
    roomId: string
    name: string
    message: string
    everyMinutes: number
}): Promise<RoomCronJob> {
    const module = await loadExecutionEngineModule()
    return module.createRoomCronJob(input)
}

export async function updateRoomCronJobEnabled(input: {
    roomId: string
    jobId: string
    enabled: boolean
}): Promise<RoomCronJob> {
    const module = await loadExecutionEngineModule()
    return module.updateRoomCronJobEnabled(input)
}

export async function runRoomCronJobNow(input: {
    roomId: string
    jobId: string
}): Promise<{ ran: boolean; reason: string | null }> {
    const module = await loadExecutionEngineModule()
    return module.runRoomCronJobNow(input)
}

export async function removeRoomCronJob(input: { roomId: string; jobId: string }): Promise<void> {
    const module = await loadExecutionEngineModule()
    return module.removeRoomCronJob(input)
}

export async function wakeRoomRuntime(input: {
    roomId: string
    text: string
    mode: 'now' | 'next-heartbeat'
}): Promise<void> {
    const module = await loadExecutionEngineModule()
    return module.wakeRoomRuntime(input)
}

export async function getRoomExecutionTruthSnapshot(input: {
    roomId: string
}): Promise<RoomExecutionTruthSnapshot> {
    const module = await loadExecutionEngineModule()
    return module.getRoomExecutionTruthSnapshot(input)
}

export async function listRoomRunHistory(input: {
    roomId: string
    limit?: number
}): Promise<RoomRunHistorySnapshot> {
    const module = await loadExecutionEngineModule()
    return module.listRoomRunHistory(input)
}
