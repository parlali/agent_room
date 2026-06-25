import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
    CreditCardIcon,
    GaugeIcon,
    KeyRoundIcon,
    ShieldCheckIcon,
    WalletCardsIcon,
} from 'lucide-react'
import { toast } from 'sonner'

import { EmptyState, PageHeader, Section } from '#/components/agent-room'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { requireRouteUser } from './-route-auth'

interface PlaceholderPlan {
    key: string
    name: string
    monthlyCents: number
    includedCents: number
    summary: string
}

interface HostedBillingPlan {
    key: string
    monthlyCents: number
    includedCents: number
}

interface HostedBillingSummary {
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
    usage: Array<{
        id: string
        provider: 'openrouter' | 'brave'
        model: string | null
        costMicros: number
        billingStatus: string
        createdAt: string
    }>
    remainingUsageCents: number
    providerPriority: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function readJsonRecord(response: Response): Promise<Record<string, unknown>> {
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
        return {}
    }
    const payload = (await response.json()) as unknown
    return isRecord(payload) ? payload : {}
}

function hostedBillingSummaryFromPayload(
    payload: Record<string, unknown>,
): HostedBillingSummary | null {
    return isRecord(payload.billing) ? (payload.billing as unknown as HostedBillingSummary) : null
}

const placeholderPlans: PlaceholderPlan[] = [
    {
        key: 'starter',
        name: 'Starter',
        monthlyCents: 700,
        includedCents: 0,
        summary: 'Subscription access with no included managed usage.',
    },
    {
        key: 'standard',
        name: 'Standard',
        monthlyCents: 2000,
        includedCents: 1200,
        summary: 'Includes monthly hosted usage that resets each cycle.',
    },
    {
        key: 'pro',
        name: 'Pro',
        monthlyCents: 5000,
        includedCents: 3500,
        summary: 'More included monthly hosted usage for heavier workloads.',
    },
]

export const Route = createFileRoute('/billing')({
    beforeLoad: () => requireRouteUser({ requireHostedSubscription: false }),
    component: BillingPage,
})

function formatUsd(cents: number): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
    }).format(cents / 100)
}

