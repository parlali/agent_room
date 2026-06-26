import { hostedPlanAllowsManagedBrowserbase } from '@agent-room/billing'
import type { AgentRoomHostedEnv } from './bindings'
import {
    hostedBrowserbaseSearchCostMicros,
    hostedBrowserbaseSessionCostMicros,
    hostedFetchUrlCostMicros,
    isHostedBillingPlanStatusActive,
} from './hosted-billing-types'
import {
    ensureHostedBillingAccount,
    markHostedBrowserbaseSessionReleased,
    readHostedBrowserbaseSession,
    recordHostedBrowserbaseSession,
    requestHostedBrowserbaseSessionRelease,
    readHostedProviderUsageSettlementByIdempotencyKey,
} from './hosted-billing-repository'
import {
    browserbaseProviderRequest,
    browserbaseSessionIdFromProviderResponse,
    type BrowserbaseProviderRequest,
} from './hosted-browserbase-proxy-request'
import { resolveHostedConfig } from './hosted-config'
import { nullableObjectRecord } from './hosted-json'
import {
    parseHostedBrowserbaseProxyPath,
    parseHostedManagedFetchPath,
    type HostedBrowserbaseProxyPath,
} from './hosted-provider-proxy'
import {
    authorizeFixedProviderReservation,
    hostedFixedCostReservationCents,
    hostedProviderProxyUsageRequest,
    hostedProviderResponseHeaders,
    recordFixedProviderUsage,
    releaseHostedProviderPreflightReservation,
    type HostedProviderProxyUsageRequest,
} from './hosted-provider-proxy-billing'
import { assertHostedRuntimeEgressDestination } from './hosted-runtime-egress-policy'
import { requireHostedRuntimeProviderProxy } from './hosted-runtime-worker-auth'
import { hostedJsonResponse } from './hosted-worker-response'
import { fetchPublicTextUrl } from '../web/web-fetch-core'

function browserbaseOperation(proxyPath: HostedBrowserbaseProxyPath): {
    model: string
    costMicros: number | null
    billable: boolean
} {
    if (proxyPath.targetPath === '/search') {
        return {
            model: 'browserbase-search',
            costMicros: hostedBrowserbaseSearchCostMicros,
            billable: true,
        }
    }
    if (proxyPath.targetPath === '/sessions') {
        return {
            model: 'browserbase-session',
            costMicros: hostedBrowserbaseSessionCostMicros,
            billable: true,
        }
    }
    return {
        model: 'browserbase-session',
        costMicros: null,
        billable: false,
    }
}

function browserbaseMethodAllowed(
    request: Request,
    proxyPath: HostedBrowserbaseProxyPath,
): boolean {
    if (proxyPath.targetPath === '/search' || proxyPath.targetPath === '/sessions') {
        return request.method === 'POST'
    }
    if (proxyPath.targetPath.endsWith('/debug')) {
        return request.method === 'GET'
    }
    return request.method === 'POST'
}

async function assertManagedBrowserbasePlan(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
}): Promise<Response | null> {
    const account = await ensureHostedBillingAccount({
        env: input.env,
        workspaceId: input.workspaceId,
    })
    if (
        !isHostedBillingPlanStatusActive(account.planStatus) ||
        !hostedPlanAllowsManagedBrowserbase(account.planKey)
    ) {
        return hostedJsonResponse(
            {
                ok: false,
                code: 'managed_browserbase_requires_pro',
            },
            {
                status: 403,
            },
        )
    }
    return null
}

function managedBrowserbaseSessionNotFound(): Response {
    return hostedJsonResponse(
        {
            ok: false,
            code: 'managed_browserbase_session_not_found',
        },
        {
            status: 404,
        },
    )
}

async function assertHostedBrowserbaseSessionAccess(input: {
    env: AgentRoomHostedEnv
    proxyPath: HostedBrowserbaseProxyPath
    providerRequest: BrowserbaseProviderRequest
}): Promise<Response | null> {
    if (!input.providerRequest.sessionId) {
        return null
    }
    const session = await readHostedBrowserbaseSession({
        env: input.env,
        workspaceId: input.proxyPath.workspaceId,
        roomId: input.proxyPath.roomId,
        browserbaseSessionId: input.providerRequest.sessionId,
    })
    if (!session) {
        return managedBrowserbaseSessionNotFound()
    }
    if (input.providerRequest.action === 'debug_session' && session.status !== 'active') {
        return managedBrowserbaseSessionNotFound()
    }
    if (
        input.providerRequest.action === 'release_session' &&
        session.status !== 'active' &&
        session.status !== 'release_requested'
    ) {
        return managedBrowserbaseSessionNotFound()
    }
    return null
}

