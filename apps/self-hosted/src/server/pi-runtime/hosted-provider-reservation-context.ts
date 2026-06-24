import { AsyncLocalStorage } from 'node:async_hooks'
import { openRouterCostMicrosFromProviderText } from '../cloudflare/hosted-provider-proxy'
import { currentToolRunContext } from './tool-run-context'

const hostedOpenRouterProxyMarker = '/api/hosted/runtime/provider/openrouter/v1/'
const usageRequestIdHeader = 'x-agent-room-usage-request-id'
const billingReservationIdHeader = 'x-agent-room-billing-reservation-id'
const usageSessionKeyHeader = 'x-agent-room-session-key'
const usageRunIdHeader = 'x-agent-room-run-id'
const usageJobIdHeader = 'x-agent-room-job-id'

interface HostedProviderRuntimeContext {
    sessionKey: string
    runId?: string | null
    jobId?: string | null
}

interface HostedProviderReservationStore {
    requestIds: Set<string>
    reservationIds: Set<string>
    usageCharges: HostedProviderUsageCharge[]
    usageChargePromises: Set<Promise<void>>
    runtimeContext: HostedProviderRuntimeContext | null
}

export interface HostedProviderReservationCollection {
    reservationIds: string[]
    usageCharges: HostedProviderUsageCharge[]
}

export interface HostedProviderUsageCharge {
    provider: 'openrouter'
    reservationId: string
    costMicros: number
}

const hostedProviderReservationStorage = new AsyncLocalStorage<HostedProviderReservationStore>()
const hostedProviderReservationCollectionSymbol = Symbol('hostedProviderReservationCollection')
let installedFetch: typeof fetch | null = null
let installedRecorder: typeof fetch | null = null

function requestUrl(input: Parameters<typeof fetch>[0]): string | null {
    if (typeof input === 'string') {
        return input
    }
    if (input instanceof URL) {
        return input.toString()
    }
    return input.url
}

function shouldTrackProviderRequest(url: string): boolean {
    try {
        return new URL(url).pathname.includes(hostedOpenRouterProxyMarker)
    } catch {
        return false
    }
}

async function collectOpenRouterUsageCharge(input: {
    response: Response
    reservationId: string
    store: HostedProviderReservationStore
}): Promise<void> {
    if (!input.response.ok) {
        return
    }
    const costMicros = openRouterCostMicrosFromProviderText(await input.response.text())
    if (costMicros === null) {
        return
    }
    input.store.usageCharges.push({
        provider: 'openrouter',
        reservationId: input.reservationId,
        costMicros,
    })
}

function addUsageRequestHeader(
    input: Parameters<typeof fetch>[0],
    init: Parameters<typeof fetch>[1],
    requestId: string,
    runtimeContext: HostedProviderRuntimeContext | null,
): Parameters<typeof fetch> {
    if (input instanceof Request) {
        const headers = new Headers(init?.headers ?? input.headers)
        headers.set(usageRequestIdHeader, requestId)
        addRuntimeContextHeaders(headers, runtimeContext)
        return [new Request(input, { ...init, headers })]
    }
    const headers = new Headers(init?.headers)
    headers.set(usageRequestIdHeader, requestId)
    addRuntimeContextHeaders(headers, runtimeContext)
    return [input, { ...init, headers }]
}

function addRuntimeContextHeaders(
    headers: Headers,
    runtimeContext: HostedProviderRuntimeContext | null,
): void {
    if (!runtimeContext) {
        return
    }
    headers.set(usageSessionKeyHeader, runtimeContext.sessionKey)
    if (runtimeContext.runId) {
        headers.set(usageRunIdHeader, runtimeContext.runId)
    }
    if (runtimeContext.jobId) {
        headers.set(usageJobIdHeader, runtimeContext.jobId)
    }
}

function hostedProviderRuntimeContext(
    explicitContext?: HostedProviderRuntimeContext | null,
): HostedProviderRuntimeContext | null {
    const context = explicitContext ?? currentToolRunContext()
    return context
        ? {
              sessionKey: context.sessionKey,
              runId: context.runId ?? null,
              jobId: context.jobId ?? null,
          }
        : null
}

