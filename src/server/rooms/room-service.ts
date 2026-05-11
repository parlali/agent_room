import { rm } from 'node:fs/promises'
import {
    auditRepository,
    roomCronRepository,
    roomRepository,
    roomRuntimeMetadataRepository,
    roomSecretRepository,
} from '../db/repositories'
import {
    roomConfigRepository,
    roomMcpBindingRepository,
} from '../db/repositories/configuration-repository'
import { saveRoomConfig } from '../configuration/operator-configuration'
import type {
    ProviderApi,
    RoomDesiredState,
    RoomMode,
    RoomProviderMode,
    RoomRecord,
} from '../domain/types'
import { describeJobSchedule, type JobSchedule } from '#/lib/job-schedule'
import { getRoomPaths } from './room-paths'
import { assertRoomSetupReady } from './runtime-readiness'
import { roomRuntimeManager } from './runtime-manager'

function normalizeSlug(value: string) {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
}

function isUniqueViolation(error: unknown): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        String((error as { code: unknown }).code) === '23505'
    )
}

function throwRoomSlugConflict(error: unknown, slug: string): never {
    if (isUniqueViolation(error)) {
        throw new Error(`Room slug "${slug}" already exists`)
    }
    throw error
}

export async function createRoom(input: {
    displayName: string
    slug?: string
    createdByUserId: string
    startImmediately?: boolean
    instructions?: string
    providerMode?: RoomProviderMode
    providerConnectionId?: string | null
    provider?: string | null
    providerApi?: ProviderApi | null
    providerBaseUrl?: string | null
    providerModel?: string | null
    providerApiKey?: string
    roomMode?: RoomMode
    cronTimezone?: string
    mcpConnectionIds?: string[]
    initialCron?: {
        name: string
        message: string
        schedule: JobSchedule
    } | null
}): Promise<RoomRecord> {
    const displayName = input.displayName.trim()
    if (!displayName) {
        throw new Error('Room display name cannot be empty')
    }

    const slug = input.slug ? normalizeSlug(input.slug) : normalizeSlug(input.displayName)
    if (!slug) {
        throw new Error('Room slug cannot be empty')
    }

    assertRoomSetupReady()

    let room: RoomRecord
    try {
        room = await roomRepository.createRoom({
            slug,
            displayName,
            desiredState: input.startImmediately ? 'running' : 'stopped',
            createdByUserId: input.createdByUserId,
        })
    } catch (error) {
        throwRoomSlugConflict(error, slug)
    }

    await auditRepository.appendEvent({
        actorUserId: input.createdByUserId,
        roomId: room.id,
        action: 'room.created',
        payload: {
            slug: room.slug,
            desiredState: room.desiredState,
        },
    })

    try {
        await saveRoomConfig(
            {
                roomId: room.id,
                instructions: input.instructions ?? '',
                providerMode: input.providerMode ?? 'app_default',
                providerConnectionId: input.providerConnectionId ?? null,
                provider: input.provider ?? null,
                providerApi: input.providerApi ?? null,
                providerBaseUrl: input.providerBaseUrl ?? null,
                providerModel: input.providerModel ?? null,
                providerApiKey: input.providerApiKey,
                roomMode: input.roomMode ?? 'coworker',
                cronTimezone: input.cronTimezone ?? 'UTC',
                mcpConnectionIds: input.mcpConnectionIds ?? [],
            },
            input.createdByUserId,
        )
    } catch (error) {
        await auditRepository.appendEvent({
            actorUserId: input.createdByUserId,
            roomId: room.id,
            action: 'room.config_failed',
            payload: {
                slug: room.slug,
                error: error instanceof Error ? error.message : 'unknown room config error',
            },
        })
        await roomRepository.deleteRoom(room.id)
        throw error
    }

    if (input.startImmediately) {
        try {
            await roomRuntimeManager.startRoom(room.id, input.createdByUserId)
            if (input.initialCron) {
                const { createRoomCronJob } = await import('./execution-engine')
                await createRoomCronJob({
                    roomId: room.id,
                    name: input.initialCron.name,
                    message: input.initialCron.message,
                    schedule: input.initialCron.schedule,
                })
                await auditRepository.appendEvent({
                    actorUserId: input.createdByUserId,
                    roomId: room.id,
                    action: 'room.initial_cron_created',
                    payload: {
                        name: input.initialCron.name,
                        schedule: describeJobSchedule(input.initialCron.schedule),
                    },
                })
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'unknown runtime start error'
            await roomRepository.updateRoomDesiredState(room.id, 'stopped')
            await roomRepository.updateRoomStatus(room.id, 'failed')
            await roomRuntimeMetadataRepository.upsert({
                roomId: room.id,
                port: null,
                pid: null,
                configVersion: 0,
                tokenVersion: 0,
                healthStatus: 'unhealthy',
                startedAt: null,
                lastHealthAt: null,
                lastError: message,
            })
            await auditRepository.appendEvent({
                actorUserId: input.createdByUserId,
                roomId: room.id,
                action: 'room.start_after_create_failed',
                payload: {
                    slug: room.slug,
                    error: message,
                },
            })
            const updatedRoom = await roomRepository.findRoomById(room.id)
            if (updatedRoom) {
                return updatedRoom
            }
            return room
        }
    }

    return room
}

export async function listRooms() {
    return roomRepository.listRooms()
}

export async function setRoomDesiredState(input: {
    roomId: string
    desiredState: RoomDesiredState
    actorUserId: string
}): Promise<void> {
    if (input.desiredState === 'running') {
        await roomRuntimeManager.startRoom(input.roomId, input.actorUserId)
        return
    }

    await roomRuntimeManager.stopRoom(input.roomId, input.actorUserId)
}

export async function updateRoomIdentity(input: {
    roomId: string
    displayName: string
    slug?: string | null
    actorUserId: string
}): Promise<RoomRecord> {
    const displayName = input.displayName.trim()
    if (!displayName) {
        throw new Error('Room display name cannot be empty')
    }

    const slug = input.slug ? normalizeSlug(input.slug) : normalizeSlug(displayName)
    if (!slug) {
        throw new Error('Room slug cannot be empty')
    }

    let room: RoomRecord
    try {
        room = await roomRepository.updateRoomIdentity({
            roomId: input.roomId,
            slug,
            displayName,
        })
    } catch (error) {
        throwRoomSlugConflict(error, slug)
    }

    await auditRepository.appendEvent({
        actorUserId: input.actorUserId,
        roomId: room.id,
        action: 'room.identity_updated',
        payload: {
            slug: room.slug,
        },
    })

    return room
}

export async function deleteRoom(input: { roomId: string; actorUserId: string }): Promise<void> {
    const room = await roomRepository.findRoomById(input.roomId)
    if (!room) {
        throw new Error('Room not found')
    }

    await roomRuntimeManager.stopRoom(input.roomId, input.actorUserId)

    const paths = getRoomPaths(input.roomId)

    await roomCronRepository.deleteAllByRoomId(input.roomId)
    await roomSecretRepository.deleteByRoomId(input.roomId)
    await roomMcpBindingRepository.replaceForRoom(input.roomId, [])
    await roomConfigRepository.findByRoomId(input.roomId).then(async (config) => {
        if (config) {
            const { sql } = await import('../db/client')
            await sql`DELETE FROM room_configs WHERE room_id = ${input.roomId}`
        }
    })
    await roomRuntimeMetadataRepository.deleteByRoomId(input.roomId)

    await auditRepository.appendEvent({
        actorUserId: input.actorUserId,
        roomId: input.roomId,
        action: 'room.deleted',
        payload: {
            slug: room.slug,
            displayName: room.displayName,
        },
    })

    await roomRepository.deleteRoom(input.roomId)

    try {
        await rm(paths.roomRootDir, { recursive: true, force: true })
    } catch {}
}
