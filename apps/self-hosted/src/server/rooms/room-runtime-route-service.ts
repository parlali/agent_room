import { setResponseHeaders, setResponseStatus } from '@tanstack/react-start/server'
import type {
    RoomDesiredState,
    RoomMode,
    RoomProviderMode,
    RoomRecord,
} from '#/domain/domain-types'
import type { RoomFileSurface } from '#/domain/room-file-types'
import type { JobSchedule } from '#/domain/job-schedule'
import { readApiSessionActor } from '#/server/auth/api-session'
import type { HostedActor } from '#/server/cloudflare/hosted-auth'
import { readHostedRequestContext } from '#/server/cloudflare/hosted-request-context'
import {
    requireHostedActor as requireCurrentHostedActor,
    requireHostedMutationActor as requireCurrentHostedMutationActor,
    requireHostedRouteActor,
} from '#/server/cloudflare/hosted-route-auth'
import {
    createHostedRoom,
    deleteHostedRoom,
    getHostedRoom,
    setHostedRoomDesiredState,
    updateHostedRoomIdentity,
} from '#/server/cloudflare/hosted-room-service'
import {
    getHostedSessionComposerDraft,
    hostedRoomSetupReadiness,
    listHostedUsage,
    saveHostedSessionComposerDraft,
} from '#/server/cloudflare/hosted-room-read-model-service'
import { getHostedRoomMemory, updateHostedRoomMemory } from '#/server/cloudflare/hosted-room-memory'
import {
    listHostedRoomDirectory,
    listHostedRoomFiles,
    listHostedRoomFileTree,
    readHostedRoomFileContent,
} from '#/server/cloudflare/hosted-file-read-store'

export type RuntimeRouteActor = {
    userId: string
    sessionId?: string
    workspaceId?: string
}

interface ApiRoomOwnerContext {
    actor: RuntimeRouteActor
    room: RoomRecord
    hosted: {
        env: NonNullable<ReturnType<typeof readHostedRequestContext>>['env']
        actor: HostedActor
    } | null
}

type RoomOwnerAccessResult =
    | {
          ok: true
          room: RoomRecord
      }
    | {
          ok: false
          status: 403 | 404
          statusText: 'Forbidden' | 'Not Found'
          message: string
      }

type RoomOwnerAccessFailure = Extract<RoomOwnerAccessResult, { ok: false }>

export async function ensureRuntimeSupervisorBoot() {
    if (readHostedRequestContext()) {
        return
    }
    const { ensureRuntimeSupervisorBoot: ensureBoot } =
        await import('#/server/rooms/runtime-supervisor-bootstrap')
    await ensureBoot()
}

export async function syncRoomOnboarding(roomId: string) {
    if (readHostedRequestContext()) {
        return
    }
    const { syncRoomOnboardingCompletion } = await import('#/server/rooms/room-onboarding')
    await syncRoomOnboardingCompletion(roomId)
}

export async function requireAuthenticatedActor() {
    const hosted = await requireCurrentHostedActor()
    if (hosted) {
        return hosted.actor
    }
    const { requireAuthenticatedActor: requireActor } = await import('#/server/auth/session-auth')
    return requireActor()
}

export async function requireMutationActor() {
    const hosted = await requireCurrentHostedMutationActor()
    if (hosted) {
        return hosted.actor
    }
    const { assertSameOriginMutation } = await import('#/server/auth/session-auth')
    assertSameOriginMutation()
    return requireAuthenticatedActor()
}