async function releaseUntrackedBrowserbaseSession(input: {
    apiKey: string
    browserbaseSessionId: string
}): Promise<void> {
    const headers = new Headers()
    headers.set('content-type', 'application/json')
    headers.set('user-agent', 'AgentRoom/1.0')
    headers.set('x-bb-api-key', input.apiKey)
    const response = await fetch(
        new URL(
            `https://api.browserbase.com/v1/sessions/${encodeURIComponent(input.browserbaseSessionId)}`,
        ),
        {
            method: 'POST',
            headers,
            body: JSON.stringify({
                status: 'REQUEST_RELEASE',
            }),
        },
    )
    if (!response.ok) {
        throw new Error(`Browserbase cleanup release failed with status ${response.status}`)
    }
}

export async function hostedBrowserbaseProxy(
    env: AgentRoomHostedEnv,
    request: Request,
    url: URL,
): Promise<Response> {
    const proxyPath = parseHostedBrowserbaseProxyPath(url.pathname)
    if (!proxyPath || !browserbaseMethodAllowed(request, proxyPath)) {
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
    const apiKey = config.managedProviders.browserbaseApiKey
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
        tokenHeaderName: 'x-bb-api-key',
    })
    if (runtime instanceof Response) {
        return runtime
    }
    const planError = await assertManagedBrowserbasePlan({
        env,
        workspaceId: proxyPath.workspaceId,
    })
    if (planError) {
        return planError
    }
    const providerRequest = await browserbaseProviderRequest({
        request,
        url,
        proxyPath,
    })
    if (providerRequest instanceof Response) {
        return providerRequest
    }
    const sessionAccessError = await assertHostedBrowserbaseSessionAccess({
        env,
        proxyPath,
        providerRequest,
    })
    if (sessionAccessError) {
        return sessionAccessError
    }
    if (providerRequest.action === 'release_session' && providerRequest.sessionId) {
        const releaseRequested = await requestHostedBrowserbaseSessionRelease({
            env,
            workspaceId: proxyPath.workspaceId,
            roomId: proxyPath.roomId,
            browserbaseSessionId: providerRequest.sessionId,
        })
        if (!releaseRequested) {
            return managedBrowserbaseSessionNotFound()
        }
    }

    const operation = browserbaseOperation(proxyPath)
    let usageRequest: HostedProviderProxyUsageRequest | null = null
    let usageIdempotencyKey: string | null = null
    let reservationId: string | null = null
    if (operation.billable && operation.costMicros !== null) {
        const usageRequestResult = await hostedProviderProxyUsageRequest({
            env,
            request,
            proxyPath,
        })
        if (usageRequestResult instanceof Response) {
            return usageRequestResult
        }
        usageRequest = usageRequestResult
        usageIdempotencyKey = `provider_proxy:browserbase:${proxyPath.workspaceId}:${proxyPath.roomId}:${usageRequest.usageRequestId}`
        const existingUsage = await readHostedProviderUsageSettlementByIdempotencyKey({
            env,
            workspaceId: proxyPath.workspaceId,
            idempotencyKey: usageIdempotencyKey,
        })
        if (existingUsage) {
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
        const reservation = await authorizeFixedProviderReservation({
            env,
            workspaceId: proxyPath.workspaceId,
            roomId: proxyPath.roomId,
            usageContext: usageRequest.usageContext,
            provider: 'browserbase',
            amountCents: hostedFixedCostReservationCents({
                costMicros: operation.costMicros,
                usageMarkupBps: config.billing.usageMarkupBps,
            }),
            idempotencyKey: `browserbase:${proxyPath.workspaceId}:${proxyPath.roomId}:${usageRequest.usageRequestId}`,
            targetPath: proxyPath.targetPath,
            usageRequestId: usageRequest.usageRequestId,
        })
        if (reservation instanceof Response) {
            return reservation
        }
        reservationId = reservation
    }

    const headers = new Headers()
    const accept = request.headers.get('accept')
    if (accept) {
        headers.set('accept', accept)
    }
    if (providerRequest.body !== null) {
        headers.set('content-type', 'application/json')
    }
    headers.set('user-agent', 'AgentRoom/1.0')
    headers.set('x-bb-api-key', apiKey)

    const providerUrl = new URL(`https://api.browserbase.com/v1${proxyPath.targetPath}`)
    let response: Response
    try {
        response = await fetch(providerUrl, {
            method: request.method,
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
    if (providerRequest.action === 'create_session' && usageRequest) {
        const browserbaseSessionId = browserbaseSessionIdFromProviderResponse(responseText)
        if (!browserbaseSessionId) {
            await releaseHostedProviderPreflightReservation({
                env,
                workspaceId: proxyPath.workspaceId,
                reservationId,
            })
            return hostedJsonResponse(
                {
                    ok: false,
                    code: 'managed_browserbase_session_response_invalid',
                },
                {
                    status: 502,
                },
            )
        }
        try {
            await recordHostedBrowserbaseSession({
                env,
                workspaceId: proxyPath.workspaceId,
                roomId: proxyPath.roomId,
                browserbaseSessionId,
                usageRequestId: usageRequest.usageRequestId,
                usageContext: usageRequest.usageContext,
            })
        } catch (error) {
            console.error('Hosted Browserbase session ownership record failed', {
                workspaceId: proxyPath.workspaceId,
                roomId: proxyPath.roomId,
                browserbaseSessionId,
                usageRequestId: usageRequest.usageRequestId,
                error,
            })
            await releaseHostedProviderPreflightReservation({
                env,
                workspaceId: proxyPath.workspaceId,
                reservationId,
            })
            try {
                await releaseUntrackedBrowserbaseSession({
                    apiKey,
                    browserbaseSessionId,
                })
            } catch (cleanupError) {
                console.error('Hosted Browserbase untracked session cleanup failed', {
                    workspaceId: proxyPath.workspaceId,
                    roomId: proxyPath.roomId,
                    browserbaseSessionId,
                    usageRequestId: usageRequest.usageRequestId,
                    error: cleanupError,
                })
            }
            return hostedJsonResponse(
                {
                    ok: false,
                    code: 'managed_browserbase_session_record_failed',
                },
                {
                    status: 502,
                },
            )
        }
    }
    if (providerRequest.action === 'release_session' && providerRequest.sessionId) {
        try {
            await markHostedBrowserbaseSessionReleased({
                env,
                workspaceId: proxyPath.workspaceId,
                roomId: proxyPath.roomId,
                browserbaseSessionId: providerRequest.sessionId,
            })
        } catch (error) {
            console.error('Hosted Browserbase session release record failed', {
                workspaceId: proxyPath.workspaceId,
                roomId: proxyPath.roomId,
                browserbaseSessionId: providerRequest.sessionId,
                error,
            })
            return hostedJsonResponse(
                {
                    ok: false,
                    code: 'managed_browserbase_session_release_failed',
                },
                {
                    status: 502,
                },
            )
        }
    }
    if (
        operation.billable &&
        operation.costMicros !== null &&
        usageRequest &&
        usageIdempotencyKey
    ) {
        const billingError = await recordFixedProviderUsage({
            env,
            workspaceId: proxyPath.workspaceId,
            roomId: proxyPath.roomId,
            usageContext: usageRequest.usageContext,
            provider: 'browserbase',
            model: operation.model,
            costMicros: operation.costMicros,
            reservationId,
            usageRequestId: usageRequest.usageRequestId,
            targetPath: proxyPath.targetPath,
            billedBy: 'hosted_browserbase_proxy',
            idempotencyKey: usageIdempotencyKey,
            metadata: {
                browserbaseOperation: proxyPath.targetPath,
            },
        })
        if (billingError) {
            return billingError
        }
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

function parseManagedFetchBody(value: unknown): { url: string; timeoutMs: number } | null {
    const record = nullableObjectRecord(value)
    if (!record || typeof record.url !== 'string') {
        return null
    }
    const timeoutMs =
        typeof record.timeoutMs === 'number' && Number.isFinite(record.timeoutMs)
            ? Math.max(1000, Math.min(15000, Math.trunc(record.timeoutMs)))
            : 15000
    return {
        url: record.url,
        timeoutMs,
    }
}

export async function hostedManagedFetchProxy(
    env: AgentRoomHostedEnv,
    request: Request,
    url: URL,
): Promise<Response> {
    const proxyPath = parseHostedManagedFetchPath(url.pathname)
    if (request.method !== 'POST' || !proxyPath) {
        return hostedJsonResponse(
            {
                ok: false,
                code: 'runtime_fetch_proxy_path_not_allowed',
            },
            {
                status: 403,
            },
        )
    }
    const runtime = await requireHostedRuntimeProviderProxy({
        env,
        request,
        workspaceId: proxyPath.workspaceId,
        roomId: proxyPath.roomId,
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
    let body: unknown
    try {
        body = await request.json()
    } catch {
        return hostedJsonResponse(
            {
                ok: false,
                code: 'runtime_fetch_request_invalid',
            },
            {
                status: 400,
            },
        )
    }
    const fetchInput = parseManagedFetchBody(body)
    if (!fetchInput) {
        return hostedJsonResponse(
            {
                ok: false,
                code: 'runtime_fetch_request_invalid',
            },
            {
                status: 400,
            },
        )
    }
    const config = resolveHostedConfig(env)
    const usageIdempotencyKey = `provider_proxy:fetch_url:${proxyPath.workspaceId}:${proxyPath.roomId}:${usageRequest.usageRequestId}`
    const existingUsage = await readHostedProviderUsageSettlementByIdempotencyKey({
        env,
        workspaceId: proxyPath.workspaceId,
        idempotencyKey: usageIdempotencyKey,
    })
    if (existingUsage) {
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
    await ensureHostedBillingAccount({
        env,
        workspaceId: proxyPath.workspaceId,
    })
    const reservation = await authorizeFixedProviderReservation({
        env,
        workspaceId: proxyPath.workspaceId,
        roomId: proxyPath.roomId,
        usageContext: usageRequest.usageContext,
        provider: 'fetch_url',
        amountCents: hostedFixedCostReservationCents({
            costMicros: hostedFetchUrlCostMicros,
            usageMarkupBps: config.billing.usageMarkupBps,
        }),
        idempotencyKey: `fetch_url:${proxyPath.workspaceId}:${proxyPath.roomId}:${usageRequest.usageRequestId}`,
        targetPath: null,
        usageRequestId: usageRequest.usageRequestId,
    })
    if (reservation instanceof Response) {
        return reservation
    }
    let result: Awaited<ReturnType<typeof fetchPublicTextUrl>>
    try {
        result = await fetchPublicTextUrl({
            url: fetchInput.url,
            timeoutMs: fetchInput.timeoutMs,
            assertSafeUrl: async (targetUrl) => {
                await assertHostedRuntimeEgressDestination({
                    value: targetUrl.toString(),
                    label: 'Managed fetch URL',
                })
            },
        })
    } catch (error) {
        await releaseHostedProviderPreflightReservation({
            env,
            workspaceId: proxyPath.workspaceId,
            reservationId: reservation,
        })
        return hostedJsonResponse(
            {
                ok: false,
                code: 'runtime_fetch_failed',
                message: error instanceof Error ? error.message : 'Managed URL fetch failed',
            },
            {
                status: 400,
            },
        )
    }
    const billingError = await recordFixedProviderUsage({
        env,
        workspaceId: proxyPath.workspaceId,
        roomId: proxyPath.roomId,
        usageContext: usageRequest.usageContext,
        provider: 'fetch_url',
        model: 'fetch_url',
        costMicros: hostedFetchUrlCostMicros,
        reservationId: reservation,
        usageRequestId: usageRequest.usageRequestId,
        targetPath: null,
        billedBy: 'hosted_fetch_url_proxy',
        idempotencyKey: usageIdempotencyKey,
        metadata: {
            finalStatus: result.status,
            contentType: result.contentType,
            byteLength: result.byteLength,
            truncated: result.truncated,
        },
    })
    if (billingError) {
        return billingError
    }
    return hostedJsonResponse(result, {
        headers: {
            'x-agent-room-billing-reservation-id': reservation,
        },
    })
}
