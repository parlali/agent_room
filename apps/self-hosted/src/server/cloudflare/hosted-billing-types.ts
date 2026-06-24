import { z } from 'zod'

export const hostedBillingPlanStatuses = [
    'none',
    'incomplete',
    'trialing',
    'active',
    'past_due',
    'canceled',
    'unpaid',
] as const

export const hostedBillingLedgerDirections = ['credit', 'debit'] as const

export const hostedBillingLedgerSources = [
    'subscription_included_credit',
    'included_credit_expiry',
    'stripe_topup',
    'hosted_openrouter_usage',
    'hosted_brave_usage',
    'manual_adjustment',
] as const

export const hostedUsageBillingStatuses = ['not_billable', 'pending', 'debited', 'blocked'] as const
export const hostedBillingReservationStatuses = [
    'authorized',
    'settled',
    'released',
    'expired',
] as const
export const hostedBillingReservationProviders = ['openrouter', 'brave'] as const
export const hostedProviderBillingGateCents = 1

export type HostedBillingPlanStatus = (typeof hostedBillingPlanStatuses)[number]
export type HostedBillingLedgerDirection = (typeof hostedBillingLedgerDirections)[number]
export type HostedBillingLedgerSource = (typeof hostedBillingLedgerSources)[number]
export type HostedUsageBillingStatus = (typeof hostedUsageBillingStatuses)[number]
export type HostedBillingReservationStatus = (typeof hostedBillingReservationStatuses)[number]
export type HostedBillingReservationProvider = (typeof hostedBillingReservationProviders)[number]

export interface HostedBillingAccountSnapshot {
    workspaceId: string
    stripeCustomerId: string | null
    stripeSubscriptionId: string | null
    planKey: string
    planStatus: HostedBillingPlanStatus
    includedBalanceCents: number
    purchasedBalanceCents: number
    currentBalanceCents: number
    includedReservedCents: number
    purchasedReservedCents: number
    reservedBalanceCents: number
    availableBalanceCents: number
    includedMonthlyCreditCents: number
    createdAt: string
    updatedAt: string
}

export interface HostedBillingLedgerEntry {
    id: string
    workspaceId: string
    direction: HostedBillingLedgerDirection
    source: HostedBillingLedgerSource
    amountCents: number
    balanceAfterCents: number
    stripeEventId: string | null
    stripeCheckoutSessionId: string | null
    stripeInvoiceId: string | null
    usageEventId: string | null
    idempotencyKey: string
    metadata: Record<string, unknown>
    createdAt: string
}

export interface HostedBillableUsageEvent {
    id: string
    workspaceId: string
    roomId: string | null
    provider: 'openrouter' | 'brave'
    model: string | null
    costMicros: number
    billingStatus: HostedUsageBillingStatus
    createdAt: string
}

export const hostedBillingCheckoutKindSchema = z.enum(['subscription', 'credit_topup'])
export type HostedBillingCheckoutKind = z.infer<typeof hostedBillingCheckoutKindSchema>

export interface HostedBillingPlan {
    key: string
    priceId: string
    monthlyCents: number
    includedCents: number
}

export type HostedBillingCreditBucket = 'included' | 'purchased'

export type HostedBillingCreditSource = Extract<
    HostedBillingLedgerSource,
    'subscription_included_credit' | 'included_credit_expiry' | 'stripe_topup' | 'manual_adjustment'
>

export function bucketForCreditSource(
    source: HostedBillingCreditSource,
): HostedBillingCreditBucket {
    switch (source) {
        case 'subscription_included_credit':
        case 'included_credit_expiry':
            return 'included'
        case 'stripe_topup':
        case 'manual_adjustment':
            return 'purchased'
    }
}

export function applyUsageMarkupMicros(costMicros: number, markupBps: number): number {
    if (!Number.isSafeInteger(costMicros) || costMicros < 0) {
        throw new Error('Usage cost micros must be a non-negative safe integer')
    }
    if (!Number.isSafeInteger(markupBps) || markupBps < 10000) {
        throw new Error('Usage markup basis points must be an integer of at least 10000 (1.0x)')
    }
    if (costMicros === 0) return 0
    const billedMicros = (BigInt(costMicros) * BigInt(markupBps) + 9999n) / 10000n
    if (billedMicros > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error('Marked-up usage cost exceeds the safe integer range')
    }
    return Number(billedMicros)
}

export function centsFromMicrosCeil(costMicros: number): number {
    if (!Number.isSafeInteger(costMicros) || costMicros < 0) {
        throw new Error('Usage cost micros must be a non-negative safe integer')
    }
    if (costMicros === 0) return 0
    return Math.ceil(costMicros / 10000)
}

export function assertPositiveCents(amountCents: number): void {
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
        throw new Error('Billing amount must be a positive integer cent value')
    }
}