export async function resolveRoomOwnerAccess(
    actor: RuntimeRouteActor,
    roomId: string,
): Promise<RoomOwnerAccessResult> {
    const hostedContext = readHostedRequestContext()
    if (hostedContext) {
        if (!actor.workspaceId) {
            return {
                ok: false,
                status: 403,
                statusText: 'Forbidden',
                message: 'Room access denied',
            }
        }
        const room = await getHostedRoom({
            env: hostedContext.env,
            workspaceId: actor.workspaceId,
            roomId,
        })
        if (!room) {
            return {
                ok: false,
                status: 404,
                statusText: 'Not Found',
                message: 'Room not found',
            }
        }
        return {
            ok: true,
            room,
        }
    }
    const { roomRepository } = await import('#/server/db/repositories')
    const room = await roomRepository.findRoomById(roomId)
    if (!room) {
        return {
            ok: false,
            status: 404,
            statusText: 'Not Found',
            message: 'Room not found',
        }
    }
    if (room.createdByUserId !== actor.userId) {
        return {
            ok: false,
            status: 403,
            statusText: 'Forbidden',
            message: 'Room access denied',
        }
    }
    return {
        ok: true,
        room,
    }
}

export async function requireRoomOwner(actor: RuntimeRouteActor, roomId: string) {
    const result = await resolveRoomOwnerAccess(actor, roomId)
    if (!result.ok) {
        setResponseStatus(result.status, result.statusText)
        throw new Error(result.message)
    }
    return result.room
}

function roomOwnerAccessFailureResponse(result: RoomOwnerAccessFailure): Response {
    return new Response(result.message, {
        status: result.status,
        headers: {
            'cache-control': 'no-store',
            'content-type': 'text/plain; charset=utf-8',
        },
    })
}

export async function requireApiRoomOwner(input: {
    request: Request
    roomId: string
}): Promise<ApiRoomOwnerContext | Response> {
    const hostedContext = readHostedRequestContext()
    if (hostedContext) {
        const actor = await requireHostedRouteActor({
            env: hostedContext.env,
            request: input.request,
        })
        if (actor instanceof Response) {
            return actor
        }
        const access = await resolveRoomOwnerAccess(actor, input.roomId)
        if (!access.ok) {
            return roomOwnerAccessFailureResponse(access)
        }
        return {
            actor,
            room: access.room,
            hosted: {
                env: hostedContext.env,
                actor,
            },
        }
    }

    const actor = await readApiSessionActor(input.request)
    if (!actor) {
        return new Response('Authentication required', {
            status: 401,
            headers: {
                'cache-control': 'no-store',
                'content-type': 'text/plain; charset=utf-8',
            },
        })
    }
    const access = await resolveRoomOwnerAccess(actor, input.roomId)
    if (!access.ok) {
        return roomOwnerAccessFailureResponse(access)
    }
    return {
        actor,
        room: access.room,
        hosted: null,
    }
}

export async function getRoomSetupReadinessForRoute() {
    await requireAuthenticatedActor()
    setResponseHeaders({
        'cache-control': 'no-store',
    })
    if (readHostedRequestContext()) {
        return hostedRoomSetupReadiness()
    }
    const { getRoomSetupReadiness } = await import('#/server/rooms/runtime-readiness')
    return getRoomSetupReadiness()
}

export async function createRoomForRoute(data: {
    displayName: string
    slug?: string | null
    startImmediately?: boolean
    instructions?: string
    providerMode?: RoomProviderMode
    providerConnectionId?: string | null
    roomMode?: RoomMode
    cronTimezone?: string
    mcpConnectionIds?: string[]
    initialCron?: {
        name: string
        message: string
        schedule: JobSchedule
    } | null
}) {
    const hosted = await requireCurrentHostedMutationActor()
    if (hosted) {
        if (data.initialCron) {
            throw new Error('Hosted scheduled jobs are not enabled')
        }
        const room = await createHostedRoom({
            env: hosted.context.env,
            actor: hosted.actor,
            displayName: data.displayName,
            slug: data.slug ?? undefined,
            startImmediately: data.startImmediately ?? true,
            instructions: data.instructions,
            providerMode: data.providerMode,
            providerConnectionId: data.providerConnectionId,
            roomMode: data.roomMode,
            cronTimezone: data.cronTimezone,
            mcpConnectionIds: data.mcpConnectionIds,
        })
        return room
    }
    const actor = await requireMutationActor()
    const { createRoom } = await import('#/server/rooms/room-service')
    return createRoom({
        displayName: data.displayName,
        slug: data.slug ?? undefined,
        createdByUserId: actor.userId,
        startImmediately: data.startImmediately ?? true,
        instructions: data.instructions,
        providerMode: data.providerMode,
        providerConnectionId: data.providerConnectionId,
        roomMode: data.roomMode,
        cronTimezone: data.cronTimezone,
        mcpConnectionIds: data.mcpConnectionIds,
        initialCron: data.initialCron,
    })
}

