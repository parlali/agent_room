import { useQuery, type UseQueryResult } from '@tanstack/react-query'

export interface HostedBillingPlan {
    key: string
    monthlyCents: number
    includedCents: number
}

export interface HostedBillingUsageEvent {
    id: string
    provider: 'openrouter' | 'brave' | 'browserbase' | 'fetch_url'
    model: string | null
    costMicros: number
    billingStatus: string
    createdAt: string
}

export interface HostedBillingSummary {
    account: {
        stripeCustomerId: string | null
        stripeSubscriptionId: string | null
        planKey: string
        planStatus: string
        includedBalanceCents: number
        purchasedBalanceCents: number
        reservedBalanceCents: number
        availableBalanceCents: number
    }
    plans: HostedBillingPlan[]
    usage: HostedBillingUsageEvent[]
    remainingUsageCents: number
    active: boolean
    providerSources: string[]
}

export type HostedBillingFetch =
    | { status: 'active'; summary: HostedBillingSummary }
    | { status: 'unavailable' }

export const hostedBillingQueryKey = ['hosted-billing'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isJsonResponse(response: Response): boolean {
    return Boolean(response.headers.get('content-type')?.toLowerCase().includes('application/json'))
}

function isHostedBillingPlan(value: unknown): value is HostedBillingPlan {
    if (!isRecord(value)) return false
    return (
        typeof value.key === 'string' &&
        typeof value.monthlyCents === 'number' &&
        typeof value.includedCents === 'number'
    )
}

function isHostedBillingUsageEvent(value: unknown): value is HostedBillingUsageEvent {
    if (!isRecord(value)) return false
    return (
        typeof value.id === 'string' &&
        (value.provider === 'openrouter' ||
            value.provider === 'brave' ||
            value.provider === 'browserbase' ||
            value.provider === 'fetch_url') &&
        (typeof value.model === 'string' || value.model === null) &&
        typeof value.costMicros === 'number' &&
        typeof value.billingStatus === 'string' &&
        typeof value.createdAt === 'string'
    )
}

function isHostedBillingSummary(value: unknown): value is HostedBillingSummary {
    if (!isRecord(value) || !isRecord(value.account)) return false
    return (
        (typeof value.account.stripeCustomerId === 'string' ||
            value.account.stripeCustomerId === null) &&
        (typeof value.account.stripeSubscriptionId === 'string' ||
            value.account.stripeSubscriptionId === null) &&
        typeof value.account.planKey === 'string' &&
        typeof value.account.planStatus === 'string' &&
        typeof value.account.includedBalanceCents === 'number' &&
        typeof value.account.purchasedBalanceCents === 'number' &&
        typeof value.account.reservedBalanceCents === 'number' &&
        typeof value.account.availableBalanceCents === 'number' &&
        Array.isArray(value.plans) &&
        value.plans.every(isHostedBillingPlan) &&
        Array.isArray(value.usage) &&
        value.usage.every(isHostedBillingUsageEvent) &&
        typeof value.remainingUsageCents === 'number' &&
        typeof value.active === 'boolean' &&
        Array.isArray(value.providerSources) &&
        value.providerSources.every((source) => typeof source === 'string')
    )
}

async function fetchHostedBilling(): Promise<HostedBillingFetch> {
    const response = await fetch('/api/hosted/billing', {
        headers: {
            accept: 'application/json',
        },
    })
    if (!response.ok) {
        if (response.status === 404) {
            return { status: 'unavailable' }
        }
        throw new Error(`Billing is temporarily unavailable (status ${response.status})`)
    }
    if (!isJsonResponse(response)) {
        return { status: 'unavailable' }
    }
    const payload = (await response.json()) as unknown
    const billing = isRecord(payload) && isRecord(payload.billing) ? payload.billing : null
    if (!isHostedBillingSummary(billing)) {
        return { status: 'unavailable' }
    }
    return { status: 'active', summary: billing }
}

export function useHostedBillingQuery(): UseQueryResult<HostedBillingFetch> {
    return useQuery<HostedBillingFetch>({
        queryKey: hostedBillingQueryKey,
        retry: false,
        queryFn: fetchHostedBilling,
    })
}

export function hostedAvailableCents(summary: HostedBillingSummary): number {
    return summary.account.availableBalanceCents
}

export function hostedManaged(summary: HostedBillingSummary): boolean {
    return summary.active
}
