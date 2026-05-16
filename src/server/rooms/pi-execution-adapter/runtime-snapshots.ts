import {
    roomConfigRepository,
    roomRepository,
    roomRuntimeMetadataRepository,
    roomThreadReadRepository,
} from '../../db/repositories'
import type { RoomExecutionSnapshot, RoomRuntimeOverview } from '../execution-types'
import type { RoomSessionWindow } from '#/lib/room-execution-types'
import { requestPiRuntime } from '../pi-runtime-client'

import {
    emptySnapshot,
    buildRoomExecutionCapabilities,
    mapRuntimeOverview,
} from './runtime-overview'
import { sessionWindowSchema, snapshotSchema } from './runtime-schemas'
import { createRoomThread, sendRoomThreadMessage } from './thread-operations'
import {
    elapsedPerformanceMs,
    jsonPayloadByteLength,
    logPerformanceEvent,
    performanceNow,
} from '../../telemetry/performance'

export async function getRoomSessionWindow(input: {
    roomId: string
    sessionKey: string
    before?: string | null
    after?: string | null
    limitRows?: number
}): Promise<RoomSessionWindow> {
    const startedAt = performanceNow()
    const query = new URLSearchParams()
    query.set('limitRows', String(input.limitRows ?? 40))
    if (input.before) {
        query.set('before', input.before)
    }
    if (input.after) {
        query.set('after', input.after)
    }
    const payload = await requestPiRuntime(
        input.roomId,
        `/threads/${encodeURIComponent(input.sessionKey)}/window?${query.toString()}`,
        sessionWindowSchema,
    )
    logPerformanceEvent('chat.window.proxy', {
        roomId: input.roomId,
        sessionKey: input.sessionKey,
        durationMs: elapsedPerformanceMs(startedAt),
        rowCount: payload.rows.length,
        totalRows: payload.totalRows,
        artifactCount: payload.artifacts.length,
        payloadBytes: jsonPayloadByteLength(payload),
    })
    return payload
}

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
    const startedAt = performanceNow()
    const requestedMessageLimit =
        typeof input.messageLimit === 'number' && Number.isFinite(input.messageLimit)
            ? Math.max(0, Math.floor(input.messageLimit))
            : 200
    let metadataMs: number | null = null
    let runtimeFetchMs: number | null = null
    let readStateMs: number | null = null

    const logSnapshot = (status: string, snapshot: RoomExecutionSnapshot | null) => {
        logPerformanceEvent('snapshot.load', {
            roomId: input.roomId,
            status,
            executionState: snapshot?.executionState ?? null,
            selectedThreadRequested: Boolean(input.selectedThreadKey),
            selectedThreadResolved: Boolean(snapshot?.selectedThreadKey),
            messageLimit: requestedMessageLimit,
            durationMs: elapsedPerformanceMs(startedAt),
            metadataMs,
            runtimeFetchMs,
            usageSyncMs: null,
            readStateMs,
            threadCount: snapshot?.threads.length ?? null,
            selectedMessageCount: snapshot?.selectedThreadMessages.length ?? null,
            selectedArtifactCount: snapshot?.selectedThreadArtifacts.length ?? null,
            activityCount: snapshot?.recentActivity.length ?? null,
            payloadBytes: snapshot ? jsonPayloadByteLength(snapshot) : null,
        })
    }

    const metadataStartedAt = performanceNow()
    const room = await roomRepository.findRoomById(input.roomId)
    if (!room) {
        metadataMs = elapsedPerformanceMs(metadataStartedAt)
        logSnapshot('missing_room', null)
        throw new Error(`Room ${input.roomId} does not exist`)
    }

    const runtimeMetadata = await roomRuntimeMetadataRepository.findByRoomId(input.roomId)
    const config = await roomConfigRepository.getOrCreate(input.roomId)
    metadataMs = elapsedPerformanceMs(metadataStartedAt)
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
        const snapshot = emptySnapshot({
            room: roomOverview,
            state: 'unavailable',
            message: 'Room runtime has no allocated Pi endpoint',
        })
        logSnapshot('unavailable_no_endpoint', snapshot)
        return snapshot
    }

    if (room.status !== 'running' && room.status !== 'degraded') {
        const snapshot = emptySnapshot({
            room: roomOverview,
            state: 'unavailable',
            message: `Room is ${room.status}. Start the runtime to load threads and chat`,
        })
        logSnapshot('unavailable_room_status', snapshot)
        return snapshot
    }

    try {
        const query = new URLSearchParams()
        if (input.selectedThreadKey) {
            query.set('selectedThreadKey', input.selectedThreadKey)
        }
        query.set('messageLimit', String(requestedMessageLimit))
        const runtimeFetchStartedAt = performanceNow()
        const payload = await requestPiRuntime(
            input.roomId,
            `/snapshot?${query.toString()}`,
            snapshotSchema,
        )
        runtimeFetchMs = elapsedPerformanceMs(runtimeFetchStartedAt)
        const readStateStartedAt = performanceNow()
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
                browserSession: payload.browserSession ?? null,
            },
        })
        readStateMs = elapsedPerformanceMs(readStateStartedAt)

        logSnapshot('connected', snapshot)
        return snapshot
    } catch (error) {
        const snapshot = emptySnapshot({
            room: roomOverview,
            state: 'error',
            message: error instanceof Error ? error.message : 'Unknown Pi adapter error',
        })
        logSnapshot('error', snapshot)
        return snapshot
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