export async function setRoomDesiredStateForRoute(data: {
    roomId: string
    desiredState: RoomDesiredState
}) {
    const hosted = await requireCurrentHostedMutationActor()
    if (hosted) {
        await requireRoomOwner(hosted.actor, data.roomId)
        await setHostedRoomDesiredState({
            env: hosted.context.env,
            actor: hosted.actor,
            roomId: data.roomId,
            desiredState: data.desiredState,
        })
        return {
            ok: true,
        }
    }
    const actor = await requireMutationActor()
    await requireRoomOwner(actor, data.roomId)
    const { setRoomDesiredState } = await import('#/server/rooms/room-service')
    await setRoomDesiredState({
        roomId: data.roomId,
        desiredState: data.desiredState,
        actorUserId: actor.userId,
    })
    return {
        ok: true,
    }
}

export async function updateRoomIdentityForRoute(data: {
    roomId: string
    displayName: string
    slug?: string | null
}) {
    const hosted = await requireCurrentHostedMutationActor()
    if (hosted) {
        await requireRoomOwner(hosted.actor, data.roomId)
        return updateHostedRoomIdentity({
            env: hosted.context.env,
            actor: hosted.actor,
            roomId: data.roomId,
            displayName: data.displayName,
            slug: data.slug ?? null,
        })
    }
    const actor = await requireMutationActor()
    await requireRoomOwner(actor, data.roomId)
    const { updateRoomIdentity } = await import('#/server/rooms/room-service')
    return updateRoomIdentity({
        roomId: data.roomId,
        displayName: data.displayName,
        slug: data.slug ?? null,
        actorUserId: actor.userId,
    })
}

export async function getSessionComposerDraftForRoute(data: {
    roomId: string
    sessionKey: string
}) {
    const hosted = await requireCurrentHostedActor()
    if (hosted) {
        setResponseHeaders({
            'cache-control': 'no-store',
        })
        await requireRoomOwner(hosted.actor, data.roomId)
        return getHostedSessionComposerDraft({
            env: hosted.context.env,
            actor: hosted.actor,
            authSessionId: hosted.actor.sessionId,
            roomId: data.roomId,
            sessionKey: data.sessionKey,
        })
    }
    const actor = await requireAuthenticatedActor()
    setResponseHeaders({
        'cache-control': 'no-store',
    })
    await requireRoomOwner(actor, data.roomId)
    const { sessionComposerDraftRepository } = await import('#/server/db/repositories')
    const draft = await sessionComposerDraftRepository.find({
        authSessionId: actor.sessionId,
        roomId: data.roomId,
        sessionKey: data.sessionKey,
    })
    return {
        draft: draft?.draft ?? '',
        updatedAt: draft?.updatedAt.getTime() ?? null,
    }
}

export async function saveSessionComposerDraftForRoute(data: {
    roomId: string
    sessionKey: string
    draft: string
}) {
    const hosted = await requireCurrentHostedMutationActor()
    if (hosted) {
        await requireRoomOwner(hosted.actor, data.roomId)
        return saveHostedSessionComposerDraft({
            env: hosted.context.env,
            actor: hosted.actor,
            authSessionId: hosted.actor.sessionId,
            roomId: data.roomId,
            sessionKey: data.sessionKey,
            draft: data.draft,
        })
    }
    const actor = await requireMutationActor()
    await requireRoomOwner(actor, data.roomId)
    const { sessionComposerDraftRepository } = await import('#/server/db/repositories')
    const draft = await sessionComposerDraftRepository.upsert({
        authSessionId: actor.sessionId,
        roomId: data.roomId,
        sessionKey: data.sessionKey,
        draft: data.draft,
    })
    return {
        draft: draft?.draft ?? '',
        updatedAt: draft?.updatedAt.getTime() ?? null,
    }
}

