import { createFileRoute } from '@tanstack/react-router'
import { hostedRouteSameOriginResponse } from '#/server/cloudflare/hosted-route-auth'

export const Route = createFileRoute('/api/rooms/$roomId/files/upload')({
    server: {
        handlers: {
            POST: async ({ request, params }) => {
                const { requireApiRoomOwner } =
                    await import('#/server/rooms/room-runtime-route-service')
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
                    : (await import('#/server/auth/api-session')).assertApiSameOriginMutation(
                          request,
                      )
                if (originError) {
                    return originError
                }

                const { uploadRoomFilesFromRequest } =
                    await import('#/server/rooms/room-file-upload-workflow')
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
