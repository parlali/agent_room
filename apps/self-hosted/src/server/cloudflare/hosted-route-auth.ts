import { getRequest, setResponseStatus } from '@tanstack/react-start/server'
import type { AgentRoomHostedEnv } from './bindings'
import { readHostedActorFromRequest, type HostedActor } from './hosted-auth'
import { resolveHostedConfig } from './hosted-config'
import { readHostedRequestContext, type HostedRequestContext } from './hosted-request-context'

export interface HostedRouteActor {
    context: HostedRequestContext
    actor: HostedActor
}

function sameOrigin(left: string, right: string): boolean {
    try {
        return new URL(left).origin === new URL(right).origin
    } catch {
        return false
    }
}

export function assertHostedSameOriginMutation(request: Request, env: AgentRoomHostedEnv): void {
    const method = request.method.toUpperCase()
    if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH' && method !== 'DELETE') {
        return
    }

    const source = request.headers.get('origin') ?? request.headers.get('referer')
    if (!source) {
        setResponseStatus(403, 'Forbidden')
        throw new Error('Mutation request missing origin metadata')
    }

    const publicOrigin = resolveHostedConfig(env).publicOrigin
    if (!sameOrigin(source, publicOrigin)) {
        setResponseStatus(403, 'Forbidden')
        throw new Error('Cross-origin mutation request blocked')
    }
}

export async function readHostedContextActor(
    context: HostedRequestContext,
): Promise<HostedActor | null> {
    if (context.actor !== undefined) {
        return context.actor
    }
    context.actor = await readHostedActorFromRequest(context.env, context.request)
    return context.actor
}

export async function requireHostedActor(): Promise<HostedRouteActor | null> {
    const context = readHostedRequestContext()
    if (!context) {
        return null
    }
    const actor = await readHostedContextActor(context)
    if (!actor) {
        setResponseStatus(401, 'Unauthorized')
        throw new Error('Authentication required')
    }
    return {
        context,
        actor,
    }
}

export async function requireHostedMutationActor(): Promise<HostedRouteActor | null> {
    const hosted = await requireHostedActor()
    if (!hosted) {
        return null
    }
    assertHostedSameOriginMutation(getRequest(), hosted.context.env)
    return hosted
}

export async function requireHostedRouteActor(input: {
    env: AgentRoomHostedEnv
    request: Request
}): Promise<HostedActor | Response> {
    const actor = await readHostedActorFromRequest(input.env, input.request)
    if (!actor) {
        return new Response('Authentication required', {
            status: 401,
            headers: {
                'cache-control': 'no-store',
            },
        })
    }
    return actor
}

export function hostedRouteSameOriginResponse(input: {
    env: AgentRoomHostedEnv
    request: Request
}): Response | null {
    try {
        assertHostedSameOriginMutation(input.request, input.env)
        return null
    } catch (error) {
        return new Response(error instanceof Error ? error.message : 'Forbidden', {
            status: 403,
            headers: {
                'cache-control': 'no-store',
            },
        })
    }
}