export async function sendMessageForRoute(data: {
    roomId: string
    sessionKey: string
    message: string
}) {
    const hosted = await requireCurrentHostedMutationActor()
    if (hosted) {
        await requireRoomOwner(hosted.actor, data.roomId)
        const { sendRoomThreadMessage } = await import('#/server/rooms/execution-engine')
        return sendRoomThreadMessage({
            roomId: data.roomId,
            sessionKey: data.sessionKey,
            message: data.message,
            awaitCompletion: false,
        })
    }
    const actor = await requireMutationActor()
    await requireRoomOwner(actor, data.roomId)
    await ensureRuntimeSupervisorBoot()
    const { sendRoomSessionMessage } = await import('#/server/rooms/room-session-actions')
    return sendRoomSessionMessage({
        roomId: data.roomId,
        sessionKey: data.sessionKey,
        message: data.message,
    })
}

export async function createThreadForRoute(data: { roomId: string; firstMessage?: string | null }) {
    const hosted = await requireCurrentHostedMutationActor()
    if (hosted) {
        await requireRoomOwner(hosted.actor, data.roomId)
        const { createRoomThread } = await import('#/server/rooms/execution-engine')
        return createRoomThread({
            roomId: data.roomId,
            firstMessage: data.firstMessage,
        })
    }
    const actor = await requireMutationActor()
    await requireRoomOwner(actor, data.roomId)
    await ensureRuntimeSupervisorBoot()
    const { createRegularRoomThread } = await import('#/server/rooms/room-session-actions')
    return createRegularRoomThread({
        roomId: data.roomId,
        firstMessage: data.firstMessage,
    })
}

export async function getRoomPersonalityForRoute(data: { roomId: string }) {
    const hosted = await requireCurrentHostedActor()
    if (hosted) {
        await requireRoomOwner(hosted.actor, data.roomId)
        const { sanitizePersonalityForm } = await import('#/server/rooms/personality/form')
        const memory = await getHostedRoomMemory({
            env: hosted.context.env,
            actor: hosted.actor,
            roomId: data.roomId,
        })
        const memoryRecord =
            memory.memory && typeof memory.memory === 'object' && !Array.isArray(memory.memory)
                ? (memory.memory as Record<string, unknown>)
                : {}
        return {
            roomId: data.roomId,
            form: sanitizePersonalityForm(memoryRecord.personality),
        }
    }
    const actor = await requireAuthenticatedActor()
    await requireRoomOwner(actor, data.roomId)
    const { getRoomPersonality } = await import('#/server/rooms/room-onboarding')
    const form = await getRoomPersonality(data.roomId)
    return { roomId: data.roomId, form }
}

export async function saveRoomPersonalityForRoute(data: {
    roomId: string
    form: Record<string, unknown>
}) {
    const hosted = await requireCurrentHostedMutationActor()
    if (hosted) {
        await requireRoomOwner(hosted.actor, data.roomId)
        const { sanitizePersonalityForm } = await import('#/server/rooms/personality/form')
        const form = sanitizePersonalityForm(data.form)
        const current = await getHostedRoomMemory({
            env: hosted.context.env,
            actor: hosted.actor,
            roomId: data.roomId,
        })
        const memory =
            current.memory && typeof current.memory === 'object' && !Array.isArray(current.memory)
                ? { ...(current.memory as Record<string, unknown>), personality: form }
                : { personality: form }
        await updateHostedRoomMemory({
            env: hosted.context.env,
            actor: hosted.actor,
            roomId: data.roomId,
            memory,
            expectedHash: current.hash,
        })
        return { roomId: data.roomId, form }
    }
    const actor = await requireMutationActor()
    await requireRoomOwner(actor, data.roomId)
    const { saveRoomPersonality } = await import('#/server/rooms/room-onboarding')
    const form = await saveRoomPersonality({
        roomId: data.roomId,
        form: data.form,
        actorUserId: actor.userId,
    })
    return { roomId: data.roomId, form }
}

