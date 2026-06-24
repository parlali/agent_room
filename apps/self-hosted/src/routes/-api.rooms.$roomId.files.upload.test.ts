import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RoomRecord } from '#/domain/domain-types'

const mocks = vi.hoisted(() => ({
    createFileRoute: vi.fn(),
    requireApiRoomOwner: vi.fn(),
    uploadRoomFilesFromRequest: vi.fn(),
    assertApiSameOriginMutation: vi.fn(),
    hostedRouteSameOriginResponse: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
    createFileRoute: mocks.createFileRoute,
}))

vi.mock('#/server/rooms/room-runtime-route-service', () => ({
    requireApiRoomOwner: mocks.requireApiRoomOwner,
}))

vi.mock('#/server/rooms/room-file-upload-workflow', () => ({
    uploadRoomFilesFromRequest: mocks.uploadRoomFilesFromRequest,
}))

vi.mock('#/server/auth/api-session', () => ({
    assertApiSameOriginMutation: mocks.assertApiSameOriginMutation,
}))

vi.mock('#/server/cloudflare/hosted-route-auth', () => ({
    hostedRouteSameOriginResponse: mocks.hostedRouteSameOriginResponse,
}))

type UploadPostHandler = (input: {
    request: Request
    params: {
        roomId: string
    }
}) => Promise<Response>

interface UploadRoute {
    server: {
        handlers: {
            POST: UploadPostHandler
        }
    }
}

const room: RoomRecord = {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'owned-room',
    displayName: 'Owned Room',
    status: 'running',
    desiredState: 'running',
    createdByUserId: 'user-owner',
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
}

async function loadPostHandler(): Promise<UploadPostHandler> {
    mocks.createFileRoute.mockReturnValue((route: UploadRoute) => route)
    const module = await import('./api.rooms.$roomId.files.upload')
    return (module.Route as unknown as UploadRoute).server.handlers.POST
}

describe('room file upload API route handler', () => {
    beforeEach(() => {
        vi.resetModules()
        for (const value of Object.values(mocks)) {
            value.mockReset()
        }
        mocks.assertApiSameOriginMutation.mockReturnValue(null)
        mocks.hostedRouteSameOriginResponse.mockReturnValue(null)
    })

    it('returns an owner access failure before origin checks, upload handling, or multipart parsing', async () => {
        const denied = new Response('Room access denied', {
            status: 403,
        })
        mocks.requireApiRoomOwner.mockResolvedValue(denied)
        const post = await loadPostHandler()
        const request = new Request(`https://agent-room.test/api/rooms/${room.id}/files/upload`, {
            method: 'POST',
        })
        const formData = vi.spyOn(request, 'formData')

        const response = await post({
            request,
            params: {
                roomId: room.id,
            },
        })

        expect(response).toBe(denied)
        expect(formData).not.toHaveBeenCalled()
        expect(mocks.assertApiSameOriginMutation).not.toHaveBeenCalled()
        expect(mocks.hostedRouteSameOriginResponse).not.toHaveBeenCalled()
        expect(mocks.uploadRoomFilesFromRequest).not.toHaveBeenCalled()
    })

    it('passes the authorized local room to upload after same-origin validation', async () => {
        const actor = {
            userId: 'user-owner',
            email: 'owner@example.com',
            role: 'operator',
            sessionId: 'session-owner',
        }
        const uploadResponse = Response.json({
            files: [],
        })
        mocks.requireApiRoomOwner.mockResolvedValue({
            actor,
            room,
            hosted: null,
        })
        mocks.uploadRoomFilesFromRequest.mockResolvedValue(uploadResponse)
        const post = await loadPostHandler()
        const request = new Request(`https://agent-room.test/api/rooms/${room.id}/files/upload`, {
            method: 'POST',
            headers: {
                origin: 'https://agent-room.test',
            },
        })

        const response = await post({
            request,
            params: {
                roomId: room.id,
            },
        })

        expect(response).toBe(uploadResponse)
        expect(mocks.assertApiSameOriginMutation).toHaveBeenCalledWith(request)
        expect(mocks.uploadRoomFilesFromRequest).toHaveBeenCalledWith({
            request,
            room,
            hosted: null,
        })
    })

    it('passes the hosted actor workspace to upload after hosted same-origin validation', async () => {
        const env = {} as never
        const actor = {
            authProvider: 'better-auth',
            userId: 'user-hosted',
            sessionId: 'session-hosted',
            email: 'hosted@example.com',
            workspaceId: 'workspace-1',
        }
        const uploadResponse = Response.json({
            files: [],
        })
        mocks.requireApiRoomOwner.mockResolvedValue({
            actor,
            room,
            hosted: {
                env,
                actor,
            },
        })
        mocks.uploadRoomFilesFromRequest.mockResolvedValue(uploadResponse)
        const post = await loadPostHandler()
        const request = new Request(`https://agent-room.test/api/rooms/${room.id}/files/upload`, {
            method: 'POST',
            headers: {
                origin: 'https://agent-room.test',
            },
        })

        const response = await post({
            request,
            params: {
                roomId: room.id,
            },
        })

        expect(response).toBe(uploadResponse)
        expect(mocks.assertApiSameOriginMutation).not.toHaveBeenCalled()
        expect(mocks.hostedRouteSameOriginResponse).toHaveBeenCalledWith({
            env,
            request,
        })
        expect(mocks.uploadRoomFilesFromRequest).toHaveBeenCalledWith({
            request,
            room,
            hosted: {
                env,
                workspaceId: 'workspace-1',
            },
        })
    })
})