export function installHostedProviderReservationFetchRecorder(): () => void {
    if (installedFetch) {
        return () => undefined
    }
    installedFetch = globalThis.fetch.bind(globalThis)
    installedRecorder = (async (input, init) => {
        const store = hostedProviderReservationStorage.getStore()
        const url = requestUrl(input)
        if (!store || !url || !shouldTrackProviderRequest(url)) {
            return installedFetch!(input, init)
        }
        const requestId = crypto.randomUUID()
        store.requestIds.add(requestId)
        const response = await installedFetch!(
            ...addUsageRequestHeader(input, init, requestId, store.runtimeContext),
        )
        const reservationId = response.headers.get(billingReservationIdHeader)
        if (reservationId) {
            store.reservationIds.add(reservationId)
            const chargePromise = collectOpenRouterUsageCharge({
                response: response.clone(),
                reservationId,
                store,
            }).catch(() => undefined)
            store.usageChargePromises.add(chargePromise)
        }
        return response
    }) as typeof fetch
    globalThis.fetch = installedRecorder
    return () => {
        if (installedFetch && globalThis.fetch === installedRecorder) {
            globalThis.fetch = installedFetch
        }
        installedFetch = null
        installedRecorder = null
    }
}

export async function withHostedProviderReservationCollection<T>(
    callback: () => Promise<T>,
    runtimeContext?: HostedProviderRuntimeContext | null,
): Promise<{
    result: T
    reservationIds: string[]
    usageCharges: HostedProviderUsageCharge[]
}> {
    const store: HostedProviderReservationStore = {
        requestIds: new Set(),
        reservationIds: new Set(),
        usageCharges: [],
        usageChargePromises: new Set(),
        runtimeContext: hostedProviderRuntimeContext(runtimeContext),
    }
    try {
        const result = await hostedProviderReservationStorage.run(store, callback)
        return {
            result,
            ...(await collectHostedProviderReservationStore(store)),
        }
    } catch (error) {
        const collection = await collectHostedProviderReservationStore(store)
        throw withHostedProviderReservationCollectionError(error, collection)
    }
}

function withHostedProviderReservationCollectionError(
    error: unknown,
    collection: HostedProviderReservationCollection,
): unknown {
    if ((typeof error === 'object' && error !== null) || typeof error === 'function') {
        Object.defineProperty(error, hostedProviderReservationCollectionSymbol, {
            value: collection,
            enumerable: false,
            configurable: true,
        })
        return error
    }
    const wrapped = new Error(typeof error === 'string' ? error : 'Provider request failed', {
        cause: error,
    })
    Object.defineProperty(wrapped, hostedProviderReservationCollectionSymbol, {
        value: collection,
        enumerable: false,
        configurable: true,
    })
    return wrapped
}

async function collectHostedProviderReservationStore(
    store: HostedProviderReservationStore,
): Promise<HostedProviderReservationCollection> {
    await Promise.allSettled([...store.usageChargePromises])
    return {
        reservationIds: Array.from(store.reservationIds).sort(),
        usageCharges: [...store.usageCharges].sort((left, right) =>
            left.reservationId.localeCompare(right.reservationId),
        ),
    }
}

export function hostedProviderReservationCollectionFromError(
    error: unknown,
): HostedProviderReservationCollection | null {
    if ((typeof error !== 'object' || error === null) && typeof error !== 'function') {
        return null
    }
    const value = (error as Record<PropertyKey, unknown>)[hostedProviderReservationCollectionSymbol]
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null
    }
    const record = value as Partial<HostedProviderReservationCollection>
    return {
        reservationIds: Array.isArray(record.reservationIds)
            ? record.reservationIds.filter((id): id is string => typeof id === 'string')
            : [],
        usageCharges: Array.isArray(record.usageCharges)
            ? record.usageCharges.filter(
                  (charge): charge is HostedProviderUsageCharge =>
                      Boolean(charge) &&
                      typeof charge === 'object' &&
                      (charge as HostedProviderUsageCharge).provider === 'openrouter' &&
                      typeof (charge as HostedProviderUsageCharge).reservationId === 'string' &&
                      typeof (charge as HostedProviderUsageCharge).costMicros === 'number',
              )
            : [],
    }
}

export function hostedProviderUsageChargeCostMicros(
    charges: readonly HostedProviderUsageCharge[],
): number | null {
    if (charges.length === 0) {
        return null
    }
    let total = 0
    for (const charge of charges) {
        total += charge.costMicros
    }
    return Number.isSafeInteger(total) && total >= 0 ? total : null
}