export async function listRoomUsageForRoute(data: { roomId: string; limit?: number }) {
    const hosted = await requireCurrentHostedActor()
    if (hosted) {
        setResponseHeaders({
            'cache-control': 'no-store',
        })
        await requireRoomOwner(hosted.actor, data.roomId)
        const usage = await listHostedUsage({
            env: hosted.context.env,
            actor: hosted.actor,
            roomId: data.roomId,
            limit: data.limit ?? 100,
        })
        return {
            roomId: data.roomId,
            ...usage,
        }
    }
    const actor = await requireAuthenticatedActor()
    setResponseHeaders({
        'cache-control': 'no-store',
    })
    await requireRoomOwner(actor, data.roomId)
    const { syncRoomRuntimeUsage } = await import('#/server/rooms/execution-engine')
    await syncRoomRuntimeUsage(data.roomId)
    const { usageRepository } = await import('#/server/db/repositories')
    const events = await usageRepository.listByRoom({
        roomId: data.roomId,
        limit: data.limit ?? 100,
    })
    const totals = await usageRepository.summarizeByRoom({
        roomId: data.roomId,
    })
    return {
        roomId: data.roomId,
        events,
        totals,
    }
}

export async function listRoomFilesForRoute(data: { roomId: string }) {
    const hosted = await requireCurrentHostedActor()
    if (hosted) {
        setResponseHeaders({
            'cache-control': 'no-store',
        })
        await requireRoomOwner(hosted.actor, data.roomId)
        return listHostedRoomFiles({
            env: hosted.context.env,
            workspaceId: hosted.actor.workspaceId,
            roomId: data.roomId,
        })
    }
    const actor = await requireAuthenticatedActor()
    setResponseHeaders({
        'cache-control': 'no-store',
    })
    await requireRoomOwner(actor, data.roomId)
    const { listRoomFiles } = await import('#/server/rooms/file-store')
    return listRoomFiles(data.roomId)
}

export async function listRoomFileTreeForRoute(data: { roomId: string }) {
    const hosted = await requireCurrentHostedActor()
    if (hosted) {
        setResponseHeaders({
            'cache-control': 'no-store',
        })
        await requireRoomOwner(hosted.actor, data.roomId)
        return listHostedRoomFileTree({
            env: hosted.context.env,
            workspaceId: hosted.actor.workspaceId,
            roomId: data.roomId,
        })
    }
    const actor = await requireAuthenticatedActor()
    setResponseHeaders({
        'cache-control': 'no-store',
    })
    await requireRoomOwner(actor, data.roomId)
    const { listRoomFileTree } = await import('#/server/rooms/file-store')
    return listRoomFileTree(data.roomId)
}

export async function listRoomDirectoryForRoute(data: {
    roomId: string
    surface: RoomFileSurface
    relativePath?: string
}) {
    const hosted = await requireCurrentHostedActor()
    if (hosted) {
        setResponseHeaders({
            'cache-control': 'no-store',
        })
        await requireRoomOwner(hosted.actor, data.roomId)
        return listHostedRoomDirectory({
            env: hosted.context.env,
            workspaceId: hosted.actor.workspaceId,
            roomId: data.roomId,
            surface: data.surface,
            relativePath: data.relativePath,
        })
    }
    const actor = await requireAuthenticatedActor()
    setResponseHeaders({
        'cache-control': 'no-store',
    })
    await requireRoomOwner(actor, data.roomId)
    const { listRoomDirectory } = await import('#/server/rooms/file-store')
    return listRoomDirectory({
        roomId: data.roomId,
        surface: data.surface,
        relativePath: data.relativePath,
    })
}

