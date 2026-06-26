import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
    formatHostedUsd,
    hostedBillingCatalog,
    hostedCreditTopupCreditCents,
    hostedPlanHighlights,
    isHostedBalanceLow,
    type HostedPlanTier,
} from '@agent-room/billing'
import { useMutation } from '@tanstack/react-query'
import { CheckIcon, ChevronDownIcon, Loader2Icon, RefreshCwIcon, WalletCardsIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import {
    AttentionBanner,
    EmptyState,
    Page,
    PageHeader,
    Section,
    StateBadge,
    Stat,
    StatGrid,
} from '#/components/agent-room'
import { Button } from '#/components/ui/button'
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from '#/components/ui/collapsible'
import { usageProviderLabel } from '#/domain/capability-labels'
import { formatDateTime } from '#/domain/format'
import type { Tone } from '#/domain/state'
import { requireRouteUser } from './-route-auth'
import { ManagedCreditsBadge } from './-billing/managed-badge'
import {
    hostedAvailableCents,
    hostedManaged,
    useHostedBillingQuery,
    type HostedBillingSummary,
    type HostedBillingUsageEvent,
} from './-billing/billing-data'

const activationTimeoutMs = 30000

type BillingCheckoutResult = 'subscription_success' | 'topup_success' | 'cancel'

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

export const Route = createFileRoute('/billing')({
    beforeLoad: () => requireRouteUser({ requireHostedSubscription: false }),
    validateSearch: (search: Record<string, unknown>): { checkout: BillingCheckoutResult | null } => ({
        checkout:
            search.checkout === 'subscription_success' ||
            search.checkout === 'topup_success' ||
            search.checkout === 'cancel'
                ? search.checkout
                : null,
    }),
    component: BillingPage,
})

function BillingPage() {
    const billingQuery = useHostedBillingQuery()
    const summary =
        billingQuery.data?.status === 'active' ? billingQuery.data.summary : null

    const header = (
        <PageHeader
            title="Billing"
            subtitle="Usage and credits for your managed AI rooms."
            status={summary ? <ManagedCreditsBadge managed={hostedManaged(summary)} /> : undefined}
            actions={summary ? <BillingHeaderActions summary={summary} /> : undefined}
        />
    )

    if (billingQuery.isLoading) {
        return (
            <Page width="lg" header={header}>
                <BillingLoading />
            </Page>
        )
    }

    if (billingQuery.isError) {
        return (
            <Page width="lg" header={header}>
                <AttentionBanner
                    tone="danger"
                    title="Billing is temporarily unavailable"
                    description="We could not load your billing account. This is a temporary problem, not a change to your plan."
                    action={
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => billingQuery.refetch()}
                            disabled={billingQuery.isFetching}
                        >
                            {billingQuery.isFetching ? 'Retrying...' : 'Retry'}
                        </Button>
                    }
                />
            </Page>
        )
    }

    if (!summary) {
        return (
            <Page width="lg" header={header}>
                <EmptyState
                    icon={WalletCardsIcon}
                    title="Billing is not available here"
                    description="This workspace does not include managed credits. Rooms run on the model access configured for this deployment."
                />
            </Page>
        )
    }

    return (
        <Page width="lg" header={header}>
            <BillingActiveContent summary={summary} refetch={billingQuery.refetch} />
        </Page>
    )
}

function BillingLoading() {
    return (
        <div className="flex flex-col gap-4">
            <Section title="Available credits">
                <Stat label="Available" value="..." />
            </Section>
            <Section title="Plans">
                <div className="grid gap-3 sm:grid-cols-3">
                    {hostedBillingCatalog.plans.map((plan) => (
                        <div
                            key={plan.key}
                            className="h-40 animate-pulse rounded-lg border border-border/60 bg-muted/40"
                        />
                    ))}
                </div>
            </Section>
        </div>
    )
}

function BillingHeaderActions({ summary }: { summary: HostedBillingSummary }) {
    const checkoutMutation = useBillingCheckout()
    const portalMutation = useBillingPortal()
    const topupCredits = formatHostedUsd(hostedCreditTopupCreditCents())
    return (
        <>
            <Button
                variant="outline"
                size="sm"
                disabled={!summary.account.stripeCustomerId || portalMutation.isPending}
                onClick={() => portalMutation.mutate()}
            >
                Manage subscription
            </Button>
            <Button
                size="sm"
                disabled={checkoutMutation.isPending}
                onClick={() => checkoutMutation.mutate({ kind: 'credit_topup' })}
            >
                Buy {topupCredits} credits
            </Button>
        </>
    )
}

