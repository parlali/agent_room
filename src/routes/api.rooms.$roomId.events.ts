import { createFileRoute } from '@tanstack/react-router'
import { requireApiSession } from '#/server/auth/api-session'
import { ensureRuntimeSupervisorBoot } from '#/server/rooms/runtime-supervisor-bootstrap'
import { createRoomEventStream } from '#/server/rooms/execution-engine'

export const Route = createFileRoute('/api/rooms/$roomId/events')({
    server: {
        handlers: {
            GET: async ({ request, params }) => {
                if (!(await requireApiSession(request))) {
                    return new Response('Authentication required', {
                        status: 401,
                    })
                }

                await ensureRuntimeSupervisorBoot()
                const stream = createRoomEventStream({
                    roomId: params.roomId,
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