export async function readRoomFileForRoute(data: {
    roomId: string
    surface: RoomFileSurface
    relativePath: string
}) {
    const hosted = await requireCurrentHostedActor()
    if (hosted) {
        setResponseHeaders({
            'cache-control': 'no-store',
        })
        await requireRoomOwner(hosted.actor, data.roomId)
        return readHostedRoomFileContent({
            env: hosted.context.env,
            workspaceId: hosted.actor.workspaceId,
            roomId: data.roomId,
            surface: data.surface,
            relativePath: data.relativePath,
        })
    }
    const actor = await requireAuthenticatedActor()
    setResponseHeaders({
        'cache-control': 'no-store',
    })
    await requireRoomOwner(actor, data.roomId)
    const { readRoomFileContent } = await import('#/server/rooms/file-store-preview')
    return readRoomFileContent({
        roomId: data.roomId,
        surface: data.surface,
        relativePath: data.relativePath,
    })
}

export async function getRoomMemoryForRoute(data: { roomId: string }) {
    const hosted = await requireCurrentHostedActor()
    if (hosted) {
        setResponseHeaders({
            'cache-control': 'no-store',
        })
        await requireRoomOwner(hosted.actor, data.roomId)
        return getHostedRoomMemory({
            env: hosted.context.env,
            actor: hosted.actor,
            roomId: data.roomId,
        })
    }
    const actor = await requireAuthenticatedActor()
    setResponseHeaders({
        'cache-control': 'no-store',
    })
    await requireRoomOwner(actor, data.roomId)
    const { readRoomMemory } = await import('#/server/rooms/room-memory-store')
    return readRoomMemory(data.roomId)
}

export async function updateRoomMemoryForRoute(data: {
    roomId: string
    memory: unknown
    expectedHash?: string | null
}) {
    const hosted = await requireCurrentHostedMutationActor()
    if (hosted) {
        await requireRoomOwner(hosted.actor, data.roomId)
        return updateHostedRoomMemory({
            env: hosted.context.env,
            actor: hosted.actor,
            roomId: data.roomId,
            memory: data.memory,
            expectedHash: data.expectedHash ?? null,
        })
    }
    const actor = await requireMutationActor()
    await requireRoomOwner(actor, data.roomId)
    const { updateRoomMemory } = await import('#/server/rooms/room-memory-store')
    return updateRoomMemory({
        roomId: data.roomId,
        memory: data.memory,
        expectedHash: data.expectedHash ?? null,
    })
}

export async function deleteRoomForRoute(data: { roomId: string; confirmSlug: string }) {
    const hosted = await requireCurrentHostedMutationActor()
    if (hosted) {
        await requireRoomOwner(hosted.actor, data.roomId)
        await deleteHostedRoom({
            env: hosted.context.env,
            actor: hosted.actor,
            roomId: data.roomId,
            confirmSlug: data.confirmSlug,
        })
        return { ok: true }
    }
    const actor = await requireMutationActor()
    const room = await requireRoomOwner(actor, data.roomId)
    if (room.slug !== data.confirmSlug) {
        throw new Error('Confirmation slug does not match room slug')
    }
    const { deleteRoom } = await import('#/server/rooms/room-service')
    await deleteRoom({
        roomId: data.roomId,
        actorUserId: actor.userId,
    })
    return { ok: true }
}

export async function deleteSessionForRoute(data: { roomId: string; sessionKey: string }) {
    const hosted = await requireCurrentHostedMutationActor()
    if (hosted) {
        await requireRoomOwner(hosted.actor, data.roomId)
        const { deleteRoomSession } = await import('#/server/rooms/execution-engine')
        await deleteRoomSession({
            roomId: data.roomId,
            sessionKey: data.sessionKey,
        })
        return { ok: true }
    }
    const actor = await requireMutationActor()
    await requireRoomOwner(actor, data.roomId)
    await ensureRuntimeSupervisorBoot()
    const { sessionComposerDraftRepository } = await import('#/server/db/repositories')
    const { deleteRoomSession } = await import('#/server/rooms/execution-engine')
    await deleteRoomSession({
        roomId: data.roomId,
        sessionKey: data.sessionKey,
    })
    await sessionComposerDraftRepository.deleteByRoomSession({
        roomId: data.roomId,
        sessionKey: data.sessionKey,
    })
    return { ok: true }
}