function BillingActiveContent({
    summary,
    refetch,
}: {
    summary: HostedBillingSummary
    refetch: () => void
}) {
    const search = Route.useSearch()
    const navigate = useNavigate()
    const checkoutMutation = useBillingCheckout()
    const [activationTimedOut, setActivationTimedOut] = useState(false)

    const available = hostedAvailableCents(summary)
    const low = isHostedBalanceLow(available)
    const subscriptionReturned = search.checkout === 'subscription_success'
    const awaitingActivation = subscriptionReturned && !summary.active

    useEffect(() => {
        if (search.checkout !== 'topup_success' && search.checkout !== 'cancel') return
        if (search.checkout === 'topup_success') {
            toast.success('Credits added to your account')
            void refetch()
        } else {
            toast.message('Checkout canceled', {
                description: 'No charge was made.',
            })
        }
        void navigate({ to: '/billing', search: { checkout: null }, replace: true })
    }, [search.checkout, navigate, refetch])

    useEffect(() => {
        if (!awaitingActivation) return
        const startedAt = Date.now()
        const interval = window.setInterval(() => {
            if (Date.now() - startedAt >= activationTimeoutMs) {
                setActivationTimedOut(true)
                window.clearInterval(interval)
                return
            }
            void refetch()
        }, 1500)
        return () => window.clearInterval(interval)
    }, [awaitingActivation, refetch])

    useEffect(() => {
        if (subscriptionReturned && summary.active) {
            void navigate({ to: '/onboarding', replace: true })
        }
    }, [subscriptionReturned, summary.active, navigate])

    return (
        <div className="flex flex-col gap-4">
            {awaitingActivation ? (
                <AttentionBanner
                    tone={activationTimedOut ? 'attention' : 'info'}
                    title={
                        activationTimedOut
                            ? 'This is taking longer than expected'
                            : 'Activating your subscription'
                    }
                    description={
                        activationTimedOut
                            ? 'Your payment went through but activation has not confirmed yet. Refresh in a moment, or contact support if this persists.'
                            : 'Your payment completed. We are confirming your subscription.'
                    }
                    action={
                        activationTimedOut ? (
                            <Button variant="outline" size="sm" onClick={() => void refetch()}>
                                <RefreshCwIcon /> Refresh
                            </Button>
                        ) : (
                            <Loader2Icon className="size-4 animate-spin" aria-hidden />
                        )
                    }
                />
            ) : null}

            {low ? (
                <AttentionBanner
                    tone="attention"
                    title="You are running low on credits"
                    description="Top up to keep your rooms working without interruption."
                    action={
                        <Button
                            size="sm"
                            disabled={checkoutMutation.isPending}
                            onClick={() => checkoutMutation.mutate({ kind: 'credit_topup' })}
                        >
                            Buy credits
                        </Button>
                    }
                />
            ) : null}

            <Section title="Available credits" description="What you have left to spend on AI rooms.">
                <Stat
                    label="Available"
                    value={formatHostedUsd(available)}
                    tone={low ? 'danger' : undefined}
                    hint="Included usage is spent first, then purchased credits."
                />
                <BalanceDetails summary={summary} />
            </Section>

            <Section title="Plans" description="Pick the monthly usage and capabilities you need.">
                <div className="grid gap-3 sm:grid-cols-3">
                    {hostedBillingCatalog.plans.map((plan) => (
                        <PlanCard
                            key={plan.key}
                            plan={plan}
                            current={summary.account.planKey === plan.key}
                            onSubscribe={() =>
                                checkoutMutation.mutate({
                                    kind: 'subscription',
                                    planKey: plan.key,
                                })
                            }
                            disabled={checkoutMutation.isPending}
                        />
                    ))}
                </div>
            </Section>

            <Section
                title="Recent usage"
                description="Charges against your credits, newest first."
            >
                <BillingUsageList events={summary.usage} />
            </Section>

            <AdvancedDisclosure summary={summary} />
        </div>
    )
}

