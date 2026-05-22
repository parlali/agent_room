import { roomRuntimeMetadataRepository } from '../db/repositories'
import type { HealthStatus, RoomRecord, RoomRuntimeMetadataRecord } from '#/domain/domain-types'
import { loopbackPortAllocator } from './port-allocator'
import { materializeRuntime } from './runtime-materializer'

export async function getRuntimeMetadataOrCreate(
    roomId: string,
): Promise<RoomRuntimeMetadataRecord> {
    const existing = await roomRuntimeMetadataRepository.findByRoomId(roomId)
    if (existing) {
        return existing
    }
    return roomRuntimeMetadataRepository.upsert({
        roomId,
        port: null,
        pid: null,
        sandboxUid: null,
        sandboxGid: null,
        sandboxUserName: null,
        sandboxGroupName: null,
        configVersion: 1,
        tokenVersion: 1,
        healthStatus: 'unknown',
        startedAt: null,
        lastHealthAt: null,
        lastError: null,
    })
}

export async function persistRuntimeMetadata(input: {
    roomId: string
    port: number | null
    pid: number | null
    sandboxUid?: number | null
    sandboxGid?: number | null
    sandboxUserName?: string | null
    sandboxGroupName?: string | null
    configVersion: number
    tokenVersion: number
    healthStatus: HealthStatus
    startedAt: Date | null
    lastError: string | null
}) {
    return roomRuntimeMetadataRepository.upsert({
        roomId: input.roomId,
        port: input.port,
        pid: input.pid,
        sandboxUid: input.sandboxUid,
        sandboxGid: input.sandboxGid,
        sandboxUserName: input.sandboxUserName,
        sandboxGroupName: input.sandboxGroupName,
        configVersion: input.configVersion,
        tokenVersion: input.tokenVersion,
        healthStatus: input.healthStatus,
        startedAt: input.startedAt,
        lastHealthAt: new Date(),
        lastError: input.lastError,
    })
}

export async function materializeRoomRuntime(
    room: RoomRecord,
    runtimeMetadata: RoomRuntimeMetadataRecord,
) {
    return materializeRuntime({
        room,
        runtimeMetadata,
    })
}

export async function allocateRoomPort(roomId: string): Promise<number> {
    const runtimeMetadata = await getRuntimeMetadataOrCreate(roomId)
    if (runtimeMetadata.port !== null) {
        loopbackPortAllocator.reserve(runtimeMetadata.port)
        return runtimeMetadata.port
    }
    const port = await loopbackPortAllocator.allocate()
    await roomRuntimeMetadataRepository.upsert({
        roomId,
        port,
        pid: runtimeMetadata.pid,
        configVersion: runtimeMetadata.configVersion,
        tokenVersion: runtimeMetadata.tokenVersion,
        healthStatus: runtimeMetadata.healthStatus,
        startedAt: runtimeMetadata.startedAt,
        lastHealthAt: runtimeMetadata.lastHealthAt,
        lastError: runtimeMetadata.lastError,
    })
    return port
}
