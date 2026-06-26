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
    if (!billing) {
        return { status: 'unavailable' }
    }
    return { status: 'active', summary: billing as unknown as HostedBillingSummary }
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
