import { formatHostedUsd } from '@agent-room/billing'
import { Stat, StatGrid } from '#/components/agent-room'
import { formatDurationMs, formatTokens } from '#/domain/format'

function formatUsageCost(usd: number): string {
    return formatHostedUsd(usd * 100)
}

function formatCount(value: number | null): string {
    return value === null ? 'Not reported' : value.toLocaleString()
}

export function UsageTotalsGrid({
    totals,
}: {
    totals?: {
        eventCount?: number | null
        durationMs?: number | null
        totalTokens?: number | null
        estimatedCostUsd?: number | null
    } | null
}) {
    return (
        <StatGrid className="sm:grid-cols-4 lg:grid-cols-4">
            <Stat label="Activities" value={formatCount(totals?.eventCount ?? null)} />
            <Stat label="Runtime" value={formatDurationMs(totals?.durationMs ?? null)} />
            <Stat
                label="Tokens"
                value={
                    totals?.totalTokens === null || totals?.totalTokens === undefined
                        ? 'Not reported'
                        : formatTokens(totals.totalTokens)
                }
            />
            <Stat
                label="Estimated cost"
                hint="Estimate. Charged credits appear on Billing."
                value={
                    totals?.estimatedCostUsd === null || totals?.estimatedCostUsd === undefined
                        ? 'Not reported'
                        : formatUsageCost(totals.estimatedCostUsd)
                }
            />
        </StatGrid>
    )
}
