import { createFileRoute } from '@tanstack/react-router'
import { ensureRuntimeSupervisorBoot } from '#/server/rooms/runtime-supervisor-bootstrap'
import { createRoomEventStream } from '#/server/rooms/execution-engine'
import { requireApiRoomOwner } from '#/server/rooms/room-runtime-route-service'
import { instrumentReadableByteStream } from '#/server/telemetry/performance'

export const Route = createFileRoute('/api/rooms/$roomId/events')({
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

                if (!owner.hosted) {
                    await ensureRuntimeSupervisorBoot()
                }
                const stream = instrumentReadableByteStream({
                    stream: createRoomEventStream({
                        roomId: owner.room.id,
                        abortSignal: request.signal,
                    }),
                    name: 'sse.browser',
                    attributes: {
                        roomId: owner.room.id,
                        sessionKey: null,
                        streamKind: 'room',
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
