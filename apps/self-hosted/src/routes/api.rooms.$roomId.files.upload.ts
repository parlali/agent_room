import { createFileRoute } from '@tanstack/react-router'
import { assertApiSameOriginMutation } from '#/server/auth/api-session'
import { hostedRouteSameOriginResponse } from '#/server/cloudflare/hosted-route-auth'
import { uploadRoomFilesFromRequest } from '#/server/rooms/room-file-upload-workflow'
import { requireApiRoomOwner } from '#/server/rooms/room-runtime-route-service'

export const Route = createFileRoute('/api/rooms/$roomId/files/upload')({
    server: {
        handlers: {
            POST: async ({ request, params }) => {
                const owner = await requireApiRoomOwner({
                    request,
                    roomId: params.roomId,
                })
                if (owner instanceof Response) {
                    return owner
                }

                const originError = owner.hosted
                    ? hostedRouteSameOriginResponse({
                          env: owner.hosted.env,
                          request,
                      })
                    : assertApiSameOriginMutation(request)
                if (originError) {
                    return originError
                }

                return uploadRoomFilesFromRequest({
                    request,
                    room: owner.room,
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
