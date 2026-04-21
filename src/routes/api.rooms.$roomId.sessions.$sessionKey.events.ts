import { parse } from 'cookie'
import { createFileRoute } from '@tanstack/react-router'
import { validateSessionToken } from '#/server/auth/auth-service'
import { sessionCookieName } from '#/server/auth/session-auth'
import { ensureRuntimeSupervisorBoot } from '#/server/rooms/runtime-supervisor-bootstrap'
import { createRoomSessionEventStream } from '#/server/rooms/execution-engine'

async function requireApiSession(request: Request) {
    const cookies = parse(request.headers.get('cookie') ?? '')
    const token = cookies[sessionCookieName]?.trim()
    if (!token) {
        return false
    }

    return (await validateSessionToken(token)) !== null
}

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
                const stream = createRoomSessionEventStream({
                    roomId: params.roomId,
                    sessionKey: params.sessionKey,
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
