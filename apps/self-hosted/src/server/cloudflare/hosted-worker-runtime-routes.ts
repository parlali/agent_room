import { Buffer } from 'node:buffer'
import {
    mergeCapabilities,
    normalizeSearchConfig,
    searchProviderSecretId,
} from '../configuration/capabilities'
import type { AgentRoomHostedEnv } from './bindings'
import { hostedProviderBillingGateCents } from './hosted-billing-types'
import {
    authorizeHostedBillingReservation,
    ensureHostedBillingAccount,
    HostedBillingReservationAlreadyExistsError,
    findHostedBillingReservationByIdempotencyKey,
    readHostedProviderUsageSettlementByIdempotencyKey,
    releaseHostedBillingReservation,
} from './hosted-billing-repository'
import { resolveHostedConfig } from './hosted-config'
import { finishHostedCronRunFromRuntimeEvent } from './hosted-cron-management'
import { upsertHostedRoomRuntimeFile } from './hosted-file-store'
import { hostedSearchDefaults } from './hosted-operator-config-service'
import { listRoomMcpBindings, readHostedRoomConfig } from './hosted-room-config-store'
import {
    hostedBraveProxyPathPrefix,
    hostedOpenRouterProxyPathPrefix,
    openRouterCostMicrosFromProviderText,
    parseHostedBraveProxyPath,
    parseHostedOpenRouterProxyPath,
} from './hosted-provider-proxy'
import { readHostedRuntimeToken } from './hosted-runtime-client'
import { getHostedRuntimeEndpointState, getHostedWorkspaceSettings } from './hosted-room-service'
import {
    deleteHostedRuntimeStateFile,
    putHostedRuntimeStateFile,
} from './hosted-runtime-state-store'
import {
    recordHostedProviderUsage,
    recordHostedProviderUsageBlocked,
    recordHostedRuntimeUsageEvent,
} from './hosted-usage-billing'
import { hostedJsonResponse } from './hosted-worker-response'
import { parseHostedRuntimeStateOperation } from '../rooms/hosted-runtime-state-contract'
import { runtimeUsageEventFromLogEntry } from '../rooms/pi-execution-adapter/usage-sync'
import type { RoomFileSurface } from '../rooms/file-store'
import { timingSafeEqualString } from '../security/timing-safe'

function bearerToken(request: Request): string | null {
    const authorization = request.headers.get('authorization') ?? ''
    const prefix = 'Bearer '
    return authorization.startsWith(prefix) ? authorization.slice(prefix.length).trim() : null
}

function boundedHeaderToken(value: string | null): string | null {
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

interface HostedRuntimeUsageContext {
    sessionKey: string
    runId: string | null
    jobId: string | null
}

function runtimeUsageContext(request: Request): HostedRuntimeUsageContext | Response {
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

function objectRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {}
}

function nullableObjectRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null
}

interface HostedOpenRouterProviderRequest {
    body: BodyInit | null
    model: string | null
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

export function runtimeUsageIdempotencyKey(input: {
    workspaceId: string
    roomId: string
    entry: unknown
}): string {
    const entry = objectRecord(input.entry)
    const seq = typeof entry.seq === 'number' && Number.isFinite(entry.seq) ? entry.seq : null
    const ts = typeof entry.ts === 'number' && Number.isFinite(entry.ts) ? entry.ts : null
    const event = idempotencyField(typeof entry.event === 'string' ? entry.event : 'unknown')
    if (seq !== null && ts !== null) {
        return `runtime:${input.workspaceId}:${input.roomId}:${ts}:${seq}:${event}`
    }
    const payload = objectRecord(entry.payload)
    const stableFields = [
        ts === null ? 'no-ts' : String(ts),
        event,
        idempotencyField(entry.sessionKey ?? payload.sessionKey),
        idempotencyField(entry.runId ?? payload.runId),
        idempotencyField(entry.jobId ?? payload.jobId),
    ].join('\u0000')
    return `runtime:${input.workspaceId}:${input.roomId}:${event}:missing-seq:${stableHash(stableFields)}`
}

function idempotencyField(value: unknown): string {
    return typeof value === 'string' && value.trim()
        ? value
              .trim()
              .replace(/[^a-zA-Z0-9_.:-]/g, '_')
              .slice(0, 128)
        : 'none'
}

function stableHash(value: string): string {
    let hash = 2166136261
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index)
        hash = Math.imul(hash, 16777619)
    }
    return (hash >>> 0).toString(36)
}

function runtimeRunFinishedPayload(entry: unknown): {
    status: string | null
    error: string | null
} {
    const payload = objectRecord(objectRecord(entry).payload)
    return {
        status: typeof payload.status === 'string' ? payload.status : null,
        error: typeof payload.error === 'string' ? payload.error : null,
    }
}

type HostedRuntimeEndpointState = NonNullable<
    Awaited<ReturnType<typeof getHostedRuntimeEndpointState>>
>