function BillingPage() {
    const billingQuery = useQuery<HostedBillingSummary | null>({
        queryKey: ['hosted-billing'],
        retry: false,
        queryFn: async () => {
            const response = await fetch('/api/hosted/billing', {
                headers: {
                    accept: 'application/json',
                },
            })
            if (!response.ok) {
                return null
            }
            return hostedBillingSummaryFromPayload(await readJsonRecord(response))
        },
    })
    const checkoutMutation = useMutation({
        mutationFn: async (
            input: { kind: 'subscription'; planKey: string } | { kind: 'credit_topup' },
        ) => {
            const response = await fetch('/api/hosted/billing/checkout', {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                },
                body: JSON.stringify(input),
            })
            const payload = await readJsonRecord(response)
            const checkout = isRecord(payload.checkout) ? payload.checkout : {}
            const message = typeof payload.message === 'string' ? payload.message : null
            if (!response.ok || typeof checkout.url !== 'string') {
                throw new Error(message ?? 'Checkout is not available')
            }
            return checkout.url
        },
        onSuccess: (url) => {
            window.location.href = url
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : 'Checkout is not available')
        },
    })
    const portalMutation = useMutation({
        mutationFn: async () => {
            const response = await fetch('/api/hosted/billing/portal', {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                },
                body: '{}',
            })
            const payload = await readJsonRecord(response)
            const portal = isRecord(payload.portal) ? payload.portal : {}
            const message = typeof payload.message === 'string' ? payload.message : null
            if (!response.ok || typeof portal.url !== 'string') {
                throw new Error(message ?? 'Billing portal is not available')
            }
            return portal.url
        },
        onSuccess: (url) => {
            window.location.href = url
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : 'Billing portal is not available')
        },
    })
    const hosted = billingQuery.data
    const livePlans = hosted?.plans.map((plan) => ({
        key: plan.key,
        name: plan.key,
        monthlyCents: plan.monthlyCents,
        includedCents: plan.includedCents,
        summary:
            plan.includedCents > 0
                ? 'Includes monthly managed OpenRouter and Brave usage.'
                : 'Subscription access with no included managed usage.',
    }))
    const plans = livePlans?.length ? livePlans : placeholderPlans

    return (
        <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
            <PageHeader
                title="Billing"
                subtitle="Managed OpenRouter and Brave usage draws included credits first, then purchased credits."
            />

            <Section
                title="Plans"
                description="Placeholder tiers. Final pricing and included usage are configured in the hosted deployment."
            >
                <div className="grid gap-3 sm:grid-cols-3">
                    {plans.map((plan) => (
                        <PlanCard
                            key={plan.key}
                            plan={plan}
                            active={hosted?.account.planKey === plan.key}
                            hosted={Boolean(hosted)}
                            onSubscribe={() =>
                                checkoutMutation.mutate({
                                    kind: 'subscription',
                                    planKey: plan.key,
                                })
                            }
                        />
                    ))}
                </div>
                <div className="mt-4 rounded-lg border border-border/70 bg-muted/30 p-3 text-sm text-muted-foreground">
                    Included usage resets monthly and is spent first; it does not carry over.
                    Purchased credits persist and are spent after included usage runs out. Hosted
                    OpenRouter and Brave usage is billed against this balance. VAT is added at
                    checkout where required.
                </div>
            </Section>

            <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                <Section
                    title="Remaining usage"
                    description="In hosted deployments this shows included usage plus purchased credits still available."
                    actions={
                        <Badge variant="outline">
                            {hosted ? hosted.account.planStatus : 'Self-hosted'}
                        </Badge>
                    }
                >
                    <BillingMetric
                        icon={GaugeIcon}
                        label="Available usage"
                        value={hosted ? formatUsd(hosted.remainingUsageCents) : 'Not connected'}
                    />
                    {hosted ? (
                        <div className="mt-3 grid gap-2 sm:grid-cols-3">
                            <BillingMetric
                                icon={WalletCardsIcon}
                                label="Included"
                                value={formatUsd(hosted.account.includedBalanceCents)}
                            />
                            <BillingMetric
                                icon={CreditCardIcon}
                                label="Purchased"
                                value={formatUsd(hosted.account.purchasedBalanceCents)}
                            />
                            <BillingMetric
                                icon={ShieldCheckIcon}
                                label="Reserved"
                                value={formatUsd(hosted.account.reservedBalanceCents)}
                            />
                        </div>
                    ) : null}
                    <div className="mt-4 rounded-lg border border-border/70 bg-muted/30 p-3 text-sm text-muted-foreground">
                        Provider priority is{' '}
                        {hosted?.providerPriority.join(', ') ??
                            'user key, Codex, hosted OpenRouter'}
                        .
                    </div>
                </Section>

                <Section title="Credit safety" description="Hosted provider calls fail closed.">
                    <div className="space-y-3">
                        <div className="flex items-start gap-3">
                            <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-foreground" />
                            <div>
                                <div className="text-sm font-medium">Hard stop at zero</div>
                                <p className="mt-0.5 text-sm text-muted-foreground">
                                    Usage is authorized against the current workspace balance,
                                    drawing included usage before purchased credits, and cannot
                                    persist a negative balance.
                                </p>
                            </div>
                        </div>
                        <div className="flex items-start gap-3">
                            <KeyRoundIcon className="mt-0.5 size-4 shrink-0 text-foreground" />
                            <div>
                                <div className="text-sm font-medium">
                                    Provider choice stays available
                                </div>
                                <p className="mt-0.5 text-sm text-muted-foreground">
                                    A paid subscription unlocks hosted runtime access. Provider
                                    priority remains user key, Codex, then hosted OpenRouter.
                                </p>
                            </div>
                        </div>
                    </div>
                </Section>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
                <Section
                    title="Hosted balance"
                    description="Live balance appears here in hosted deployments."
                    actions={
                        <Badge variant="outline">
                            {hosted ? hosted.account.planKey : 'Not connected locally'}
                        </Badge>
                    }
                >
                    <EmptyState
                        icon={WalletCardsIcon}
                        title={
                            hosted
                                ? 'Hosted billing account'
                                : 'No hosted billing account in this environment'
                        }
                        description={
                            hosted
                                ? 'Use top-ups when included usage runs low.'
                                : 'Hosted billing is available after the Cloudflare hosted deployment is configured.'
                        }
                        action={
                            <div className="flex flex-wrap justify-center gap-2">
                                <Button
                                    variant="outline"
                                    disabled={
                                        !hosted?.account.stripeCustomerId ||
                                        portalMutation.isPending
                                    }
                                    onClick={() => portalMutation.mutate()}
                                >
                                    Manage subscription
                                </Button>
                                <Button
                                    disabled={!hosted || checkoutMutation.isPending}
                                    onClick={() =>
                                        checkoutMutation.mutate({ kind: 'credit_topup' })
                                    }
                                >
                                    Buy credits
                                </Button>
                            </div>
                        }
                    />
                </Section>

                <Section
                    title="Recent billable usage"
                    description="Managed OpenRouter and Brave usage appears here after it is debited."
                >
                    {hosted?.usage.length ? (
                        <div className="divide-y rounded-lg border border-border/70">
                            {hosted.usage.slice(0, 8).map((event) => (
                                <div
                                    key={event.id}
                                    className="flex items-center justify-between gap-3 p-3 text-sm"
                                >
                                    <div>
                                        <div className="font-medium">
                                            {event.provider} {event.model ?? ''}
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                            {new Date(event.createdAt).toLocaleString()} ·{' '}
                                            {event.billingStatus}
                                        </div>
                                    </div>
                                    <div className="font-medium">
                                        {formatUsd(Math.ceil(event.costMicros / 10000))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <EmptyState
                            icon={CreditCardIcon}
                            title="No hosted billable usage"
                            description="Managed OpenRouter and Brave usage will appear here after runs complete."
                        />
                    )}
                </Section>
            </div>
        </div>
    )
}

function PlanCard({
    plan,
    active,
    hosted,
    onSubscribe,
}: {
    plan: PlaceholderPlan
    active: boolean
    hosted: boolean
    onSubscribe: () => void
}) {
    const includedLabel =
        plan.includedCents > 0
            ? `${formatUsd(plan.includedCents)} included usage / month`
            : 'No included managed usage'
    return (
        <div className="flex flex-col rounded-lg border border-border/70 bg-background p-4">
            <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">{plan.name}</div>
                <Badge variant="outline">
                    {active ? 'Current' : hosted ? 'Hosted' : 'Preview'}
                </Badge>
            </div>
            <div className="mt-2 text-2xl font-semibold tracking-tight">
                {formatUsd(plan.monthlyCents)}
                <span className="text-sm font-normal text-muted-foreground"> / month</span>
            </div>
            <div className="mt-1 text-xs font-medium text-muted-foreground">{includedLabel}</div>
            <p className="mt-2 text-sm text-muted-foreground">{plan.summary}</p>
            <div className="mt-3">
                <Button
                    variant="outline"
                    disabled={!hosted || active}
                    className="w-full"
                    onClick={onSubscribe}
                >
                    {active ? 'Current plan' : hosted ? 'Subscribe' : 'Not connected locally'}
                </Button>
            </div>
        </div>
    )
}

function BillingMetric({
    icon: Icon,
    label,
    value,
}: {
    icon: typeof CreditCardIcon
    label: string
    value: string
}) {
    return (
        <div className="rounded-lg border border-border/70 bg-background p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Icon className="size-4" />
                {label}
            </div>
            <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
        </div>
    )
}
