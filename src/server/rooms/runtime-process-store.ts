import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { WriteStream } from 'node:fs'

export interface RuntimeProcessEntry {
    child: ChildProcessWithoutNullStreams
    healthTimer: ReturnType<typeof setInterval>
    port: number
    logStream: WriteStream
}

const runtimeProcesses = new Map<string, RuntimeProcessEntry>()
const roomsStopping = new Set<string>()

export function hasRuntimeProcess(roomId: string): boolean {
    return runtimeProcesses.has(roomId)
}

export function getRuntimeProcess(roomId: string): RuntimeProcessEntry | undefined {
    return runtimeProcesses.get(roomId)
}

export function setRuntimeProcess(roomId: string, entry: RuntimeProcessEntry) {
    runtimeProcesses.set(roomId, entry)
}

export function deleteRuntimeProcess(roomId: string) {
    runtimeProcesses.delete(roomId)
}

export function markRoomStopping(roomId: string) {
    roomsStopping.add(roomId)
}

export function consumeRoomStopping(roomId: string): boolean {
    const exists = roomsStopping.has(roomId)
    roomsStopping.delete(roomId)
    return exists
}
