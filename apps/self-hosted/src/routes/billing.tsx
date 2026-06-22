import { createFileRoute } from '@tanstack/react-router'
import {
    CreditCardIcon,
    GaugeIcon,
    KeyRoundIcon,
    ShieldCheckIcon,
    WalletCardsIcon,
} from 'lucide-react'

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

const placeholderPlans: PlaceholderPlan[] = [
    {
        key: 'starter',
        name: 'Starter',
        monthlyCents: 700,
        includedCents: 0,
        summary: 'Bring your own provider keys. No included hosted usage.',
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
    beforeLoad: requireRouteUser,
    component: BillingPage,
})

function formatUsd(cents: number): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
    }).format(cents / 100)
}

function BillingPage() {
    return (
        <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
            <PageHeader
                title="Billing"
                subtitle="Hosted billing uses placeholder pricing until plans are finalized. Values shown here are illustrative."
            />

            <Section
                title="Plans"
                description="Placeholder tiers. Final pricing and included usage are configured in the hosted deployment."
            >
                <div className="grid gap-3 sm:grid-cols-3">
                    {placeholderPlans.map((plan) => (
                        <PlanCard key={plan.key} plan={plan} />
                    ))}
                </div>
                <div className="mt-4 rounded-lg border border-border/70 bg-muted/30 p-3 text-sm text-muted-foreground">
                    Included usage resets monthly and is spent first; it does not carry over.
                    Purchased credits persist and are spent after included usage runs out. Hosted
                    provider usage is billed at a managed rate, while bring-your-own providers pay
                    provider cost directly. VAT is added at checkout where required.
                </div>
            </Section>

            <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                <Section
                    title="Remaining usage"
                    description="In hosted deployments this shows included usage plus purchased credits still available."
                    actions={<Badge variant="outline">Not connected locally</Badge>}
                >
                    <BillingMetric
                        icon={GaugeIcon}
                        label="Remaining usage placeholder"
                        value="Not connected locally"
                    />
                    <div className="mt-4 rounded-lg border border-border/70 bg-muted/30 p-3 text-sm text-muted-foreground">
                        Live remaining usage appears here from the hosted billing endpoint once a
                        hosted deployment is connected.
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
                                    BYO providers stay available
                                </div>
                                <p className="mt-0.5 text-sm text-muted-foreground">
                                    Provider priority remains Codex, user key, then hosted
                                    OpenRouter when balance is available.
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
                    actions={<Badge variant="outline">Not connected locally</Badge>}
                >
                    <EmptyState
                        icon={WalletCardsIcon}
                        title="No hosted billing account in this environment"
                        description="Self-hosted deployments can keep billing disabled or provide their own implementation behind the hosted billing contract."
                        action={
                            <div className="flex flex-wrap justify-center gap-2">
                                <Button variant="outline" disabled>
                                    Manage subscription
                                </Button>
                                <Button disabled>Buy credits</Button>
                            </div>
                        }
                    />
                </Section>

                <Section
                    title="Recent billable usage"
                    description="Hosted usage is billed at a managed rate; BYO providers pay provider cost directly."
                >
                    <EmptyState
                        icon={CreditCardIcon}
                        title="No hosted billable usage"
                        description="Hosted provider usage will appear here after the hosted route layer is enabled for this deployment."
                    />
                </Section>
            </div>
        </div>
    )
}

function PlanCard({ plan }: { plan: PlaceholderPlan }) {
    const includedLabel =
        plan.includedCents > 0
            ? `${formatUsd(plan.includedCents)} included usage / month`
            : 'No included usage (bring your own keys)'
    return (
        <div className="flex flex-col rounded-lg border border-border/70 bg-background p-4">
            <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">{plan.name}</div>
                <Badge variant="outline">Placeholder</Badge>
            </div>
            <div className="mt-2 text-2xl font-semibold tracking-tight">
                {formatUsd(plan.monthlyCents)}
                <span className="text-sm font-normal text-muted-foreground"> / month</span>
            </div>
            <div className="mt-1 text-xs font-medium text-muted-foreground">{includedLabel}</div>
            <p className="mt-2 text-sm text-muted-foreground">{plan.summary}</p>
            <div className="mt-3">
                <Button variant="outline" disabled className="w-full">
                    Not connected locally
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
