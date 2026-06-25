import type { AgentRoomHostedEnv } from './bindings'
import {
    hostedRuntimeFileCallback,
    hostedRuntimeStateCallback,
    hostedRuntimeUsageCallback,
    runtimeUsageIdempotencyKey,
} from './hosted-runtime-callback-routes'
import {
    hostedBraveProxyPathPrefix,
    hostedOpenRouterProxyPathPrefix,
} from './hosted-provider-proxy'
import { hostedBraveProxy, hostedOpenRouterProxy } from './hosted-provider-proxy-routes'

export { runtimeUsageIdempotencyKey }

export async function hostedRuntimeWorkerRoute(input: {
    env: AgentRoomHostedEnv
    request: Request
    url: URL
}): Promise<Response | null> {
    if (input.url.pathname === '/api/hosted/runtime/usage' && input.request.method === 'POST') {
        return hostedRuntimeUsageCallback(input.env, input.request)
    }
    if (input.url.pathname === '/api/hosted/runtime/file' && input.request.method === 'POST') {
        return hostedRuntimeFileCallback(input.env, input.request)
    }
    if (input.url.pathname === '/api/hosted/runtime/state' && input.request.method === 'POST') {
        return hostedRuntimeStateCallback(input.env, input.request)
    }
    if (
        input.url.pathname === hostedOpenRouterProxyPathPrefix ||
        input.url.pathname.startsWith(`${hostedOpenRouterProxyPathPrefix}/`)
    ) {
        return hostedOpenRouterProxy(input.env, input.request, input.url)
    }
    if (
        input.url.pathname === hostedBraveProxyPathPrefix ||
        input.url.pathname.startsWith(`${hostedBraveProxyPathPrefix}/`)
    ) {
        return hostedBraveProxy(input.env, input.request, input.url)
    }
    return null
}
