import { roomRepository, roomRuntimeMetadataRepository } from '../../db/repositories'
import type { RoomExecutionSnapshot, RoomRuntimeOverview } from '../execution-types'
import { requestPiRuntime } from '../pi-runtime-client'

import {
    emptySnapshot,
    buildRoomExecutionCapabilities,
    mapRuntimeOverview,
} from './runtime-overview'
import { snapshotSchema } from './runtime-schemas'
import { createRoomThread, sendRoomThreadMessage } from './thread-operations'
import { syncRuntimeUsageEvents } from './usage-sync'

export async function listRoomsWithRuntime(): Promise<RoomRuntimeOverview[]> {
    const rooms = await roomRepository.listRooms()
    const runtimeRows = await Promise.all(
        rooms.map((room) => roomRuntimeMetadataRepository.findByRoomId(room.id)),
    )

    return rooms.map((room, index) =>
        mapRuntimeOverview({
            roomId: room.id,
            displayName: room.displayName,
            slug: room.slug,
            status: room.status,
            desiredState: room.desiredState,
            runtimeMetadata: runtimeRows[index],
        }),
    )
}

export async function getRoomExecutionSnapshot(input: {
    roomId: string
    selectedThreadKey?: string | null
    messageLimit?: number
}): Promise<RoomExecutionSnapshot> {
    const room = await roomRepository.findRoomById(input.roomId)
    if (!room) {
        throw new Error(`Room ${input.roomId} does not exist`)
    }

    const runtimeMetadata = await roomRuntimeMetadataRepository.findByRoomId(input.roomId)
    const roomOverview = mapRuntimeOverview({
        roomId: room.id,
        displayName: room.displayName,
        slug: room.slug,
        status: room.status,
        desiredState: room.desiredState,
        runtimeMetadata,
    })

    if (!runtimeMetadata || runtimeMetadata.port === null) {
        return emptySnapshot({
            room: roomOverview,
            state: 'unavailable',
            message: 'Room runtime has no allocated Pi endpoint',
        })
    }

    if (room.status !== 'running' && room.status !== 'degraded') {
        return emptySnapshot({
            room: roomOverview,
            state: 'unavailable',
            message: `Room is ${room.status}. Start the runtime to load threads and chat`,
        })
    }

    try {
        const query = new URLSearchParams()
        if (input.selectedThreadKey) {
            query.set('selectedThreadKey', input.selectedThreadKey)
        }
        query.set(
            'messageLimit',
            String(
                input.messageLimit && Number.isFinite(input.messageLimit)
                    ? Math.max(1, Math.floor(input.messageLimit))
                    : 200,
            ),
        )
        const payload = await requestPiRuntime(
            input.roomId,
            `/snapshot?${query.toString()}`,
            snapshotSchema,
        )
        await syncRuntimeUsageEvents(input.roomId)

        return {
            room: roomOverview,
            executionState: 'connected',
            executionMessage: null,
            capabilities: buildRoomExecutionCapabilities(true),
            ...payload,
        }
    } catch (error) {
        return emptySnapshot({
            room: roomOverview,
            state: 'error',
            message: error instanceof Error ? error.message : 'Unknown Pi adapter error',
        })
    }
}

export async function wakeRoomRuntime(input: {
    roomId: string
    text: string
    mode: 'now' | 'next-heartbeat'
}): Promise<void> {
    if (input.mode !== 'now') {
        throw new Error('Deferred heartbeat wake is not implemented for the Pi runtime')
    }

    const text = input.text.trim()
    if (!text) {
        throw new Error('Wake trigger text cannot be empty')
    }

    const snapshot = await requestPiRuntime(input.roomId, '/snapshot', snapshotSchema)
    const selectedThreadKey = snapshot.selectedThreadKey ?? snapshot.threads[0]?.key ?? null
    if (!selectedThreadKey) {
        await createRoomThread({
            roomId: input.roomId,
            firstMessage: text,
        })
        return
    }

    await sendRoomThreadMessage({
        roomId: input.roomId,
        sessionKey: selectedThreadKey,
        message: text,
    })
}
