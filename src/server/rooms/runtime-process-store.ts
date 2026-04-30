import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { WriteStream } from 'node:fs'

export interface RuntimeProcessEntry {
    child: ChildProcessWithoutNullStreams
    healthTimer: ReturnType<typeof setInterval>
    port: number
    logStream: WriteStream
}

interface RuntimeProcessStore {
    runtimeProcesses: Map<string, RuntimeProcessEntry>
    runtimeStarts: Map<string, Promise<void>>
    roomsStopping: Set<string>
}

const globalRuntimeProcessStore = globalThis as typeof globalThis & {
    __agentRoomRuntimeProcessStore?: RuntimeProcessStore
}

function normalizeRuntimeProcessStore(store: RuntimeProcessStore): RuntimeProcessStore {
    store.runtimeStarts ??= new Map<string, Promise<void>>()
    return store
}

const runtimeProcessStore = globalRuntimeProcessStore.__agentRoomRuntimeProcessStore
    ? normalizeRuntimeProcessStore(globalRuntimeProcessStore.__agentRoomRuntimeProcessStore)
    : (globalRuntimeProcessStore.__agentRoomRuntimeProcessStore = {
          runtimeProcesses: new Map<string, RuntimeProcessEntry>(),
          runtimeStarts: new Map<string, Promise<void>>(),
          roomsStopping: new Set<string>(),
      })

export function hasRuntimeProcess(roomId: string): boolean {
    return runtimeProcessStore.runtimeProcesses.has(roomId)
}

export function getRuntimeProcess(roomId: string): RuntimeProcessEntry | undefined {
    return runtimeProcessStore.runtimeProcesses.get(roomId)
}

export function setRuntimeProcess(roomId: string, entry: RuntimeProcessEntry) {
    runtimeProcessStore.runtimeProcesses.set(roomId, entry)
}

export function deleteRuntimeProcess(roomId: string) {
    runtimeProcessStore.runtimeProcesses.delete(roomId)
}

export function markRoomStopping(roomId: string) {
    runtimeProcessStore.roomsStopping.add(roomId)
}

export function consumeRoomStopping(roomId: string): boolean {
    const exists = runtimeProcessStore.roomsStopping.has(roomId)
    runtimeProcessStore.roomsStopping.delete(roomId)
    return exists
}

export async function withRuntimeStartLock(
    roomId: string,
    start: () => Promise<void>,
): Promise<void> {
    const existing = runtimeProcessStore.runtimeStarts.get(roomId)
    if (existing) {
        await existing
        return
    }

    const startPromise = start()
    runtimeProcessStore.runtimeStarts.set(roomId, startPromise)

    try {
        await startPromise
    } finally {
        if (runtimeProcessStore.runtimeStarts.get(roomId) === startPromise) {
            runtimeProcessStore.runtimeStarts.delete(roomId)
        }
    }
}
