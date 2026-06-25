import type { AgentRoomHostedEnv } from './bindings'
import {
    applyUsageMarkupMicros,
    centsFromMicrosCeil,
    hostedBraveSearchCostMicros,
    hostedProviderBillingGateCents,
    type HostedBillingReservationProvider,
} from './hosted-billing-types'
import {
    authorizeHostedBillingReservation,
    ensureHostedBillingAccount,
    HostedBillingReservationAlreadyExistsError,
    findHostedBillingReservationByIdempotencyKey,
    readHostedProviderUsageSettlementByIdempotencyKey,
    releaseHostedBillingReservation,
} from './hosted-billing-repository'
import { resolveHostedConfig } from './hosted-config'
import { objectRecord, nullableObjectRecord } from './hosted-json'
import {
    openRouterCostMicrosFromProviderText,
    parseHostedBraveProxyPath,
    parseHostedOpenRouterProxyPath,
    type HostedBraveProxyPath,
    type HostedOpenRouterProxyPath,
} from './hosted-provider-proxy'
import {
    boundedHeaderToken,
    requireHostedRuntimeProviderProxy,
    runtimeUsageContext,
    type HostedRuntimeUsageContext,
} from './hosted-runtime-worker-auth'
import { recordHostedProviderUsage, recordHostedProviderUsageBlocked } from './hosted-usage-billing'
import { hostedJsonResponse } from './hosted-worker-response'

interface HostedOpenRouterProviderRequest {
    body: BodyInit | null
    model: string | null
}

type HostedProviderProxyPath = HostedOpenRouterProxyPath | HostedBraveProxyPath

interface HostedProviderProxyUsageRequest {
    usageRequestId: string
    usageContext: HostedRuntimeUsageContext
}

async function hostedOpenRouterProviderRequestBody(
    request: Request,
): Promise<HostedOpenRouterProviderRequest> {
    const contentType = request.headers.get('content-type')?.toLowerCase() ?? ''
    if (!contentType.includes('application/json')) {
        return {
            body: request.body,
            model: null,
        }
    }
    const rawBody = await request.text()
    let parsed: unknown
    try {
        parsed = JSON.parse(rawBody) as unknown
    } catch {
        return {
            body: rawBody,
            model: null,
        }
    }
    const payload = nullableObjectRecord(parsed)
    if (!payload) {
        return {
            body: rawBody,
            model: null,
        }
    }
    return {
        body: JSON.stringify({
            ...payload,
            usage: {
                ...objectRecord(payload.usage),
                include: true,
            },
        }),
        model: typeof payload.model === 'string' ? payload.model : null,
    }
}

