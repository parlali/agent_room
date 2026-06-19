import handler from '@tanstack/react-start/server-entry'
import type { AgentRoomHostedEnv } from '#/server/cloudflare/bindings'
import { getHostedAuth } from '#/server/cloudflare/hosted-auth'
import { resolveHostedConfig } from '#/server/cloudflare/hosted-config'
import { AgentRoomRuntimeContainer } from '#/server/cloudflare/runtime-container'

export { AgentRoomRuntimeContainer }

function assertBinding(value: unknown, name: keyof AgentRoomHostedEnv): void {
    if (!value) {
        throw new Error(`Missing Cloudflare binding ${name}`)
    }
}

function jsonResponse(payload: unknown, init?: ResponseInit): Response {
    const headers = new Headers(init?.headers)
    headers.set('content-type', 'application/json; charset=utf-8')
    headers.set('cache-control', 'no-store')
    return new Response(JSON.stringify(payload), {
        ...init,
        headers,
    })
}

function hostedHealth(env: AgentRoomHostedEnv): Response {
    const config = resolveHostedConfig(env)
    assertBinding(env.AGENT_ROOM_DB, 'AGENT_ROOM_DB')
    assertBinding(env.AGENT_ROOM_WORKSPACE_BUCKET, 'AGENT_ROOM_WORKSPACE_BUCKET')
    assertBinding(env.AGENT_ROOM_RUNTIME_JOBS, 'AGENT_ROOM_RUNTIME_JOBS')
    assertBinding(env.AGENT_ROOM_RUNTIME, 'AGENT_ROOM_RUNTIME')

    return jsonResponse({
        ok: true,
        authMode: config.authMode,
        runtimeBackend: config.runtimeBackend,
        runtimeStorage: config.runtimeStorage,
        publicOrigin: config.publicOrigin,
        bindings: {
            d1: true,
            r2: true,
            queue: true,
            runtimeContainer: true,
        },
    })
}

async function fetchApp(request: Request): Promise<Response> {
    return handler.fetch(request)
}

export default {
    async fetch(request: Request, env: AgentRoomHostedEnv) {
        const url = new URL(request.url)
        if (url.pathname === '/api/hosted/health') {
            return hostedHealth(env)
        }
        if (url.pathname.startsWith('/api/auth/')) {
            return getHostedAuth(env).handler(request)
        }
        return fetchApp(request)
    },

    async queue() {
        throw new Error(
            'Hosted runtime queue processing requires deployed D1 runtime materialization',
        )
    },

    async scheduled() {
        console.log('Hosted scheduled tick received')
    },
} satisfies ExportedHandler<AgentRoomHostedEnv>
