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
    readHostedBrowserbaseSessionByUsageRequestId,
    recordHostedBrowserbaseSession,
    requestHostedBrowserbaseSessionRelease,
    readHostedProviderUsageSettlementByIdempotencyKey,
} from './hosted-billing-repository'
import {
    browserbaseProviderRequest,
    browserbaseReleaseSessionRequestBody,
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

const browserbaseCleanupTimeoutMs = 10000

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

function browserbaseProviderHeaders(input: {
    apiKey: string
    accept: string | null
    hasBody: boolean
}): Headers {
    const headers = new Headers()
    if (input.accept) {
        headers.set('accept', input.accept)
    }
    if (input.hasBody) {
        headers.set('content-type', 'application/json')
    }
    headers.set('user-agent', 'AgentRoom/1.0')
    headers.set('x-bb-api-key', input.apiKey)
    return headers
}

async function fetchBrowserbaseProvider(input: {
    apiKey: string
    accept?: string | null
    targetPath: string
    method: string
    body: string | null
    timeoutMs?: number
}): Promise<Response> {
    const controller = input.timeoutMs ? new AbortController() : null
    const timeout = controller ? setTimeout(() => controller.abort(), input.timeoutMs) : null
    timeout?.unref?.()
    try {
        return await fetch(new URL(`https://api.browserbase.com/v1${input.targetPath}`), {
            method: input.method,
            headers: browserbaseProviderHeaders({
                apiKey: input.apiKey,
                accept: input.accept ?? null,
                hasBody: input.body !== null,
            }),
            body: input.body,
            signal: controller?.signal,
        })
    } finally {
        if (timeout) {
            clearTimeout(timeout)
        }
    }
}

async function releaseBrowserbaseProviderSession(input: {
    apiKey: string
    browserbaseSessionId: string
    timeoutMs?: number
}): Promise<void> {
    const response = await fetchBrowserbaseProvider({
        apiKey: input.apiKey,
        targetPath: `/sessions/${encodeURIComponent(input.browserbaseSessionId)}`,
        method: 'POST',
        body: browserbaseReleaseSessionRequestBody,
        timeoutMs: input.timeoutMs,
    })
    if (!response.ok) {
        throw new Error(`Browserbase cleanup release failed with status ${response.status}`)
    }
}

async function cleanupBillingFailedBrowserbaseSession(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    apiKey: string
    browserbaseSessionId: string
    usageRequestId: string
}): Promise<void> {
    try {
        const releaseRequested = await requestHostedBrowserbaseSessionRelease({
            env: input.env,
            workspaceId: input.workspaceId,
            roomId: input.roomId,
            browserbaseSessionId: input.browserbaseSessionId,
        })
        if (!releaseRequested) {
            console.error('Hosted Browserbase session release request failed after billing error', {
                workspaceId: input.workspaceId,
                roomId: input.roomId,
                browserbaseSessionId: input.browserbaseSessionId,
                usageRequestId: input.usageRequestId,
            })
        }
    } catch (error) {
        console.error('Hosted Browserbase session release request failed after billing error', {
            workspaceId: input.workspaceId,
            roomId: input.roomId,
            browserbaseSessionId: input.browserbaseSessionId,
            usageRequestId: input.usageRequestId,
            error,
        })
    }
    try {
        await releaseBrowserbaseProviderSession({
            apiKey: input.apiKey,
            browserbaseSessionId: input.browserbaseSessionId,
            timeoutMs: browserbaseCleanupTimeoutMs,
        })
    } catch (error) {
        console.error('Hosted Browserbase session cleanup failed after billing error', {
            workspaceId: input.workspaceId,
            roomId: input.roomId,
            browserbaseSessionId: input.browserbaseSessionId,
            usageRequestId: input.usageRequestId,
            error,
        })
        return
    }
    try {
        await markHostedBrowserbaseSessionReleased({
            env: input.env,
            workspaceId: input.workspaceId,
            roomId: input.roomId,
            browserbaseSessionId: input.browserbaseSessionId,
        })
    } catch (error) {
        console.error('Hosted Browserbase session release record failed after billing error', {
            workspaceId: input.workspaceId,
            roomId: input.roomId,
            browserbaseSessionId: input.browserbaseSessionId,
            usageRequestId: input.usageRequestId,
            error,
        })
    }
}

async function assertNoPriorBrowserbaseSessionForUsageRequest(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    usageRequestId: string
}): Promise<Response | null> {
    const existingSession = await readHostedBrowserbaseSessionByUsageRequestId({
        env: input.env,
        workspaceId: input.workspaceId,
        roomId: input.roomId,
        usageRequestId: input.usageRequestId,
    })
    if (!existingSession) {
        return null
    }
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
        if (providerRequest.action === 'create_session') {
            const existingSessionError = await assertNoPriorBrowserbaseSessionForUsageRequest({
                env,
                workspaceId: proxyPath.workspaceId,
                roomId: proxyPath.roomId,
                usageRequestId: usageRequest.usageRequestId,
            })
            if (existingSessionError) {
                return existingSessionError
            }
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

    const accept = request.headers.get('accept')
    let response: Response
    let createdBrowserbaseSessionId: string | null = null
    try {
        response = await fetchBrowserbaseProvider({
            apiKey,
            accept,
            targetPath: proxyPath.targetPath,
            method: request.method,
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
                await releaseBrowserbaseProviderSession({
                    apiKey,
                    browserbaseSessionId,
                    timeoutMs: browserbaseCleanupTimeoutMs,
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
        createdBrowserbaseSessionId = browserbaseSessionId
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
            if (providerRequest.action === 'create_session' && createdBrowserbaseSessionId) {
                await cleanupBillingFailedBrowserbaseSession({
                    env,
                    workspaceId: proxyPath.workspaceId,
                    roomId: proxyPath.roomId,
                    apiKey,
                    browserbaseSessionId: createdBrowserbaseSessionId,
                    usageRequestId: usageRequest.usageRequestId,
                })
            }
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
