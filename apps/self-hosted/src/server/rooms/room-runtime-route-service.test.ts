import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as RoomRuntimeRouteService from './room-runtime-route-service'

const mocks = vi.hoisted(() => ({
    setResponseHeaders: vi.fn(),
    setResponseStatus: vi.fn(),
    readHostedRequestContext: vi.fn(),
    requireHostedActor: vi.fn(),
    requireHostedMutationActor: vi.fn(),
    requireHostedRouteActor: vi.fn(),
    readApiSessionActor: vi.fn(),
    requireAuthenticatedActor: vi.fn(),
    assertSameOriginMutation: vi.fn(),
    getHostedRoom: vi.fn(),
    createHostedRoom: vi.fn(),
    deleteHostedRoom: vi.fn(),
    setHostedRoomDesiredState: vi.fn(),
    updateHostedRoomIdentity: vi.fn(),
    getHostedSessionComposerDraft: vi.fn(),
    listHostedUsage: vi.fn(),
    saveHostedSessionComposerDraft: vi.fn(),
    getHostedRoomMemory: vi.fn(),
    updateHostedRoomMemory: vi.fn(),
    listHostedRoomDirectory: vi.fn(),
    listHostedRoomFiles: vi.fn(),
    listHostedRoomFileTree: vi.fn(),
    readHostedRoomFileContent: vi.fn(),
    roomFindById: vi.fn(),
    roomList: vi.fn(),
    roomListByOwner: vi.fn(),
    usageListByRoom: vi.fn(),
    usageSummarizeByRoom: vi.fn(),
    usageListRecentByRooms: vi.fn(),
    usageSummarizeByRooms: vi.fn(),
    sessionDraftFind: vi.fn(),
    sessionDraftUpsert: vi.fn(),
    sessionDraftDeleteByRoomSession: vi.fn(),
    syncRoomRuntimeUsage: vi.fn(),
    listRoomFiles: vi.fn(),
    readRoomMemory: vi.fn(),
    writeRoomUploadedFile: vi.fn(),
    publishRoomFileChanged: vi.fn(),
    deleteHostedRoomIndexedFile: vi.fn(),
    writeHostedRoomUploadedFile: vi.fn(),
    getHostedRuntimeState: vi.fn(),
    requestHostedPiRuntime: vi.fn(),
    logPerformanceEvent: vi.fn(),
}))

vi.mock('@tanstack/react-start/server', () => ({
    setResponseHeaders: mocks.setResponseHeaders,
    setResponseStatus: mocks.setResponseStatus,
}))

vi.mock('#/server/cloudflare/hosted-request-context', () => ({
    readHostedRequestContext: mocks.readHostedRequestContext,
}))

vi.mock('#/server/cloudflare/hosted-route-auth', () => ({
    requireHostedActor: mocks.requireHostedActor,
    requireHostedMutationActor: mocks.requireHostedMutationActor,
    requireHostedRouteActor: mocks.requireHostedRouteActor,
}))

vi.mock('#/server/cloudflare/hosted-room-service', () => ({
    createHostedRoom: mocks.createHostedRoom,
    deleteHostedRoom: mocks.deleteHostedRoom,
    getHostedRoom: mocks.getHostedRoom,
    getHostedRuntimeState: mocks.getHostedRuntimeState,
    setHostedRoomDesiredState: mocks.setHostedRoomDesiredState,
    updateHostedRoomIdentity: mocks.updateHostedRoomIdentity,
}))

vi.mock('#/server/cloudflare/hosted-room-read-model-service', () => ({
    getHostedSessionComposerDraft: mocks.getHostedSessionComposerDraft,
    listHostedUsage: mocks.listHostedUsage,
    saveHostedSessionComposerDraft: mocks.saveHostedSessionComposerDraft,
}))

vi.mock('#/server/cloudflare/hosted-room-memory', () => ({
    getHostedRoomMemory: mocks.getHostedRoomMemory,
    updateHostedRoomMemory: mocks.updateHostedRoomMemory,
}))