async function requireHostedRuntimeCallback(input: {
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

async function requireHostedRuntimeProviderProxy(input: {
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

async function hostedRuntimeUsageCallback(
    env: AgentRoomHostedEnv,
    request: Request,
): Promise<Response> {
    let record: Record<string, unknown> = {}
    try {
        const body = (await request.json()) as unknown
        record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
    } catch {
        return hostedJsonResponse(
            {
                ok: false,
                code: 'invalid_request_body',
            },
            {
                status: 400,
            },
        )
    }
    const callback = await requireHostedRuntimeCallback({
        env,
        request,
        record,
    })
    if (callback instanceof Response) {
        return callback
    }
    const providerCandidate = callback.runtime.runtime.providerCandidate
    if (!providerCandidate) {
        return hostedJsonResponse(
            {
                ok: false,
                code: 'runtime_provider_binding_missing',
            },
            {
                status: 409,
            },
        )
    }
    const event = runtimeUsageEventFromLogEntry({
        roomId: callback.roomId,
        entry: record.entry,
    })
    if (!event) {
        return hostedJsonResponse({
            ok: true,
            persisted: false,
        })
    }
    const finished = event.kind === 'job' ? runtimeRunFinishedPayload(record.entry) : null
    let result: Awaited<ReturnType<typeof recordHostedRuntimeUsageEvent>> | null = null
    try {
        result = await recordHostedRuntimeUsageEvent({
            env,
            workspaceId: callback.workspaceId,
            providerCandidate,
            event,
            idempotencyKey: runtimeUsageIdempotencyKey({
                workspaceId: callback.workspaceId,
                roomId: callback.roomId,
                entry: record.entry,
            }),
        })
    } finally {
        if (finished) {
            await finishHostedCronRunFromRuntimeEvent({
                env,
                workspaceId: callback.workspaceId,
                roomId: callback.roomId,
                runId: event.runId,
                jobId: event.jobId,
                status: finished.status,
                error: finished.error,
                provider: event.provider,
                model: event.model,
                configVersion: callback.runtime.runtime.configVersion,
            })
        }
    }
    if (!result) {
        throw new Error('Hosted runtime usage was not recorded')
    }
    return hostedJsonResponse({
        ok: true,
        persisted: result.persisted,
        id: result.usageEventId,
        debitedCents: result.debitedCents,
        ledgerEntryId: result.ledgerEntryId,
    })
}

function runtimeFileSurface(value: unknown): RoomFileSurface | null {
    return value === 'workspace' || value === 'store' ? value : null
}

async function hostedRuntimeFileCallback(
    env: AgentRoomHostedEnv,
    request: Request,
): Promise<Response> {
    let record: Record<string, unknown> = {}
    try {
        const body = (await request.json()) as unknown
        record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
    } catch {
        return hostedJsonResponse(
            {
                ok: false,
                code: 'invalid_request_body',
            },
            {
                status: 400,
            },
        )
    }
    const callback = await requireHostedRuntimeCallback({
        env,
        request,
        record,
    })
    if (callback instanceof Response) {
        return callback
    }
    const file = objectRecord(record.file)
    const surface = runtimeFileSurface(file.surface)
    const relativePath = typeof file.relativePath === 'string' ? file.relativePath : ''
    if (!surface || !relativePath || typeof file.contentBase64 !== 'string') {
        return hostedJsonResponse(
            {
                ok: false,
                code: 'invalid_file_callback',
                message: 'surface, relativePath, and contentBase64 are required',
            },
            {
                status: 400,
            },
        )
    }
    const saved = await upsertHostedRoomRuntimeFile({
        env,
        workspaceId: callback.workspaceId,
        roomId: callback.roomId,
        surface,
        relativePath,
        content: new Uint8Array(Buffer.from(file.contentBase64, 'base64url')),
    })
    return hostedJsonResponse({
        ok: true,
        file: saved,
    })
}

async function hostedRuntimeStateCallback(
    env: AgentRoomHostedEnv,
    request: Request,
): Promise<Response> {
    let record: Record<string, unknown>
    try {
        const parsed = (await request.json()) as unknown
        record = objectRecord(parsed)
    } catch {
        return hostedJsonResponse(
            {
                ok: false,
                code: 'invalid_request_body',
            },
            {
                status: 400,
            },
        )
    }
    const callback = await requireHostedRuntimeCallback({
        env,
        request,
        record,
    })
    if (callback instanceof Response) {
        return callback
    }
    const state = objectRecord(record.state)
    const relativePath = typeof state.relativePath === 'string' ? state.relativePath : ''
    const operation = parseHostedRuntimeStateOperation(state.operation)
    if (!operation) {
        return hostedJsonResponse(
            {
                ok: false,
                code: 'invalid_state_callback',
                message: 'operation must be upsert or delete',
            },
            {
                status: 400,
            },
        )
    }
    if (!relativePath || (operation === 'upsert' && typeof state.contentBase64 !== 'string')) {
        return hostedJsonResponse(
            {
                ok: false,
                code: 'invalid_state_callback',
                message: 'relativePath and contentBase64 are required for upsert',
            },
            {
                status: 400,
            },
        )
    }
    const saved =
        operation === 'delete'
            ? await deleteHostedRuntimeStateFile({
                  env,
                  workspaceId: callback.workspaceId,
                  roomId: callback.roomId,
                  relativePath,
              })
            : await putHostedRuntimeStateFile({
                  env,
                  workspaceId: callback.workspaceId,
                  roomId: callback.roomId,
                  relativePath,
                  content: new Uint8Array(Buffer.from(String(state.contentBase64), 'base64url')),
              })
    return hostedJsonResponse({
        ok: true,
        state: saved,
    })
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

async function repairExistingOpenRouterUsageSettlement(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
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
        !reservation ||
        usage.provider !== 'openrouter' ||
        usage.roomId !== input.roomId ||
        usage.costMicros === null ||
        reservation.status !== 'authorized' ||
        reservation.provider !== 'openrouter' ||
        reservation.roomId !== input.roomId
    ) {
        return false
    }
    await recordHostedProviderUsage({
        env: input.env,
        workspaceId: input.workspaceId,
        roomId: usage.roomId,
        sessionKey: usage.sessionKey,
        runId: usage.runId,
        jobId: usage.jobId,
        provider: 'openrouter',
        model: usage.model,
        inputTokens: null,
        outputTokens: null,
        cachedTokens: null,
        estimatedCostUsd: usage.costMicros / 1_000_000,
        costMicros: usage.costMicros,
        billingReservationId: reservation.id,
        releaseReservationOnDebitFailure: false,
        metadata: {
            billedBy: 'hosted_openrouter_proxy',
            providerProxyBillingAuthority: 'worker_proxy',
            reservationId: reservation.id,
            usageRequestId: input.usageRequestId,
            targetPath: input.targetPath,
            settlementRepair: true,
        },
        idempotencyKey: input.usageIdempotencyKey,
    })
    return true
}

function openRouterResponseHeaders(response: Response): Headers {
    const headers = new Headers(response.headers)
    headers.delete('content-encoding')
    headers.delete('content-length')
    headers.delete('set-cookie')
    headers.set('cache-control', 'no-store')
    return headers
}

async function hostedOpenRouterProxy(
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
    const usageRequestId = boundedHeaderToken(request.headers.get('x-agent-room-usage-request-id'))
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
    const usageContext = runtimeUsageContext(request)
    if (usageContext instanceof Response) {
        return usageContext
    }
    const usageContextReferenceError = await runtimeUsageContextReferences(env, {
        workspaceId: proxyPath.workspaceId,
        roomId: proxyPath.roomId,
        context: usageContext,
    })
    if (usageContextReferenceError) {
        return usageContextReferenceError
    }
    const usageIdempotencyKey = `provider_proxy:openrouter:${proxyPath.workspaceId}:${proxyPath.roomId}:${usageRequestId}`
    const reservationIdempotencyKey = `openrouter:${proxyPath.workspaceId}:${proxyPath.roomId}:${usageRequestId}`
    const existingUsage = await readHostedProviderUsageSettlementByIdempotencyKey({
        env,
        workspaceId: proxyPath.workspaceId,
        idempotencyKey: usageIdempotencyKey,
    })
    if (existingUsage) {
        try {
            await repairExistingOpenRouterUsageSettlement({
                env,
                workspaceId: proxyPath.workspaceId,
                roomId: proxyPath.roomId,
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
    const responseHeaders = openRouterResponseHeaders(response)
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
            releaseReservationOnDebitFailure: false,
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

async function hostedBraveProxy(
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
    const runtime = await requireHostedRuntimeProviderProxy({
        env,
        request,
        workspaceId: proxyPath.workspaceId,
        roomId: proxyPath.roomId,
    })
    if (runtime instanceof Response) {
        return runtime
    }
    if (!runtime.runtime.managedBraveSearchEnabled) {
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
    const settings = await getHostedWorkspaceSettings({
        env,
        workspaceId: proxyPath.workspaceId,
    })
    const [roomConfig, bindings] = await Promise.all([
        readHostedRoomConfig({
            env,
            workspaceId: proxyPath.workspaceId,
            roomId: proxyPath.roomId,
        }),
        listRoomMcpBindings({
            env,
            workspaceId: proxyPath.workspaceId,
            roomId: proxyPath.roomId,
        }),
    ])
    if (!roomConfig) {
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
    const capabilities = mergeCapabilities({
        defaults: settings.capabilityDefaults,
        overrides: roomConfig.capabilityOverrides,
        roomMode: roomConfig.roomMode,
        mcpConnectionCount: bindings.filter((binding) => binding.enabled).length,
    })
    const search = normalizeSearchConfig(settings.searchConfig, hostedSearchDefaults)
    const braveSecretId = searchProviderSecretId({
        config: settings.searchConfig,
        provider: 'brave',
    })
    if (!capabilities.webSearch || !search.enabled || !search.brave.enabled || braveSecretId) {
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
    return hostedJsonResponse(
        {
            ok: false,
            code: 'managed_provider_cost_unavailable',
        },
        {
            status: 503,
        },
    )
}

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
