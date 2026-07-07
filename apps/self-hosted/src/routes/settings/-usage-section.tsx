import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { hostedPlanTierByKey, isHostedBalanceLow } from '@agent-room/billing'
import { AttentionBanner, LoadingRows, Section, Stat } from '#/components/agent-room'
import { Button } from '#/components/ui/button'
import { roomQueryKey, roomQueryPolicy } from '#/lib/room-query-keys'
import { listUsageServer } from '../-room-runtime-server'
import { UsageTotalsGrid } from '../-usage/usage-components'
import {
    hostedAvailableCents,
    hostedManaged,
    useHostedBillingQuery,
} from '../-billing/billing-data'
import { ManagedCreditsBadge } from '../-billing/managed-badge'
import { MonthlyUsageMeter } from '../-billing/monthly-usage'

function HostedCreditsSummary() {
    const billingQuery = useHostedBillingQuery()
    const summary = billingQuery.data?.status === 'active' ? billingQuery.data.summary : null

    if (billingQuery.isLoading) {
        return (
            <Section title="Plan and credits">
                <LoadingRows count={1} />
            </Section>
        )
    }
    if (billingQuery.isError) {
        return (
            <Section title="Plan and credits">
                <AttentionBanner
                    tone="danger"
                    title="Could not load plan and credits"
                    description="This is a temporary problem. Retry to load your plan and credit balance."
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
            </Section>
        )
    }
    if (!summary) {
        return null
    }

    const available = hostedAvailableCents(summary)
    const low = isHostedBalanceLow(available)
    return (
        <Section
            title="Plan and credits"
            description="Everyday chatting is included. Heavier work draws from your credits."
            actions={
                <div className="flex items-center gap-2">
                    <ManagedCreditsBadge managed={hostedManaged(summary)} />
                    <Button asChild variant="outline" size="sm">
                        <Link to="/billing" search={{ checkout: null }}>
                            Manage billing
                        </Link>
                    </Button>
                </div>
            }
        >
            <div className="flex flex-col gap-3">
                {low ? (
                    <AttentionBanner
                        tone="attention"
                        title="You are running low on credits"
                        description="Top up on the billing page to keep your rooms working without interruption."
                    />
                ) : null}
                <MonthlyUsageMeter summary={summary} />
                <Stat
                    label="Plan"
                    value={hostedPlanTierByKey(summary.account.planKey)?.name ?? 'No plan'}
                />
            </div>
        </Section>
    )
}

export function UsageBillingSection({ hosted }: { hosted: boolean }) {
    const usageQuery = useQuery({
        queryKey: roomQueryKey.globalUsage(300),
        queryFn: () => listUsageServer({ data: { limit: 300 } }),
        staleTime: roomQueryPolicy.warmStaleMs,
    })

    const totals = usageQuery.data?.totals

    return (
        <div className="flex flex-col gap-5">
            {hosted ? <HostedCreditsSummary /> : null}

            {usageQuery.isError ? (
                <AttentionBanner
                    tone="danger"
                    title="Could not load usage"
                    description="This is a temporary problem. Retry to load your workspace usage."
                    action={
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => usageQuery.refetch()}
                            disabled={usageQuery.isFetching}
                        >
                            {usageQuery.isFetching ? 'Retrying...' : 'Retry'}
                        </Button>
                    }
                />
            ) : null}

            <Section title="Totals" description="Across every room in your workspace.">
                {usageQuery.isLoading ? (
                    <LoadingRows count={2} />
                ) : (
                    <UsageTotalsGrid totals={totals} />
                )}
            </Section>
        </div>
    )
}
