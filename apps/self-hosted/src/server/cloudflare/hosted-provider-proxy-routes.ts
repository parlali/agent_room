import type { ExecutionContext } from '@cloudflare/workers-types'
import type { AgentRoomHostedEnv } from './bindings'
import type { HostedRuntimeUsageContext } from './hosted-runtime-usage-context'
import {
    assertHostedQuotaAllowed,
    hostedQuotaDeniedResponse,
    readHostedQuotaPolicy,
    recordHostedProviderSpend,
    refundHostedProviderSpend,
    type HostedQuotaCheckInput,
    type HostedQuotaPolicy,
} from './hosted-abuse-controls'
import {
    applyUsageMarkupMicros,
    centsFromMicrosCeil,
    hostedBraveSearchCostMicros,
    type HostedBillingReservationProvider,
} from './hosted-billing-types'
import {
    ensureHostedBillingAccount,
    findHostedBillingReservationByIdempotencyKey,
    readHostedProviderUsageSettlementByIdempotencyKey,
} from './hosted-billing-repository'
import { resolveHostedConfig } from './hosted-config'
import { objectRecord, nullableObjectRecord } from './hosted-json'
import {
    openRouterUsageSnapshotFromProviderText,
    parseHostedBraveProxyPath,
    parseHostedOpenRouterProxyPath,
} from './hosted-provider-proxy'
import {
    estimateHostedManagedModelCostMicros,
    hostedManagedModelAuditMetadata,
    hostedManagedModelId,
    hostedManagedModelMaxOutputTokens,
    hostedManagedModelPreflightSpendEstimateCents,
    hostedManagedModelReasoningEffort,
    isHostedRetiredManagedModelId,
} from './hosted-model-policy'
import {
    authorizeFixedProviderReservation,
    hostedFixedCostReservationCents,
    hostedProviderReservationFailureResponse,
    hostedProviderProxyUsageRequest,
    hostedProviderResponseHeaders,
    releaseHostedProviderPreflightReservation,
    releaseHostedProviderQuotaFailureReservation,
    releaseHostedProviderSettlementFailureReservation,
    type HostedProviderProxyBillingAuthority,
} from './hosted-provider-proxy-billing'
import { recordHostedProviderUsage, recordHostedProviderUsageBlocked } from './hosted-usage-billing'
import { hostedJsonResponse } from './hosted-worker-response'
import { requireHostedRuntimeProviderProxy } from './hosted-runtime-worker-auth'

interface HostedOpenRouterProviderRequest {
    body: BodyInit | null
    model: string | null
}

type HostedManagedModelRequestPolicy =
    | { kind: 'managed' }
    | { kind: 'upgraded'; requestedModel: string }
    | { kind: 'rejected'; requestedModel: string | null }

function cappedMaxTokens(value: unknown): number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
        ? Math.min(value, hostedManagedModelMaxOutputTokens)
        : hostedManagedModelMaxOutputTokens
}

function hasOwnPayloadField(payload: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(payload, key)
}

function hostedOpenRouterProviderPayload(
    payload: Record<string, unknown>,
): Record<string, unknown> {
    const next: Record<string, unknown> = {
        ...payload,
        model: hostedManagedModelId,
        usage: {
            ...objectRecord(payload.usage),
            include: true,
        },
        reasoning: {
            ...objectRecord(payload.reasoning),
            effort: hostedManagedModelReasoningEffort,
        },
    }
    if (hasOwnPayloadField(payload, 'max_completion_tokens')) {
        next.max_completion_tokens = cappedMaxTokens(payload.max_completion_tokens)
        if (hasOwnPayloadField(payload, 'max_tokens')) {
            next.max_tokens = cappedMaxTokens(payload.max_tokens)
        }
        return next
    }
    next.max_tokens = cappedMaxTokens(payload.max_tokens)
    return next
}