function BalanceDetails({ summary }: { summary: HostedBillingSummary }) {
    const [open, setOpen] = useState(false)
    return (
        <Collapsible open={open} onOpenChange={setOpen} className="mt-3">
            <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1 px-2 text-muted-foreground">
                    <ChevronDownIcon
                        className={`transition-transform ${open ? 'rotate-180' : ''}`}
                    />
                    {open ? 'Hide details' : 'Show details'}
                </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3">
                <StatGrid className="sm:grid-cols-3 lg:grid-cols-3">
                    <Stat
                        label="Included this month"
                        value={formatHostedUsd(summary.account.includedBalanceCents)}
                    />
                    <Stat
                        label="Purchased credits"
                        value={formatHostedUsd(summary.account.purchasedBalanceCents)}
                    />
                    <Stat
                        label="Reserved"
                        value={formatHostedUsd(summary.account.reservedBalanceCents)}
                        hint="Held for runs in progress."
                    />
                </StatGrid>
                <p className="mt-3 text-sm text-muted-foreground">
                    Included usage resets monthly and is spent first. Purchased credits carry over and
                    are spent after included usage runs out.
                </p>
            </CollapsibleContent>
        </Collapsible>
    )
}

function PlanCard({
    plan,
    current,
    onSubscribe,
    disabled,
}: {
    plan: HostedPlanTier
    current: boolean
    onSubscribe: () => void
    disabled: boolean
}) {
    const highlights = hostedPlanHighlights(plan.key)
    return (
        <div className="flex flex-col rounded-lg border border-border/70 bg-background p-4">
            <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">{plan.name}</div>
                {current ? <StateBadge tone="ready" label="Current" /> : null}
            </div>
            <div className="mt-2 text-2xl font-semibold tracking-tight">
                {formatHostedUsd(plan.monthlyCents)}
                <span className="text-sm font-normal text-muted-foreground"> / month</span>
            </div>
            <ul className="mt-3 flex flex-1 flex-col gap-1.5">
                {highlights.map((highlight) => (
                    <li
                        key={highlight}
                        className="flex items-start gap-2 text-sm text-muted-foreground"
                    >
                        <CheckIcon className="mt-0.5 size-4 shrink-0 text-ready-fg" />
                        <span className="min-w-0">{highlight}</span>
                    </li>
                ))}
            </ul>
            <div className="mt-4">
                <Button
                    variant="outline"
                    disabled={current || disabled}
                    className="w-full"
                    onClick={onSubscribe}
                >
                    {current ? 'Current plan' : 'Choose plan'}
                </Button>
            </div>
        </div>
    )
}

function billingStatusTone(status: string): { tone: Tone; label: string } {
    if (status === 'debited') return { tone: 'ready', label: 'Charged' }
    if (status === 'pending') return { tone: 'working', label: 'Pending' }
    if (status === 'blocked') return { tone: 'danger', label: 'Blocked' }
    if (status === 'not_billable') return { tone: 'muted', label: 'No charge' }
    return { tone: 'muted', label: 'Recorded' }
}

function BillingUsageList({ events }: { events: HostedBillingUsageEvent[] }) {
    if (!events.length) {
        return (
            <EmptyState
                icon={WalletCardsIcon}
                title="No usage yet"
                description="Charges appear here after your rooms do managed work."
            />
        )
    }
    return (
        <div className="divide-y rounded-lg border border-border/70">
            {events.slice(0, 8).map((event) => {
                const status = billingStatusTone(event.billingStatus)
                return (
                    <div
                        key={event.id}
                        className="flex items-center justify-between gap-3 p-3 text-sm"
                    >
                        <div className="min-w-0 flex-1">
                            <div className="truncate font-medium">
                                {usageProviderLabel(event.provider)}
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <span>{formatDateTime(event.createdAt)}</span>
                                <StateBadge tone={status.tone} label={status.label} />
                            </div>
                        </div>
                        <div className="shrink-0 font-medium tabular-nums">
                            {formatHostedUsd(Math.ceil(event.costMicros / 10000))}
                        </div>
                    </div>
                )
            })}
        </div>
    )
}

function AdvancedDisclosure({ summary }: { summary: HostedBillingSummary }) {
    const [open, setOpen] = useState(false)
    return (
        <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1 px-2 text-muted-foreground">
                    <ChevronDownIcon
                        className={`transition-transform ${open ? 'rotate-180' : ''}`}
                    />
                    Advanced
                </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
                <Section
                    title="Bring your own key"
                    description="By default your rooms use Agent Room's managed model and web access, drawn from your credits."
                >
                    <p className="text-sm text-muted-foreground">
                        You can connect your own model key in room settings. When a key is present it
                        is used first, before managed credits.
                    </p>
                    {summary.providerSources.length ? (
                        <p className="mt-3 text-xs text-muted-foreground">
                            Model routing order: {summary.providerSources.join(', ')}.
                        </p>
                    ) : null}
                </Section>
            </CollapsibleContent>
        </Collapsible>
    )
}

function useBillingCheckout() {
    return useMutation({
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
}

function useBillingPortal() {
    return useMutation({
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
}
