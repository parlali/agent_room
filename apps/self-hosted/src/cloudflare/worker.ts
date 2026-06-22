import { ContainerProxy } from '@cloudflare/containers'
import type { MessageBatch } from '@cloudflare/workers-types'
import type { AgentRoomHostedEnv, AgentRoomRuntimeJobMessage } from '#/server/cloudflare/bindings'
import { getHostedAuth } from '#/server/cloudflare/hosted-auth'
import { resolveHostedConfig } from '#/server/cloudflare/hosted-config'
import { reconcileHostedRuntimeJob } from '#/server/cloudflare/hosted-runtime-adapter'
import { AgentRoomRuntimeContainer } from '#/server/cloudflare/runtime-container'

export { AgentRoomRuntimeContainer }
export { ContainerProxy }

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

function hostedAppNotReady(): Response {
    return jsonResponse(
        {
            ok: false,
            code: 'hosted_app_not_ready',
            message:
                'Hosted Cloudflare app routes require the D1-backed hosted route and service layer before they can serve traffic',
        },
        {
            status: 503,
        },
    )
}

interface HostedWorkerHandler {
    fetch: (request: Request, env: AgentRoomHostedEnv) => Promise<Response> | Response
    queue: (
        batch: MessageBatch<AgentRoomRuntimeJobMessage>,
        env: AgentRoomHostedEnv,
    ) => Promise<void>
    scheduled: () => Promise<void>
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
        return hostedAppNotReady()
    },

    async queue(batch: MessageBatch<AgentRoomRuntimeJobMessage>, env: AgentRoomHostedEnv) {
        for (const message of batch.messages) {
            try {
                await reconcileHostedRuntimeJob(env, message.body)
                message.ack()
            } catch (error) {
                console.error(
                    'Hosted runtime reconcile failed',
                    error instanceof Error ? error.message : error,
                )
                message.retry()
            }
        }
    },

    async scheduled() {
        console.log('Hosted scheduled tick received')
    },
} satisfies HostedWorkerHandler