async function releaseHostedProviderPreflightReservation(input: {
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

async function hostedProviderProxyUsageRequest(input: {
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

async function releaseHostedProviderSettlementFailureReservation(input: {
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

async function repairExistingProviderUsageSettlement(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    provider: HostedBillingReservationProvider
    model: string
    billedBy: 'hosted_openrouter_proxy' | 'hosted_brave_proxy'
    usageIdempotencyKey: string
    reservationIdempotencyKey: string
    usageRequestId: string
    targetPath: string
}): Promise<boolean> {
    const [usage, reservation] = await Promise.all([
        readHostedProviderUsageSettlementByIdempotencyKey({
            env: input.env,
            workspaceId: input.workspaceId,
            idempotencyKey: input.usageIdempotencyKey,
        }),
        findHostedBillingReservationByIdempotencyKey({
            env: input.env,
            workspaceId: input.workspaceId,
            idempotencyKey: input.reservationIdempotencyKey,
        }),
    ])
    if (
        !usage ||
        usage.provider !== input.provider ||
        usage.roomId !== input.roomId ||
        usage.costMicros === null
    ) {
        return false
    }
    const settlementReservation =
        reservation &&
        reservation.status === 'authorized' &&
        reservation.provider === input.provider &&
        reservation.roomId === input.roomId
            ? reservation
            : null
    try {
        await recordHostedProviderUsage({
            env: input.env,
            workspaceId: input.workspaceId,
            roomId: usage.roomId,
            sessionKey: usage.sessionKey,
            runId: usage.runId,
            jobId: usage.jobId,
            provider: input.provider,
            model: usage.model ?? input.model,
            inputTokens: null,
            outputTokens: null,
            cachedTokens: null,
            estimatedCostUsd: usage.costMicros / 1_000_000,
            costMicros: usage.costMicros,
            billingReservationId: settlementReservation?.id ?? null,
            metadata: {
                billedBy: input.billedBy,
                providerProxyBillingAuthority: 'worker_proxy',
                reservationId: settlementReservation?.id ?? null,
                usageRequestId: input.usageRequestId,
                targetPath: input.targetPath,
                settlementRepair: true,
            },
            idempotencyKey: input.usageIdempotencyKey,
        })
    } catch (error) {
        if (settlementReservation) {
            await releaseHostedProviderSettlementFailureReservation({
                env: input.env,
                workspaceId: input.workspaceId,
                reservationId: settlementReservation.id,
            })
        }
        throw error
    }
    return true
}

function hostedProviderResponseHeaders(response: Response): Headers {
    const headers = new Headers(response.headers)
    headers.delete('content-encoding')
    headers.delete('content-length')
    headers.delete('set-cookie')
    headers.set('cache-control', 'no-store')
    return headers
}

function hostedBraveSearchReservationCents(input: { usageMarkupBps: number }): number {
    return centsFromMicrosCeil(
        applyUsageMarkupMicros(hostedBraveSearchCostMicros, input.usageMarkupBps),
    )
}

export async function hostedOpenRouterProxy(
    env: AgentRoomHostedEnv,
    request: Request,
    url: URL,
): Promise<Response> {
    const proxyPath = parseHostedOpenRouterProxyPath(url.pathname)
    if (request.method !== 'POST' || !proxyPath) {
        return hostedJsonResponse(
            {
                ok: false,
                code: 'runtime_provider_proxy_path_not_allowed',
            },
            {
                status: 403,
            },
        )
    }
    const config = resolveHostedConfig(env)
    const apiKey = config.managedProviders.openRouterApiKey
    if (!apiKey) {
        return hostedJsonResponse(
            {
                ok: false,
                code: 'managed_provider_unconfigured',
            },
            {
                status: 503,
            },
        )
    }
    const runtime = await requireHostedRuntimeProviderProxy({
        env,
        request,
        workspaceId: proxyPath.workspaceId,
        roomId: proxyPath.roomId,
        providerCandidate: 'hosted_openrouter',
    })
    if (runtime instanceof Response) {
        return runtime
    }
    const usageRequest = await hostedProviderProxyUsageRequest({
        env,
        request,
        proxyPath,
    })
    if (usageRequest instanceof Response) {
        return usageRequest
    }
    const { usageRequestId, usageContext } = usageRequest
    const usageIdempotencyKey = `provider_proxy:openrouter:${proxyPath.workspaceId}:${proxyPath.roomId}:${usageRequestId}`
    const reservationIdempotencyKey = `openrouter:${proxyPath.workspaceId}:${proxyPath.roomId}:${usageRequestId}`
    const existingUsage = await readHostedProviderUsageSettlementByIdempotencyKey({
        env,
        workspaceId: proxyPath.workspaceId,
        idempotencyKey: usageIdempotencyKey,
    })
    if (existingUsage) {
        try {
            await repairExistingProviderUsageSettlement({
                env,
                workspaceId: proxyPath.workspaceId,
                roomId: proxyPath.roomId,
                provider: 'openrouter',
                model: 'openrouter',
                billedBy: 'hosted_openrouter_proxy',
                usageIdempotencyKey,
                reservationIdempotencyKey,
                usageRequestId,
                targetPath: proxyPath.targetPath,
            })
        } catch {
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
        return hostedJsonResponse(
            {
                ok: false,
                code: 'runtime_usage_request_already_recorded',
            },
            {
                status: 409,
            },
        )
    }
    const providerRequest = await hostedOpenRouterProviderRequestBody(request)
    let reservationId: string | null = null
    try {
        await ensureHostedBillingAccount({
            env,
            workspaceId: proxyPath.workspaceId,
        })
        const reservation = await authorizeHostedBillingReservation({
            env,
            workspaceId: proxyPath.workspaceId,
            roomId: proxyPath.roomId,
            sessionKey: usageContext.sessionKey,
            runId: usageContext.runId,
            jobId: usageContext.jobId,
            provider: 'openrouter',
            amountCents: hostedProviderBillingGateCents,
            idempotencyKey: reservationIdempotencyKey,
            metadata: {
                targetPath: proxyPath.targetPath,
                usageRequestId,
                sessionKey: usageContext.sessionKey,
                runId: usageContext.runId,
                jobId: usageContext.jobId,
                reservationPurpose: 'provider_preflight',
            },
            expiresAt: new Date(Date.now() + 15 * 60 * 1000),
            allowExisting: false,
        })
        reservationId = reservation.id
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

    const headers = new Headers()
    const contentType = request.headers.get('content-type')
    const accept = request.headers.get('accept')
    if (contentType) {
        headers.set('content-type', contentType)
    }
    if (accept) {
        headers.set('accept', accept)
    }
    headers.set('authorization', `Bearer ${apiKey}`)
    headers.set('http-referer', config.publicOrigin)
    headers.set('x-title', 'Agent Room Hosted')

    const providerUrl = new URL(`https://openrouter.ai/api/v1${proxyPath.targetPath}`)
    providerUrl.search = url.search
    let response: Response
    try {
        response = await fetch(providerUrl, {
            method: 'POST',
            headers,
            body: providerRequest.body,
        })
    } catch (error) {
        await releaseHostedProviderPreflightReservation({
            env,
            workspaceId: proxyPath.workspaceId,
            reservationId,
        })
        throw error
    }
    const responseHeaders = hostedProviderResponseHeaders(response)
    if (!response.ok) {
        const responseText = await response.text()
        await releaseHostedProviderPreflightReservation({
            env,
            workspaceId: proxyPath.workspaceId,
            reservationId,
        })
        return new Response(responseText, {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
        })
    }
    const responseText = await response.text()
    const costMicros = openRouterCostMicrosFromProviderText(responseText)
    if (costMicros === null) {
        await recordHostedProviderUsageBlocked({
            env,
            workspaceId: proxyPath.workspaceId,
            roomId: proxyPath.roomId,
            sessionKey: usageContext.sessionKey,
            runId: usageContext.runId,
            jobId: usageContext.jobId,
            provider: 'openrouter',
            model: providerRequest.model,
            metadata: {
                billedBy: 'hosted_openrouter_proxy',
                providerProxyBillingAuthority: 'worker_proxy',
                missingProviderActualCost: true,
                reservationId,
                usageRequestId,
                sessionKey: usageContext.sessionKey,
                runId: usageContext.runId,
                jobId: usageContext.jobId,
                targetPath: proxyPath.targetPath,
                status: response.status,
            },
            idempotencyKey: usageIdempotencyKey,
        })
        await releaseHostedProviderPreflightReservation({
            env,
            workspaceId: proxyPath.workspaceId,
            reservationId,
        })
        return hostedJsonResponse(
            {
                ok: false,
                code: 'provider_actual_cost_missing',
            },
            {
                status: 502,
            },
        )
    }
    try {
        await recordHostedProviderUsage({
            env,
            workspaceId: proxyPath.workspaceId,
            roomId: proxyPath.roomId,
            sessionKey: usageContext.sessionKey,
            runId: usageContext.runId,
            jobId: usageContext.jobId,
            provider: 'openrouter',
            model: providerRequest.model,
            inputTokens: null,
            outputTokens: null,
            cachedTokens: null,
            estimatedCostUsd: costMicros / 1_000_000,
            costMicros,
            billingReservationId: reservationId,
            metadata: {
                billedBy: 'hosted_openrouter_proxy',
                providerProxyBillingAuthority: 'worker_proxy',
                reservationId,
                usageRequestId,
                sessionKey: usageContext.sessionKey,
                runId: usageContext.runId,
                jobId: usageContext.jobId,
                targetPath: proxyPath.targetPath,
            },
            idempotencyKey: usageIdempotencyKey,
        })
    } catch {
        await releaseHostedProviderSettlementFailureReservation({
            env,
            workspaceId: proxyPath.workspaceId,
            reservationId,
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
    if (reservationId) {
        responseHeaders.set('x-agent-room-billing-reservation-id', reservationId)
    }
    return new Response(responseText, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
    })
}

export async function hostedBraveProxy(
    env: AgentRoomHostedEnv,
    request: Request,
    url: URL,
): Promise<Response> {
    const proxyPath = parseHostedBraveProxyPath(url.pathname)
    if (request.method !== 'GET' || !proxyPath) {
        return hostedJsonResponse(
            {
                ok: false,
                code: 'runtime_provider_proxy_path_not_allowed',
            },
            {
                status: 403,
            },
        )
    }
    const config = resolveHostedConfig(env)
    const apiKey = config.managedProviders.braveApiKey
    if (!apiKey) {
        return hostedJsonResponse(
            {
                ok: false,
                code: 'managed_provider_unconfigured',
            },
            {
                status: 503,
            },
        )
    }
    const runtime = await requireHostedRuntimeProviderProxy({
        env,
        request,
        workspaceId: proxyPath.workspaceId,
        roomId: proxyPath.roomId,
        tokenHeaderName: 'x-subscription-token',
    })
    if (runtime instanceof Response) {
        return runtime
    }
    const usageRequest = await hostedProviderProxyUsageRequest({
        env,
        request,
        proxyPath,
    })
    if (usageRequest instanceof Response) {
        return usageRequest
    }
    const { usageRequestId, usageContext } = usageRequest
    const usageIdempotencyKey = `provider_proxy:brave:${proxyPath.workspaceId}:${proxyPath.roomId}:${usageRequestId}`
    const reservationIdempotencyKey = `brave:${proxyPath.workspaceId}:${proxyPath.roomId}:${usageRequestId}`
    const existingUsage = await readHostedProviderUsageSettlementByIdempotencyKey({
        env,
        workspaceId: proxyPath.workspaceId,
        idempotencyKey: usageIdempotencyKey,
    })
    if (existingUsage) {
        try {
            await repairExistingProviderUsageSettlement({
                env,
                workspaceId: proxyPath.workspaceId,
                roomId: proxyPath.roomId,
                provider: 'brave',
                model: 'brave-search',
                billedBy: 'hosted_brave_proxy',
                usageIdempotencyKey,
                reservationIdempotencyKey,
                usageRequestId,
                targetPath: proxyPath.targetPath,
            })
        } catch {
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
        return hostedJsonResponse(
            {
                ok: false,
                code: 'runtime_usage_request_already_recorded',
            },
            {
                status: 409,
            },
        )
    }

    let reservationId: string | null = null
    try {
        await ensureHostedBillingAccount({
            env,
            workspaceId: proxyPath.workspaceId,
        })
        const reservation = await authorizeHostedBillingReservation({
            env,
            workspaceId: proxyPath.workspaceId,
            roomId: proxyPath.roomId,
            sessionKey: usageContext.sessionKey,
            runId: usageContext.runId,
            jobId: usageContext.jobId,
            provider: 'brave',
            amountCents: hostedBraveSearchReservationCents({
                usageMarkupBps: config.billing.usageMarkupBps,
            }),
            idempotencyKey: reservationIdempotencyKey,
            metadata: {
                targetPath: proxyPath.targetPath,
                usageRequestId,
                sessionKey: usageContext.sessionKey,
                runId: usageContext.runId,
                jobId: usageContext.jobId,
                reservationPurpose: 'provider_preflight',
            },
            expiresAt: new Date(Date.now() + 15 * 60 * 1000),
            allowExisting: false,
        })
        reservationId = reservation.id
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

    const headers = new Headers()
    const accept = request.headers.get('accept')
    if (accept) {
        headers.set('accept', accept)
    }
    headers.set('x-subscription-token', apiKey)

    const providerUrl = new URL(`https://api.search.brave.com${proxyPath.targetPath}`)
    providerUrl.search = url.search
    let response: Response
    try {
        response = await fetch(providerUrl, {
            method: 'GET',
            headers,
        })
    } catch (error) {
        await releaseHostedProviderPreflightReservation({
            env,
            workspaceId: proxyPath.workspaceId,
            reservationId,
        })
        throw error
    }
    const responseHeaders = hostedProviderResponseHeaders(response)
    const responseText = await response.text()
    if (!response.ok) {
        await releaseHostedProviderPreflightReservation({
            env,
            workspaceId: proxyPath.workspaceId,
            reservationId,
        })
        return new Response(responseText, {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
        })
    }
    try {
        await recordHostedProviderUsage({
            env,
            workspaceId: proxyPath.workspaceId,
            roomId: proxyPath.roomId,
            sessionKey: usageContext.sessionKey,
            runId: usageContext.runId,
            jobId: usageContext.jobId,
            provider: 'brave',
            model: 'brave-search',
            inputTokens: null,
            outputTokens: null,
            cachedTokens: null,
            estimatedCostUsd: hostedBraveSearchCostMicros / 1_000_000,
            costMicros: hostedBraveSearchCostMicros,
            billingReservationId: reservationId,
            metadata: {
                billedBy: 'hosted_brave_proxy',
                providerProxyBillingAuthority: 'worker_proxy',
                reservationId,
                usageRequestId,
                sessionKey: usageContext.sessionKey,
                runId: usageContext.runId,
                jobId: usageContext.jobId,
                targetPath: proxyPath.targetPath,
            },
            idempotencyKey: usageIdempotencyKey,
        })
    } catch {
        await releaseHostedProviderSettlementFailureReservation({
            env,
            workspaceId: proxyPath.workspaceId,
            reservationId,
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
    if (reservationId) {
        responseHeaders.set('x-agent-room-billing-reservation-id', reservationId)
    }
    return new Response(responseText, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
    })
}
