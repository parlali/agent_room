import type { AgentRoomHostedEnv } from './bindings'
import { readHostedRuntimeToken } from './hosted-runtime-client'
import { getHostedRuntimeEndpointState } from './hosted-room-service'
import { hostedJsonResponse } from './hosted-worker-response'
import type { HostedRuntimeUsageContext } from './hosted-runtime-usage-context'
import { timingSafeEqualString } from '../security/timing-safe'
import { hostedRuntimeTokenSha256Hex } from './hosted-runtime-token-hash'
import { enqueueHostedRuntimeReconcile } from './hosted-runtime-jobs'

type HostedRuntimeEndpointState = NonNullable<
    Awaited<ReturnType<typeof getHostedRuntimeEndpointState>>
>

const staleRuntimeTokenHealCooldownMs = 5 * 60 * 1000
const staleRuntimeTokenLastError = 'Room access was refreshed. The room is restarting.'

function bearerToken(request: Request): string | null {
    const authorization = request.headers.get('authorization') ?? ''
    const prefix = 'Bearer '
    return authorization.startsWith(prefix) ? authorization.slice(prefix.length).trim() : null
}

function runtimeAuthToken(input: { request: Request; tokenHeaderName?: string }): string | null {
    if (input.tokenHeaderName) {
        return input.request.headers.get(input.tokenHeaderName)?.trim() || null
    }
    return bearerToken(input.request)
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

function runtimeTokenInvalidResponse(): Response {
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

function runtimeTokenStaleResponse(): Response {
    return hostedJsonResponse(
        {
            ok: false,
            code: 'runtime_token_stale',
        },
        {
            status: 403,
        },
    )
}

async function presentedTokenMatchesPreviousGeneration(input: {
    token: string
    previousTokenHash: string | null
}): Promise<boolean> {
    if (!input.previousTokenHash) {
        return false
    }
    const presentedHash = await hostedRuntimeTokenSha256Hex(input.token)
    return timingSafeEqualString(presentedHash, input.previousTokenHash)
}

async function claimHostedRuntimeStaleTokenHeal(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
}): Promise<boolean> {
    const now = new Date()
    const cutoff = new Date(now.getTime() - staleRuntimeTokenHealCooldownMs).toISOString()
    const nowIso = now.toISOString()
    const result = await input.env.AGENT_ROOM_DB.prepare(
        `
            UPDATE hosted_room_runtime_state
            SET stale_token_heal_enqueued_at = ?1,
                last_error = ?2,
                updated_at = ?1
            WHERE workspace_id = ?3
              AND room_id = ?4
              AND (
                  stale_token_heal_enqueued_at IS NULL
                  OR stale_token_heal_enqueued_at < ?5
              )
        `,
    )
        .bind(nowIso, staleRuntimeTokenLastError, input.workspaceId, input.roomId, cutoff)
        .run()
    return (result.meta.changes ?? 0) > 0
}

async function clearHostedRuntimeStaleTokenHealClaim(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
}): Promise<void> {
    await input.env.AGENT_ROOM_DB.prepare(
        `
            UPDATE hosted_room_runtime_state
            SET stale_token_heal_enqueued_at = NULL,
                last_error = CASE
                    WHEN last_error = ?1 THEN NULL
                    ELSE last_error
                END,
                updated_at = ?2
            WHERE workspace_id = ?3
              AND room_id = ?4
        `,
    )
        .bind(staleRuntimeTokenLastError, new Date().toISOString(), input.workspaceId, input.roomId)
        .run()
}

async function enqueueHostedRuntimeStaleTokenHeal(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    tokenVersion: number
}): Promise<void> {
    let claimed = false
    try {
        claimed = await claimHostedRuntimeStaleTokenHeal(input)
    } catch (error) {
        console.error('Hosted runtime stale-token heal claim failed', {
            workspaceId: input.workspaceId,
            roomId: input.roomId,
            error: error instanceof Error ? error.message : error,
        })
        return
    }
    if (!claimed) {
        console.warn('Hosted runtime stale-token heal was already enqueued recently', {
            workspaceId: input.workspaceId,
            roomId: input.roomId,
            tokenVersion: input.tokenVersion,
        })
        return
    }
    console.error('Hosted runtime presented a stale runtime token; queueing rotate/recreate heal', {
        workspaceId: input.workspaceId,
        roomId: input.roomId,
        tokenVersion: input.tokenVersion,
    })
    try {
        await enqueueHostedRuntimeReconcile({
            env: input.env,
            workspaceId: input.workspaceId,
            roomId: input.roomId,
            actorUserId: null,
            rotateToken: true,
        })
    } catch (error) {
        console.error('Hosted runtime stale-token heal enqueue failed', {
            workspaceId: input.workspaceId,
            roomId: input.roomId,
            error: error instanceof Error ? error.message : error,
        })
        try {
            await clearHostedRuntimeStaleTokenHealClaim(input)
        } catch (rollbackError) {
            console.error('Hosted runtime stale-token heal claim rollback failed', {
                workspaceId: input.workspaceId,
                roomId: input.roomId,
                error: rollbackError instanceof Error ? rollbackError.message : rollbackError,
            })
        }
    }
}

async function authorizeHostedRuntimeToken(input: {
    env: AgentRoomHostedEnv
    runtime: HostedRuntimeEndpointState
    token: string | null
}): Promise<Response | null> {
    const workspaceId = input.runtime.runtime.workspaceId
    const roomId = input.runtime.runtime.roomId
    if (!input.runtime.runtime.tokenObjectKey) {
        return runtimeTokenInvalidResponse()
    }
    let expectedToken: string
    try {
        expectedToken = await readHostedRuntimeToken({
            env: input.env,
            tokenObjectKey: input.runtime.runtime.tokenObjectKey,
        })
    } catch (error) {
        console.error('Hosted runtime callback token object unreadable; denying callback', {
            workspaceId,
            roomId,
            tokenObjectKey: input.runtime.runtime.tokenObjectKey,
            error: error instanceof Error ? error.message : error,
        })
        return hostedJsonResponse(
            {
                ok: false,
                code: 'runtime_token_unreadable',
            },
            {
                status: 403,
            },
        )
    }
    if (!input.token) {
        return runtimeTokenInvalidResponse()
    }
    if (timingSafeEqualString(input.token, expectedToken)) {
        return null
    }
    if (
        await presentedTokenMatchesPreviousGeneration({
            token: input.token,
            previousTokenHash: input.runtime.runtime.previousTokenHash,
        })
    ) {
        await enqueueHostedRuntimeStaleTokenHeal({
            env: input.env,
            workspaceId,
            roomId,
            tokenVersion: input.runtime.runtime.tokenVersion,
        })
        return runtimeTokenStaleResponse()
    }
    return runtimeTokenInvalidResponse()
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
    const token = bearerToken(input.request)
    const authResponse = await authorizeHostedRuntimeToken({
        env: input.env,
        runtime,
        token,
    })
    if (authResponse) {
        return authResponse
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
    tokenHeaderName?: string
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
    const token = runtimeAuthToken({
        request: input.request,
        tokenHeaderName: input.tokenHeaderName,
    })
    const authResponse = await authorizeHostedRuntimeToken({
        env: input.env,
        runtime,
        token,
    })
    if (authResponse) {
        return authResponse
    }
    return runtime
}
