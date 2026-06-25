export const hostedBillingCatalog = {
    currency: 'usd',
    plans: [
        {
            key: 'starter',
            name: 'Starter',
            productId: 'prod_agent_room_starter',
            priceId: 'price_1TmBvCJgXWqhRD0gDStgMIg2',
            lookupKey: 'agent_room_starter_monthly_v1',
            monthlyCents: 700,
            includedCents: 0,
            summary: 'Hosted Agent Room access for BYOK and Codex-backed rooms.',
            managedOpenRouter: true,
            managedBrave: true,
            managedFetchUrl: true,
            managedBrowserbase: false,
        },
        {
            key: 'standard',
            name: 'Standard',
            productId: 'prod_agent_room_standard',
            priceId: 'price_1TmBvEJgXWqhRD0gPZ3rxRcY',
            lookupKey: 'agent_room_standard_monthly_v1',
            monthlyCents: 2000,
            includedCents: 1200,
            summary: 'Hosted rooms with included managed LLM, search, and fetch usage.',
            managedOpenRouter: true,
            managedBrave: true,
            managedFetchUrl: true,
            managedBrowserbase: false,
        },
        {
            key: 'pro',
            name: 'Pro',
            productId: 'prod_agent_room_pro',
            priceId: 'price_1TmBvGJgXWqhRD0gI0vv0POU',
            lookupKey: 'agent_room_pro_monthly_v1',
            monthlyCents: 5000,
            includedCents: 3500,
            summary: 'Higher managed usage with hosted Browserbase access.',
            managedOpenRouter: true,
            managedBrave: true,
            managedFetchUrl: true,
            managedBrowserbase: true,
        },
    ],
    topups: [
        {
            key: 'topup_20_usd',
            name: 'Credit Top-up',
            productId: 'prod_agent_room_topup',
            priceId: 'price_1TmBvIJgXWqhRD0gvEEUUdgv',
            lookupKey: 'agent_room_topup_20_usd_v1',
            amountCents: 2000,
            creditCents: 2000,
        },
    ],
} as const

export type HostedBillingCatalog = typeof hostedBillingCatalog
export type HostedPlanTier = HostedBillingCatalog['plans'][number]
export type HostedPlanKey = HostedPlanTier['key']
export type HostedTopup = HostedBillingCatalog['topups'][number]

export interface HostedBillingPlanConfig {
    key: HostedPlanKey
    priceId: string
    monthlyCents: number
    includedCents: number
}

export const hostedPlanKeys = hostedBillingCatalog.plans.map((plan) => plan.key)

export function hostedBillingPlans(): HostedBillingPlanConfig[] {
    return hostedBillingCatalog.plans.map((plan) => ({
        key: plan.key,
        priceId: plan.priceId,
        monthlyCents: plan.monthlyCents,
        includedCents: plan.includedCents,
    }))
}

export function hostedCreditTopupPriceId(): string {
    return hostedBillingCatalog.topups[0].priceId
}

export function hostedPlanTierByKey(planKey: string | null | undefined): HostedPlanTier | null {
    return hostedBillingCatalog.plans.find((plan) => plan.key === planKey) ?? null
}

export function hostedPlanAllowsManagedBrowserbase(planKey: string | null | undefined): boolean {
    return Boolean(hostedPlanTierByKey(planKey)?.managedBrowserbase)
}

export function hostedPlanAllowsManagedFetchUrl(planKey: string | null | undefined): boolean {
    return Boolean(hostedPlanTierByKey(planKey)?.managedFetchUrl)
}

export function formatHostedUsd(cents: number): string {
    const dollars = cents / 100
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: hostedBillingCatalog.currency.toUpperCase(),
        maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
    }).format(dollars)
}