vi.mock('#/server/cloudflare/hosted-file-read-store', () => ({
    listHostedRoomDirectory: mocks.listHostedRoomDirectory,
    listHostedRoomFiles: mocks.listHostedRoomFiles,
    listHostedRoomFileTree: mocks.listHostedRoomFileTree,
    readHostedRoomFileContent: mocks.readHostedRoomFileContent,
}))

vi.mock('#/server/cloudflare/hosted-file-store', () => ({
    deleteHostedRoomIndexedFile: mocks.deleteHostedRoomIndexedFile,
    writeHostedRoomUploadedFile: mocks.writeHostedRoomUploadedFile,
}))

vi.mock('#/server/cloudflare/hosted-runtime-client', () => ({
    requestHostedPiRuntime: mocks.requestHostedPiRuntime,
}))

vi.mock('#/server/auth/api-session', () => ({
    readApiSessionActor: mocks.readApiSessionActor,
}))

vi.mock('#/server/auth/session-auth', () => ({
    requireAuthenticatedActor: mocks.requireAuthenticatedActor,
    assertSameOriginMutation: mocks.assertSameOriginMutation,
}))

vi.mock('#/server/db/repositories', () => ({
    roomRepository: {
        findRoomById: mocks.roomFindById,
        listRooms: mocks.roomList,
        listRoomsByOwner: mocks.roomListByOwner,
    },
    usageRepository: {
        listByRoom: mocks.usageListByRoom,
        summarizeByRoom: mocks.usageSummarizeByRoom,
        listRecentByRooms: mocks.usageListRecentByRooms,
        summarizeByRooms: mocks.usageSummarizeByRooms,
    },
    sessionComposerDraftRepository: {
        find: mocks.sessionDraftFind,
        upsert: mocks.sessionDraftUpsert,
        deleteByRoomSession: mocks.sessionDraftDeleteByRoomSession,
    },
}))

vi.mock('#/server/rooms/execution-engine', () => ({
    syncRoomRuntimeUsage: mocks.syncRoomRuntimeUsage,
    publishRoomFileChanged: mocks.publishRoomFileChanged,
}))

vi.mock('#/server/rooms/file-store', () => ({
    listRoomFiles: mocks.listRoomFiles,
    writeRoomUploadedFile: mocks.writeRoomUploadedFile,
}))

vi.mock('#/server/rooms/room-memory-store', () => ({
    readRoomMemory: mocks.readRoomMemory,
}))

vi.mock('#/server/telemetry/performance', () => ({
    logPerformanceEvent: mocks.logPerformanceEvent,
}))

const localActor = {
    userId: 'user-owner',
    email: 'owner@example.com',
    role: 'operator' as const,
    sessionId: 'session-owner',
}

const otherRoom = {
    id: '22222222-2222-4222-8222-222222222222',
    slug: 'other-room',
    displayName: 'Other Room',
    status: 'running' as const,
    desiredState: 'running' as const,
    createdByUserId: 'user-other',
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
}

function resetMocks() {
    for (const value of Object.values(mocks)) {
        value.mockReset()
    }
    mocks.readHostedRequestContext.mockReturnValue(null)
    mocks.requireHostedActor.mockResolvedValue(null)
    mocks.requireHostedMutationActor.mockResolvedValue(null)
    mocks.requireAuthenticatedActor.mockResolvedValue(localActor)
    mocks.readApiSessionActor.mockResolvedValue(localActor)
    mocks.roomFindById.mockResolvedValue(otherRoom)
    mocks.roomList.mockResolvedValue([otherRoom])
    mocks.usageListByRoom.mockResolvedValue([])
    mocks.usageSummarizeByRoom.mockResolvedValue({
        eventCount: 0,
        durationMs: null,
        totalTokens: null,
        estimatedCostUsd: null,
        unknownTokenEvents: 0,
    })
}

