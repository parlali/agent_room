import type { AgentRoomHostedEnv } from './bindings'
import { readHostedRuntimeToken } from './hosted-runtime-client'
import { getHostedRuntimeEndpointState } from './hosted-room-service'
import { hostedJsonResponse } from './hosted-worker-response'
import { timingSafeEqualString } from '../security/timing-safe'

type HostedRuntimeEndpointState = NonNullable<
    Awaited<ReturnType<typeof getHostedRuntimeEndpointState>>
>

export interface HostedRuntimeUsageContext {
    sessionKey: string
    runId: string | null
    jobId: string | null
}

function bearerToken(request: Request): string | null {
    const authorization = request.headers.get('authorization') ?? ''
    const prefix = 'Bearer '
    return authorization.startsWith(prefix) ? authorization.slice(prefix.length).trim() : null
}

export function boundedHeaderToken(value: string | null): string | null {
    const trimmed = value?.trim() ?? ''
    return /^[a-zA-Z0-9_-]{16,128}$/.test(trimmed) ? trimmed : null
}

function boundedRuntimeReference(value: string | null): string | null {
    const trimmed = value?.trim() ?? ''
    return /^[a-zA-Z0-9_.:-]{1,128}$/.test(trimmed) ? trimmed : null
}

function nullableRuntimeReference(request: Request, headerName: string): string | Response | null {
    const raw = request.headers.get(headerName)
    if (!raw?.trim()) {
        return null
    }
    const value = boundedRuntimeReference(raw)
    if (value) {
        return value
    }
    return hostedJsonResponse(
        {
            ok: false,
            code: 'runtime_usage_context_invalid',
        },
        {
            status: 400,
        },
    )
}

export function runtimeUsageContext(request: Request): HostedRuntimeUsageContext | Response {
    const sessionKey = boundedRuntimeReference(request.headers.get('x-agent-room-session-key'))
    if (!sessionKey) {
        return hostedJsonResponse(
            {
                ok: false,
                code: 'runtime_usage_context_required',
            },
            {
                status: 400,
            },
        )
    }
    const runId = nullableRuntimeReference(request, 'x-agent-room-run-id')
    if (runId instanceof Response) {
        return runId
    }
    const jobId = nullableRuntimeReference(request, 'x-agent-room-job-id')
    if (jobId instanceof Response) {
        return jobId
    }
    return {
        sessionKey,
        runId,
        jobId,
    }
}

export async function requireHostedRuntimeCallback(input: {
    env: AgentRoomHostedEnv
    request: Request
    record: Record<string, unknown>
}): Promise<
    | {
          workspaceId: string
          roomId: string
          runtime: HostedRuntimeEndpointState
      }
    | Response
> {
    const workspaceId = typeof input.record.workspaceId === 'string' ? input.record.workspaceId : ''
    const roomId = typeof input.record.roomId === 'string' ? input.record.roomId : ''
    if (!workspaceId || !roomId) {
        return hostedJsonResponse(
            {
                ok: false,
                code: 'invalid_runtime_callback',
                message: 'workspaceId and roomId are required',
            },
            {
                status: 400,
            },
        )
    }
    const runtime = await getHostedRuntimeEndpointState({
        env: input.env,
        workspaceId,
        roomId,
    })
    if (!runtime || runtime.desiredState !== 'running' || runtime.status === 'stopped') {
        return hostedJsonResponse(
            {
                ok: false,
                code: 'runtime_not_running',
            },
            {
                status: 409,
            },
        )
    }
    if (!runtime.runtime.tokenObjectKey) {
        return hostedJsonResponse(
            {
                ok: false,
                code: 'runtime_token_invalid',
            },
            {
                status: 403,
            },
        )
    }
    const token = bearerToken(input.request)
    const expectedToken = await readHostedRuntimeToken({
        env: input.env,
        tokenObjectKey: runtime.runtime.tokenObjectKey,
    })
    if (!token || !timingSafeEqualString(token, expectedToken)) {
        return hostedJsonResponse(
            {
                ok: false,
                code: 'runtime_token_invalid',
            },
            {
                status: 403,
            },
        )
    }
    return {
        workspaceId,
        roomId,
        runtime,
    }
}

export async function requireHostedRuntimeProviderProxy(input: {
    env: AgentRoomHostedEnv
    request: Request
    workspaceId: string
    roomId: string
    providerCandidate?: 'hosted_openrouter'
}): Promise<HostedRuntimeEndpointState | Response> {
    const runtime = await getHostedRuntimeEndpointState({
        env: input.env,
        workspaceId: input.workspaceId,
        roomId: input.roomId,
    })
    if (
        !runtime ||
        runtime.desiredState !== 'running' ||
        runtime.status === 'stopped' ||
        !runtime.runtime.tokenObjectKey
    ) {
        return hostedJsonResponse(
            {
                ok: false,
                code: 'runtime_provider_not_authorized',
            },
            {
                status: 403,
            },
        )
    }
    if (input.providerCandidate && runtime.runtime.providerCandidate !== input.providerCandidate) {
        return hostedJsonResponse(
            {
                ok: false,
                code: 'runtime_provider_not_authorized',
            },
            {
                status: 403,
            },
        )
    }
    const token = bearerToken(input.request)
    const expectedToken = await readHostedRuntimeToken({
        env: input.env,
        tokenObjectKey: runtime.runtime.tokenObjectKey,
    })
    if (!token || !timingSafeEqualString(token, expectedToken)) {
        return hostedJsonResponse(
            {
                ok: false,
                code: 'runtime_token_invalid',
            },
            {
                status: 403,
            },
        )
    }
    return runtime
}
