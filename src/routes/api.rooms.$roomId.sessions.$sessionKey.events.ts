import { createFileRoute } from '@tanstack/react-router'
import { requireApiSession } from '#/server/auth/api-session'
import { ensureRuntimeSupervisorBoot } from '#/server/rooms/runtime-supervisor-bootstrap'
import { createRoomSessionEventStream } from '#/server/rooms/execution-engine'
import { instrumentReadableByteStream } from '#/server/telemetry/performance'

export const Route = createFileRoute('/api/rooms/$roomId/sessions/$sessionKey/events')({
    server: {
        handlers: {
            GET: async ({ request, params }) => {
                if (!(await requireApiSession(request))) {
                    return new Response('Authentication required', {
                        status: 401,
                    })
                }

                await ensureRuntimeSupervisorBoot()
                const stream = instrumentReadableByteStream({
                    stream: createRoomSessionEventStream({
                        roomId: params.roomId,
                        sessionKey: params.sessionKey,
                        abortSignal: request.signal,
                    }),
                    name: 'sse.browser',
                    attributes: {
                        roomId: params.roomId,
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
