import type {
    RoomCronJob,
    RoomExecutionSnapshot,
    RoomExecutionTruthSnapshot,
    RoomRunHistorySnapshot,
    RoomRuntimeOverview,
    RoomThreadAbortResult,
    RoomThreadCompactResult,
    RoomThreadForkResult,
    RoomThreadSendResult,
} from './execution-types'
import type { RoomExecutionAdapter } from './execution-adapter'

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
    RoomThreadCompactResult,
    RoomThreadForkResult,
    RoomThreadSendResult,
} from './execution-types'

const loadExecutionEngineModule = () =>
    import('./pi-execution-adapter') as Promise<RoomExecutionAdapter>

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
    awaitCompletion?: boolean
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

export async function compactRoomThread(input: {
    roomId: string
    sessionKey: string
    instructions?: string | null
}): Promise<RoomThreadCompactResult> {
    const module = await loadExecutionEngineModule()
    return module.compactRoomThread(input)
}

export async function forkRoomThread(input: {
    roomId: string
    sessionKey: string
    title?: string | null
    entryId?: string | null
}): Promise<RoomThreadForkResult> {
    const module = await loadExecutionEngineModule()
    return module.forkRoomThread(input)
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
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
    let closed = false

    return new ReadableStream<Uint8Array>({
        start(controller) {
            loadExecutionEngineModule()
                .then((module) => {
                    const stream = module.createRoomSessionEventStream(input)
                    reader = stream.getReader()

                    async function pump(): Promise<void> {
                        try {
                            while (!closed) {
                                const result = await reader!.read()
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
        cancel() {
            closed = true
            if (reader) {
                void reader.cancel()
                reader = null
            }
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

export async function updateRoomCronJob(input: {
    roomId: string
    jobId: string
    name: string
    message: string
    everyMinutes: number
}): Promise<RoomCronJob> {
    const module = await loadExecutionEngineModule()
    return module.updateRoomCronJob(input)
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

export async function runDueRoomCronJobs(
    input: {
        limit?: number
    } = {},
): Promise<Array<{ jobId: string; ran: boolean; reason: string | null }>> {
    const module = await import('./pi-execution-adapter')
    return module.runDueRoomCronJobs(input)
}
