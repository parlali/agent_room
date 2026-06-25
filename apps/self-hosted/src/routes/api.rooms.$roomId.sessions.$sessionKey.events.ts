import { createFileRoute } from '@tanstack/react-router'
import { instrumentReadableByteStream } from '#/server/telemetry/performance'

export const Route = createFileRoute('/api/rooms/$roomId/sessions/$sessionKey/events')({
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

                if (!owner.hosted) {
                    const { ensureRuntimeSupervisorBoot } =
                        await import('#/server/rooms/runtime-supervisor-bootstrap')
                    await ensureRuntimeSupervisorBoot()
                }
                const { createRoomSessionEventStream } =
                    await import('#/server/rooms/execution-engine')
                const stream = instrumentReadableByteStream({
                    stream: createRoomSessionEventStream({
                        roomId: owner.room.id,
                        sessionKey: params.sessionKey,
                        abortSignal: request.signal,
                    }),
                    name: 'sse.browser',
                    attributes: {
                        roomId: owner.room.id,
                        sessionKey: params.sessionKey,
                        streamKind: 'session',
                    },
                    abortSignal: request.signal,
                })

                return new Response(stream, {
                    headers: {
                        'content-type': 'text/event-stream; charset=utf-8',
                        'cache-control': 'no-store, no-transform',
                        connection: 'keep-alive',
                        'x-accel-buffering': 'no',
                    },
                })
            },
        },
    },
})
