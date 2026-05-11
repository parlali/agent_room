import {
    roomConfigRepository,
    roomRepository,
    roomRuntimeMetadataRepository,
    roomThreadReadRepository,
} from '../../db/repositories'
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
    const [runtimeRows, configs] = await Promise.all([
        Promise.all(rooms.map((room) => roomRuntimeMetadataRepository.findByRoomId(room.id))),
        Promise.all(rooms.map((room) => roomConfigRepository.getOrCreate(room.id))),
    ])

    return rooms.map((room, index) =>
        mapRuntimeOverview({
            roomId: room.id,
            displayName: room.displayName,
            slug: room.slug,
            status: room.status,
            desiredState: room.desiredState,
            roomMode: configs[index]?.roomMode ?? 'coworker',
            runtimeMetadata: runtimeRows[index],
        }),
    )
}

export async function getRoomExecutionSnapshot(input: {
    roomId: string
    selectedThreadKey?: string | null
    messageLimit?: number
    actorUserId?: string | null
}): Promise<RoomExecutionSnapshot> {
    const room = await roomRepository.findRoomById(input.roomId)
    if (!room) {
        throw new Error(`Room ${input.roomId} does not exist`)
    }

    const runtimeMetadata = await roomRuntimeMetadataRepository.findByRoomId(input.roomId)
    const config = await roomConfigRepository.getOrCreate(input.roomId)
    const roomOverview = mapRuntimeOverview({
        roomId: room.id,
        displayName: room.displayName,
        slug: room.slug,
        status: room.status,
        desiredState: room.desiredState,
        roomMode: config.roomMode,
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
        const snapshot = await applyThreadReadState({
            roomId: input.roomId,
            actorUserId: input.actorUserId ?? null,
            markReadSessionKey: input.selectedThreadKey ? payload.selectedThreadKey : null,
            snapshot: {
                room: roomOverview,
                executionState: 'connected',
                executionMessage: null,
                capabilities: buildRoomExecutionCapabilities(true),
                ...payload,
                selectedThreadArtifacts: payload.selectedThreadArtifacts ?? [],
            },
        })

        return snapshot
    } catch (error) {
        return emptySnapshot({
            room: roomOverview,
            state: 'error',
            message: error instanceof Error ? error.message : 'Unknown Pi adapter error',
        })
    }
}

async function applyThreadReadState(input: {
    roomId: string
    actorUserId: string | null
    markReadSessionKey: string | null
    snapshot: RoomExecutionSnapshot
}): Promise<RoomExecutionSnapshot> {
    if (!input.actorUserId) return input.snapshot

    const readAt = new Date()
    const readRecords = await roomThreadReadRepository.listForRoom({
        userId: input.actorUserId,
        roomId: input.roomId,
    })
    const readBySession = new Map(
        readRecords.map((record) => [record.sessionKey, record.readAt.getTime()]),
    )

    if (input.markReadSessionKey) {
        await roomThreadReadRepository.markRead({
            userId: input.actorUserId,
            roomId: input.roomId,
            sessionKey: input.markReadSessionKey,
            readAt,
        })
        readBySession.set(input.markReadSessionKey, readAt.getTime())
    }

    return {
        ...input.snapshot,
        threads: input.snapshot.threads.map((thread) => {
            const readAtMs = readBySession.get(thread.key) ?? null
            const unread =
                thread.status !== 'running' &&
                thread.status !== 'compacting' &&
                hasUnreadActivity({
                    threadUpdatedAt: thread.updatedAt,
                    readAt: readAtMs,
                    hasPreview: Boolean(thread.lastMessagePreview?.trim()),
                })
            return {
                ...thread,
                readState: {
                    readAt: readAtMs,
                    unread,
                },
            }
        }),
    }
}

function hasUnreadActivity(input: {
    threadUpdatedAt: number | null
    readAt: number | null
    hasPreview: boolean
}): boolean {
    if (!input.threadUpdatedAt || !input.hasPreview) return false
    if (!input.readAt) return true
    return input.threadUpdatedAt > input.readAt + 1000
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