describe('room runtime route ownership', () => {
    let routeService: typeof RoomRuntimeRouteService

    beforeEach(async () => {
        vi.resetModules()
        resetMocks()
        routeService = await import('./room-runtime-route-service')
    })

    it('denies local room usage reads for a different owner', async () => {
        await expect(routeService.listRoomUsageForRoute({ roomId: otherRoom.id })).rejects.toThrow(
            'Room access denied',
        )

        expect(mocks.setResponseStatus).toHaveBeenCalledWith(403, 'Forbidden')
        expect(mocks.syncRoomRuntimeUsage).not.toHaveBeenCalled()
        expect(mocks.usageListByRoom).not.toHaveBeenCalled()
    })

    it('denies local file and memory reads for a different owner', async () => {
        mocks.listRoomFiles.mockResolvedValue([{ path: 'README.md' }])
        mocks.readRoomMemory.mockResolvedValue({ content: 'memory' })

        await expect(routeService.listRoomFilesForRoute({ roomId: otherRoom.id })).rejects.toThrow(
            'Room access denied',
        )
        await expect(routeService.getRoomMemoryForRoute({ roomId: otherRoom.id })).rejects.toThrow(
            'Room access denied',
        )

        expect(mocks.listRoomFiles).not.toHaveBeenCalled()
        expect(mocks.readRoomMemory).not.toHaveBeenCalled()
    })

    it('returns forbidden for local API access to a room owned by another user', async () => {
        const owner = await routeService.requireApiRoomOwner({
            request: new Request('https://agent-room.test/api/rooms/room-other/events'),
            roomId: otherRoom.id,
        })

        expect(owner).toBeInstanceOf(Response)
        expect((owner as Response).status).toBe(403)
        await expect((owner as Response).text()).resolves.toBe('Room access denied')
    })

    it('returns the canonical local room after API owner access succeeds', async () => {
        const ownerRoom = {
            ...otherRoom,
            createdByUserId: localActor.userId,
        }
        mocks.roomFindById.mockResolvedValue(ownerRoom)

        const owner = await routeService.requireApiRoomOwner({
            request: new Request(`https://agent-room.test/api/rooms/${ownerRoom.id}/events`),
            roomId: ownerRoom.id,
        })

        expect(owner).not.toBeInstanceOf(Response)
        expect((owner as { room: typeof ownerRoom }).room).toBe(ownerRoom)
    })

    it('keeps hosted API room access scoped to the actor workspace', async () => {
        const env = {} as never
        const hostedActor = {
            authProvider: 'better-auth' as const,
            userId: 'user-hosted',
            sessionId: 'session-hosted',
            email: 'hosted@example.com',
            workspaceId: 'workspace-1',
        }
        mocks.readHostedRequestContext.mockReturnValue({
            env,
            request: new Request('https://agent-room.test/api/rooms/room-1/events'),
        })
        mocks.requireHostedRouteActor.mockResolvedValue(hostedActor)
        mocks.getHostedRoom.mockResolvedValue(null)

        const missingRoomResponse = await routeService.requireApiRoomOwner({
            request: new Request('https://agent-room.test/api/rooms/room-1/events'),
            roomId: 'room-1',
        })

        expect(missingRoomResponse).toBeInstanceOf(Response)
        expect((missingRoomResponse as Response).status).toBe(404)
        expect(mocks.getHostedRoom).toHaveBeenCalledWith({
            env,
            workspaceId: 'workspace-1',
            roomId: 'room-1',
        })

        mocks.getHostedRoom.mockResolvedValue({
            ...otherRoom,
            id: 'room-1',
            createdByUserId: 'user-hosted',
        })

        const owner = await routeService.requireApiRoomOwner({
            request: new Request('https://agent-room.test/api/rooms/room-1/events'),
            roomId: 'room-1',
        })

        expect(owner).not.toBeInstanceOf(Response)
        expect((owner as { hosted: { actor: typeof hostedActor } | null }).hosted?.actor).toBe(
            hostedActor,
        )
        expect((owner as { room: { id: string } }).room.id).toBe('room-1')
    })
})
