import type { AgentRoomHostedEnv } from './bindings'
import {
    applyUsageMarkupMicros,
    centsFromMicrosCeil,
    type HostedBillingReservationProvider,
} from './hosted-billing-types'
import {
    authorizeHostedBillingReservation,
    HostedBillingReservationAlreadyExistsError,
    releaseHostedBillingReservation,
} from './hosted-billing-repository'
import {
    boundedHeaderToken,
    runtimeUsageContext,
    type HostedRuntimeUsageContext,
} from './hosted-runtime-worker-auth'
import { recordHostedProviderUsage } from './hosted-usage-billing'
import { hostedJsonResponse } from './hosted-worker-response'

export type HostedProviderProxyBillingAuthority =
    | 'hosted_openrouter_proxy'
    | 'hosted_brave_proxy'
    | 'hosted_browserbase_proxy'
    | 'hosted_fetch_url_proxy'

export interface HostedProviderProxyUsageRequest {
    usageRequestId: string
    usageContext: HostedRuntimeUsageContext
}

interface HostedProviderProxyPath {
    workspaceId: string
    roomId: string
}

export async function releaseHostedProviderPreflightReservation(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    reservationId: string | null
}): Promise<void> {
    if (!input.reservationId) {
        return
    }
    await releaseHostedBillingReservation({
        env: input.env,
        workspaceId: input.workspaceId,
        reservationId: input.reservationId,
    })
}

async function runtimeUsageContextReferences(
    env: AgentRoomHostedEnv,
    input: {
        workspaceId: string
        roomId: string
        context: HostedRuntimeUsageContext
    },
): Promise<Response | null> {
    if (!input.context.jobId) {
        return null
    }
    const job = await env.AGENT_ROOM_DB.prepare(
        `
            SELECT id
            FROM hosted_room_job
            WHERE workspace_id = ?1
              AND room_id = ?2
              AND id = ?3
            LIMIT 1
        `,
    )
        .bind(input.workspaceId, input.roomId, input.context.jobId)
        .first<{ id: string }>()
    if (job) {
        return null
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

export async function hostedProviderProxyUsageRequest(input: {
    env: AgentRoomHostedEnv
    request: Request
    proxyPath: HostedProviderProxyPath
}): Promise<HostedProviderProxyUsageRequest | Response> {
    const usageRequestId = boundedHeaderToken(
        input.request.headers.get('x-agent-room-usage-request-id'),
    )
    if (!usageRequestId) {
        return hostedJsonResponse(
            {
                ok: false,
                code: 'runtime_usage_request_id_required',
            },
            {
                status: 400,
            },
        )
    }
    const usageContext = runtimeUsageContext(input.request)
    if (usageContext instanceof Response) {
        return usageContext
    }
    const usageContextReferenceError = await runtimeUsageContextReferences(input.env, {
        workspaceId: input.proxyPath.workspaceId,
        roomId: input.proxyPath.roomId,
        context: usageContext,
    })
    if (usageContextReferenceError) {
        return usageContextReferenceError
    }
    return {
        usageRequestId,
        usageContext,
    }
}

export async function releaseHostedProviderSettlementFailureReservation(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    reservationId: string | null
}): Promise<void> {
    try {
        await releaseHostedProviderPreflightReservation(input)
    } catch (error) {
        console.warn(
            'Hosted provider preflight reservation release failed after settlement error',
            {
                workspaceId: input.workspaceId,
                reservationId: input.reservationId,
                error,
            },
        )
    }
}

export function hostedProviderResponseHeaders(response: Response): Headers {
    const headers = new Headers(response.headers)
    headers.delete('content-encoding')
    headers.delete('content-length')
    headers.delete('set-cookie')
    headers.set('cache-control', 'no-store')
    return headers
}

export function hostedFixedCostReservationCents(input: {
    costMicros: number
    usageMarkupBps: number
}): number {
    return centsFromMicrosCeil(applyUsageMarkupMicros(input.costMicros, input.usageMarkupBps))
}

export async function authorizeFixedProviderReservation(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    usageContext: HostedRuntimeUsageContext
    provider: HostedBillingReservationProvider
    amountCents: number
    idempotencyKey: string
    targetPath: string | null
    usageRequestId: string
}): Promise<string | Response> {
    try {
        const reservation = await authorizeHostedBillingReservation({
            env: input.env,
            workspaceId: input.workspaceId,
            roomId: input.roomId,
            sessionKey: input.usageContext.sessionKey,
            runId: input.usageContext.runId,
            jobId: input.usageContext.jobId,
            provider: input.provider,
            amountCents: input.amountCents,
            idempotencyKey: input.idempotencyKey,
            metadata: {
                ...(input.targetPath ? { targetPath: input.targetPath } : {}),
                usageRequestId: input.usageRequestId,
                sessionKey: input.usageContext.sessionKey,
                runId: input.usageContext.runId,
                jobId: input.usageContext.jobId,
                reservationPurpose: 'provider_preflight',
            },
            expiresAt: new Date(Date.now() + 15 * 60 * 1000),
            allowExisting: false,
        })
        return reservation.id
    } catch (error) {
        if (error instanceof HostedBillingReservationAlreadyExistsError) {
            return hostedJsonResponse(
                {
                    ok: false,
                    code: 'runtime_usage_request_already_in_flight',
                },
                {
                    status: 409,
                },
            )
        }
        return hostedJsonResponse(
            {
                ok: false,
                code: 'hosted_billing_balance_exhausted',
                message:
                    error instanceof Error ? error.message : 'Hosted billing balance is exhausted',
            },
            {
                status: 402,
            },
        )
    }
}

export async function recordFixedProviderUsage(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    usageContext: HostedRuntimeUsageContext
    provider: HostedBillingReservationProvider
    model: string
    costMicros: number
    reservationId: string | null
    usageRequestId: string
    targetPath: string | null
    billedBy: HostedProviderProxyBillingAuthority
    idempotencyKey: string
    metadata?: Record<string, unknown>
}): Promise<Response | null> {
    try {
        await recordHostedProviderUsage({
            env: input.env,
            workspaceId: input.workspaceId,
            roomId: input.roomId,
            sessionKey: input.usageContext.sessionKey,
            runId: input.usageContext.runId,
            jobId: input.usageContext.jobId,
            provider: input.provider,
            model: input.model,
            inputTokens: null,
            outputTokens: null,
            cachedTokens: null,
            estimatedCostUsd: input.costMicros / 1_000_000,
            costMicros: input.costMicros,
            billingReservationId: input.reservationId,
            metadata: {
                billedBy: input.billedBy,
                providerProxyBillingAuthority: 'worker_proxy',
                reservationId: input.reservationId,
                usageRequestId: input.usageRequestId,
                sessionKey: input.usageContext.sessionKey,
                runId: input.usageContext.runId,
                jobId: input.usageContext.jobId,
                ...(input.targetPath ? { targetPath: input.targetPath } : {}),
                ...input.metadata,
            },
            idempotencyKey: input.idempotencyKey,
        })
        return null
    } catch {
        await releaseHostedProviderSettlementFailureReservation({
            env: input.env,
            workspaceId: input.workspaceId,
            reservationId: input.reservationId,
        })
        return hostedJsonResponse(
            {
                ok: false,
                code: 'provider_billing_settlement_failed',
            },
            {
                status: 502,
            },
        )
    }
}