function hostedManagedModelRequestPolicy(
    requestedModel: string | null,
): HostedManagedModelRequestPolicy {
    if (requestedModel === hostedManagedModelId) {
        return { kind: 'managed' }
    }
    if (requestedModel && isHostedRetiredManagedModelId(requestedModel)) {
        return {
            kind: 'upgraded',
            requestedModel,
        }
    }
    return {
        kind: 'rejected',
        requestedModel,
    }
}

async function assertProviderQuotaOrResponse(input: {
    check: HostedQuotaCheckInput
    reservationId?: string | null
    policy?: HostedQuotaPolicy
}): Promise<Response | null> {
    try {
        await assertHostedQuotaAllowed(input.check, { policy: input.policy })
        return null
    } catch (error) {
        const response = hostedQuotaDeniedResponse(error)
        if (input.reservationId) {
            await releaseHostedProviderQuotaFailureReservation({
                env: input.check.env,
                workspaceId: input.check.workspaceId,
                reservationId: input.reservationId,
            })
        }
        if (response) {
            return response
        }
        throw error
    }
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
        body: JSON.stringify(hostedOpenRouterProviderPayload(payload)),
        model: typeof payload.model === 'string' ? payload.model : null,
    }
}

async function repairExistingProviderUsageSettlement(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    provider: HostedBillingReservationProvider
    model: string
    billedBy: HostedProviderProxyBillingAuthority
    usageIdempotencyKey: string
    reservationIdempotencyKey: string
    usageRequestId: string
    targetPath: string | null
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
                ...(input.targetPath ? { targetPath: input.targetPath } : {}),
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

function hostedBraveSearchReservationCents(input: { usageMarkupBps: number }): number {
    return hostedFixedCostReservationCents({
        costMicros: hostedBraveSearchCostMicros,
        usageMarkupBps: input.usageMarkupBps,
    })
}

const hostedOpenRouterStreamUsageAccumulationMaxChars = 4 * 1024 * 1024

function isHostedOpenRouterStreamResponse(response: Response): boolean {
    return (
        response.body !== null &&
        (response.headers.get('content-type')?.toLowerCase().includes('text/event-stream') ?? false)
    )
}

function pumpHostedProviderStream(input: {
    upstream: ReadableStream<Uint8Array>
    maxChars: number
    settle: (responseText: string) => Promise<void>
}): { clientStream: ReadableStream<Uint8Array>; done: Promise<void> } {
    const reader = input.upstream.getReader()
    const decoder = new TextDecoder()
    let accumulated = ''
    let clientCancelled = false
    let resolveDone: () => void
    const done = new Promise<void>((resolve) => {
        resolveDone = resolve
    })
    const retainTail = () => {
        if (accumulated.length > input.maxChars) {
            accumulated = accumulated.slice(accumulated.length - input.maxChars)
        }
    }
    const clientStream = new ReadableStream<Uint8Array>({
        start(controller) {
            const pump = async () => {
                let upstreamError: unknown = null
                try {
                    for (;;) {
                        const { done: streamDone, value } = await reader.read()
                        if (streamDone) {
                            break
                        }
                        accumulated += decoder.decode(value, { stream: true })
                        retainTail()
                        if (!clientCancelled) {
                            try {
                                controller.enqueue(value)
                            } catch {
                                clientCancelled = true
                            }
                        }
                    }
                    accumulated += decoder.decode()
                    retainTail()
                } catch (error) {
                    upstreamError = error
                } finally {
                    reader.releaseLock()
                }
                if (!clientCancelled) {
                    if (upstreamError) {
                        controller.error(upstreamError)
                    } else {
                        controller.close()
                    }
                }
                await input.settle(accumulated)
                resolveDone()
            }
            void pump()
        },
        cancel() {
            clientCancelled = true
        },
    })
    return { clientStream, done }
}

type HostedOpenRouterProxySettlementOutcome =
    | { kind: 'settled' }
    | { kind: 'cost_missing' }
    | { kind: 'cost_exceeds_ceiling' }
    | { kind: 'settlement_failed' }

interface HostedOpenRouterProxySettlementInput {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    usageContext: HostedRuntimeUsageContext
    model: string
    managedModelMetadata: Record<string, unknown>
    reservationId: string | null
    reservationCents: number
    usageMarkupBps: number
    usageRequestId: string
    targetPath: string | null
    usageIdempotencyKey: string
    responseStatus: number
    responseText: string
}

async function settleHostedOpenRouterProxyUsage(
    input: HostedOpenRouterProxySettlementInput,
): Promise<HostedOpenRouterProxySettlementOutcome> {
    const providerUsage = openRouterUsageSnapshotFromProviderText(input.responseText)
    const costEstimatedFromTokens = providerUsage.costMicros === null
    const costMicros =
        providerUsage.costMicros ??
        estimateHostedManagedModelCostMicros({
            inputTokens: providerUsage.inputTokens,
            cachedTokens: providerUsage.cachedTokens,
            outputTokens: providerUsage.outputTokens,
            reasoningTokens: providerUsage.reasoningTokens,
        })
    if (costMicros === null) {
        await recordHostedProviderUsageBlocked({
            env: input.env,
            workspaceId: input.workspaceId,
            roomId: input.roomId,
            sessionKey: input.usageContext.sessionKey,
            runId: input.usageContext.runId,
            jobId: input.usageContext.jobId,
            provider: 'openrouter',
            model: input.model,
            metadata: {
                ...input.managedModelMetadata,
                billedBy: 'hosted_openrouter_proxy',
                providerProxyBillingAuthority: 'worker_proxy',
                missingProviderActualCost: true,
                reservationId: input.reservationId,
                usageRequestId: input.usageRequestId,
                sessionKey: input.usageContext.sessionKey,
                runId: input.usageContext.runId,
                jobId: input.usageContext.jobId,
                targetPath: input.targetPath,
                status: input.responseStatus,
            },
            idempotencyKey: input.usageIdempotencyKey,
        })
        await releaseHostedProviderPreflightReservation({
            env: input.env,
            workspaceId: input.workspaceId,
            reservationId: input.reservationId,
        })
        return { kind: 'cost_missing' }
    }
    const billedMicros = applyUsageMarkupMicros(costMicros, input.usageMarkupBps)
    const billedCents = centsFromMicrosCeil(billedMicros)
    if (billedCents > input.reservationCents) {
        await recordHostedProviderUsageBlocked({
            env: input.env,
            workspaceId: input.workspaceId,
            roomId: input.roomId,
            sessionKey: input.usageContext.sessionKey,
            runId: input.usageContext.runId,
            jobId: input.usageContext.jobId,
            provider: 'openrouter',
            model: input.model,
            metadata: {
                ...input.managedModelMetadata,
                billedBy: 'hosted_openrouter_proxy',
                providerProxyBillingAuthority: 'worker_proxy',
                actualCostExceededAuthorizedMaximum: true,
                costMicros,
                billedMicros,
                billedCents,
                reservationId: input.reservationId,
                usageRequestId: input.usageRequestId,
                sessionKey: input.usageContext.sessionKey,
                runId: input.usageContext.runId,
                jobId: input.usageContext.jobId,
                targetPath: input.targetPath,
                status: input.responseStatus,
            },
            idempotencyKey: input.usageIdempotencyKey,
        })
        await releaseHostedProviderPreflightReservation({
            env: input.env,
            workspaceId: input.workspaceId,
            reservationId: input.reservationId,
        })
        return { kind: 'cost_exceeds_ceiling' }
    }
    let settlement: Awaited<ReturnType<typeof recordHostedProviderUsage>>
    try {
        settlement = await recordHostedProviderUsage({
            env: input.env,
            workspaceId: input.workspaceId,
            roomId: input.roomId,
            sessionKey: input.usageContext.sessionKey,
            runId: input.usageContext.runId,
            jobId: input.usageContext.jobId,
            provider: 'openrouter',
            model: input.model,
            inputTokens: providerUsage.inputTokens,
            outputTokens: providerUsage.outputTokens,
            cachedTokens: providerUsage.cachedTokens,
            reasoningTokens: providerUsage.reasoningTokens,
            totalTokens: providerUsage.totalTokens,
            estimatedCostUsd: costMicros / 1_000_000,
            costMicros,
            billingReservationId: input.reservationId,
            metadata: {
                ...input.managedModelMetadata,
                billedBy: 'hosted_openrouter_proxy',
                providerProxyBillingAuthority: 'worker_proxy',
                costEstimatedFromTokens,
                reservationId: input.reservationId,
                usageRequestId: input.usageRequestId,
                sessionKey: input.usageContext.sessionKey,
                runId: input.usageContext.runId,
                jobId: input.usageContext.jobId,
                targetPath: input.targetPath,
            },
            idempotencyKey: input.usageIdempotencyKey,
        })
    } catch {
        await releaseHostedProviderSettlementFailureReservation({
            env: input.env,
            workspaceId: input.workspaceId,
            reservationId: input.reservationId,
        })
        return { kind: 'settlement_failed' }
    }
    await recordHostedProviderSpend({
        env: input.env,
        workspaceId: input.workspaceId,
        roomId: input.roomId,
        sessionKey: input.usageContext.sessionKey,
        runId: input.usageContext.runId,
        jobId: input.usageContext.jobId,
        action: 'provider_openrouter',
        cents: settlement.debitedCents,
    }).catch((error) => {
        console.error(
            'Hosted provider spend counter update failed',
            error instanceof Error ? error.message : error,
        )
    })
    return { kind: 'settled' }
}

function hostedOpenRouterProxySettlementFailureResponse(
    outcome: Exclude<HostedOpenRouterProxySettlementOutcome, { kind: 'settled' }>,
): Response {
    if (outcome.kind === 'cost_missing') {
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
    if (outcome.kind === 'cost_exceeds_ceiling') {
        return hostedJsonResponse(
            {
                ok: false,
                code: 'provider_actual_cost_exceeds_authorized_maximum',
            },
            {
                status: 402,
            },
        )
    }
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

export async function hostedOpenRouterProxy(
    env: AgentRoomHostedEnv,
    request: Request,
    url: URL,
    ctx: Pick<ExecutionContext, 'waitUntil'>,
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
                model: hostedManagedModelId,
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
    const requestPolicy = hostedManagedModelRequestPolicy(providerRequest.model)
    const reservationCents = config.billing.modelReservationCents
    const managedModelMetadata = hostedManagedModelAuditMetadata({
        reservationCents,
    })
    const requestManagedModelMetadata =
        requestPolicy.kind === 'upgraded'
            ? {
                  ...managedModelMetadata,
                  requestedModel: requestPolicy.requestedModel,
                  upgradedFromRetiredManagedModel: true,
              }
            : managedModelMetadata
    if (requestPolicy.kind === 'upgraded') {
        console.warn('Hosted OpenRouter proxy upgraded retired managed model request', {
            workspaceId: proxyPath.workspaceId,
            roomId: proxyPath.roomId,
            sessionKey: usageContext.sessionKey,
            runId: usageContext.runId,
            jobId: usageContext.jobId,
            requestedModel: requestPolicy.requestedModel,
            managedModel: hostedManagedModelId,
        })
    }
    if (requestPolicy.kind === 'rejected') {
        await recordHostedProviderUsageBlocked({
            env,
            workspaceId: proxyPath.workspaceId,
            roomId: proxyPath.roomId,
            sessionKey: usageContext.sessionKey,
            runId: usageContext.runId,
            jobId: usageContext.jobId,
            provider: 'openrouter',
            model: requestPolicy.requestedModel,
            metadata: {
                ...managedModelMetadata,
                billedBy: 'hosted_openrouter_proxy',
                providerProxyBillingAuthority: 'worker_proxy',
                hostedModelPolicyViolation: true,
                requestedModel: requestPolicy.requestedModel,
                usageRequestId,
                sessionKey: usageContext.sessionKey,
                runId: usageContext.runId,
                jobId: usageContext.jobId,
                targetPath: proxyPath.targetPath,
            },
            idempotencyKey: usageIdempotencyKey,
        })
        return hostedJsonResponse(
            {
                ok: false,
                code: 'model_not_allowed',
                message:
                    'This conversation uses a model that is not available. Start a new conversation or switch the model.',
            },
            {
                status: 403,
            },
        )
    }
    const quotaCheck = {
        env,
        request,
        workspaceId: proxyPath.workspaceId,
        roomId: proxyPath.roomId,
        sessionKey: usageContext.sessionKey,
        runId: usageContext.runId,
        jobId: usageContext.jobId,
        action: 'provider_openrouter',
        providerPath: proxyPath.targetPath,
        amount: {
            count: 1,
            cents: 0,
        },
    } satisfies HostedQuotaCheckInput
    const quotaPolicy = await readHostedQuotaPolicy({
        env,
        workspaceId: proxyPath.workspaceId,
    })
    const [preflightSettled, ensureSettled] = await Promise.allSettled([
        assertProviderQuotaOrResponse({
            check: {
                ...quotaCheck,
                amount: {
                    count: 1,
                    cents: hostedManagedModelPreflightSpendEstimateCents,
                },
                consume: false,
            },
            policy: quotaPolicy,
        }),
        ensureHostedBillingAccount({
            env,
            workspaceId: proxyPath.workspaceId,
        }),
    ])
    if (preflightSettled.status === 'rejected') {
        throw preflightSettled.reason
    }
    if (preflightSettled.value) {
        return preflightSettled.value
    }
    let reservationId: string | null = null
    try {
        if (ensureSettled.status === 'rejected') {
            throw ensureSettled.reason
        }
        const reservationIdOrResponse = await authorizeFixedProviderReservation({
            env,
            workspaceId: proxyPath.workspaceId,
            roomId: proxyPath.roomId,
            usageContext,
            provider: 'openrouter',
            amountCents: reservationCents,
            idempotencyKey: reservationIdempotencyKey,
            targetPath: proxyPath.targetPath,
            usageRequestId,
            metadata: requestManagedModelMetadata,
        })
        if (reservationIdOrResponse instanceof Response) {
            return reservationIdOrResponse
        }
        reservationId = reservationIdOrResponse
    } catch (error) {
        return hostedProviderReservationFailureResponse({
            error,
            workspaceId: proxyPath.workspaceId,
            roomId: proxyPath.roomId,
            provider: 'openrouter',
            targetPath: proxyPath.targetPath,
            usageRequestId,
        })
    }

    const quotaConsumeResponse = await assertProviderQuotaOrResponse({
        check: quotaCheck,
        reservationId,
        policy: quotaPolicy,
    })
    if (quotaConsumeResponse) {
        return quotaConsumeResponse
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
        await recordHostedProviderUsageBlocked({
            env,
            workspaceId: proxyPath.workspaceId,
            roomId: proxyPath.roomId,
            sessionKey: usageContext.sessionKey,
            runId: usageContext.runId,
            jobId: usageContext.jobId,
            provider: 'openrouter',
            model: hostedManagedModelId,
            metadata: {
                ...requestManagedModelMetadata,
                billedBy: 'hosted_openrouter_proxy',
                providerProxyBillingAuthority: 'worker_proxy',
                providerRejectedRequest: true,
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
        return new Response(responseText, {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
        })
    }
    const settlementInputBase = {
        env,
        workspaceId: proxyPath.workspaceId,
        roomId: proxyPath.roomId,
        usageContext,
        model: hostedManagedModelId,
        managedModelMetadata: requestManagedModelMetadata,
        reservationId,
        reservationCents,
        usageMarkupBps: config.billing.usageMarkupBps,
        usageRequestId,
        targetPath: proxyPath.targetPath,
        usageIdempotencyKey,
        responseStatus: response.status,
    }
    if (reservationId) {
        responseHeaders.set('x-agent-room-billing-reservation-id', reservationId)
    }
    if (isHostedOpenRouterStreamResponse(response) && response.body) {
        const settleStreamedUsage = async (responseText: string): Promise<void> => {
            try {
                const outcome = await settleHostedOpenRouterProxyUsage({
                    ...settlementInputBase,
                    responseText,
                })
                if (outcome.kind !== 'settled') {
                    console.error('Hosted OpenRouter streaming settlement did not bill', {
                        workspaceId: proxyPath.workspaceId,
                        roomId: proxyPath.roomId,
                        provider: 'openrouter',
                        usageRequestId,
                        reservationId,
                        outcome: outcome.kind,
                    })
                }
            } catch (error) {
                console.error('Hosted OpenRouter streaming settlement failed', {
                    workspaceId: proxyPath.workspaceId,
                    roomId: proxyPath.roomId,
                    provider: 'openrouter',
                    usageRequestId,
                    reservationId,
                    error: error instanceof Error ? error.message : error,
                })
            }
        }
        const { clientStream, done } = pumpHostedProviderStream({
            upstream: response.body,
            maxChars: hostedOpenRouterStreamUsageAccumulationMaxChars,
            settle: settleStreamedUsage,
        })
        ctx.waitUntil(done)
        return new Response(clientStream, {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
        })
    }
    const responseText = await response.text()
    const outcome = await settleHostedOpenRouterProxyUsage({
        ...settlementInputBase,
        responseText,
    })
    if (outcome.kind !== 'settled') {
        return hostedOpenRouterProxySettlementFailureResponse(outcome)
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
    const reservationCents = hostedBraveSearchReservationCents({
        usageMarkupBps: config.billing.usageMarkupBps,
    })
    const quotaCheck = {
        env,
        request,
        workspaceId: proxyPath.workspaceId,
        roomId: proxyPath.roomId,
        sessionKey: usageContext.sessionKey,
        runId: usageContext.runId,
        jobId: usageContext.jobId,
        action: 'provider_brave',
        providerPath: proxyPath.targetPath,
        amount: {
            count: 1,
            cents: reservationCents,
        },
    } satisfies HostedQuotaCheckInput
    const quotaPreflightResponse = await assertProviderQuotaOrResponse({
        check: {
            ...quotaCheck,
            consume: false,
        },
    })
    if (quotaPreflightResponse) {
        return quotaPreflightResponse
    }

    let reservationId: string | null = null
    try {
        await ensureHostedBillingAccount({
            env,
            workspaceId: proxyPath.workspaceId,
        })
        const reservationIdOrResponse = await authorizeFixedProviderReservation({
            env,
            workspaceId: proxyPath.workspaceId,
            roomId: proxyPath.roomId,
            usageContext,
            provider: 'brave',
            amountCents: reservationCents,
            idempotencyKey: reservationIdempotencyKey,
            targetPath: proxyPath.targetPath,
            usageRequestId,
        })
        if (reservationIdOrResponse instanceof Response) {
            return reservationIdOrResponse
        }
        reservationId = reservationIdOrResponse
    } catch (error) {
        return hostedProviderReservationFailureResponse({
            error,
            workspaceId: proxyPath.workspaceId,
            roomId: proxyPath.roomId,
            provider: 'brave',
            targetPath: proxyPath.targetPath,
            usageRequestId,
        })
    }

    const quotaConsumeResponse = await assertProviderQuotaOrResponse({
        check: quotaCheck,
        reservationId,
    })
    if (quotaConsumeResponse) {
        return quotaConsumeResponse
    }
    const refundConsumedSpend = async () => {
        try {
            await refundHostedProviderSpend({
                env,
                workspaceId: proxyPath.workspaceId,
                roomId: proxyPath.roomId,
                sessionKey: usageContext.sessionKey,
                runId: usageContext.runId,
                jobId: usageContext.jobId,
                action: 'provider_brave',
                cents: reservationCents,
            })
        } catch (error) {
            console.error('Hosted provider spend counter refund failed', {
                workspaceId: proxyPath.workspaceId,
                roomId: proxyPath.roomId,
                provider: 'brave',
                error: error instanceof Error ? error.message : error,
            })
        }
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
        await refundConsumedSpend()
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
        await refundConsumedSpend()
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
