import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/rooms/$roomId/files/preview')({
    server: {
        handlers: {
            GET: async ({ request, params }) => {
                const { requireApiRoomOwner } =
                    await import('#/server/rooms/room-runtime-route-service')
                const owner = await requireApiRoomOwner({
                    request,
                    roomId: params.roomId,
                })
                if (owner instanceof Response) {
                    return owner
                }

                const { roomFilePreviewResponse } =
                    await import('#/server/rooms/room-file-preview-response')
                return roomFilePreviewResponse({
                    request,
                    roomId: owner.room.id,
                    hosted: owner.hosted
                        ? {
                              env: owner.hosted.env,
                              workspaceId: owner.hosted.actor.workspaceId,
                          }
                        : null,
                })
            },
        },
    },
})
