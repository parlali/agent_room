import { createFileRoute } from '@tanstack/react-router'
import { roomFilePreviewResponse } from '#/server/rooms/room-file-preview-response'
import { requireApiRoomOwner } from '#/server/rooms/room-runtime-route-service'

export const Route = createFileRoute('/api/rooms/$roomId/files/preview')({
    server: {
        handlers: {
            GET: async ({ request, params }) => {
                const owner = await requireApiRoomOwner({
                    request,
                    roomId: params.roomId,
                })
                if (owner instanceof Response) {
                    return owner
                }

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
