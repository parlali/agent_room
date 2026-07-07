import { formatHostedUsd } from '@agent-room/billing'

import { Progress } from '#/components/ui/progress'
import { toneStyles } from '#/domain/state'
import type { HostedBillingSummary } from './billing-data'

const warningFraction = 0.8

function barToneClass(fraction: number): string {
    if (fraction >= 1) return '[&_[data-slot=progress-indicator]]:bg-danger'
    if (fraction >= warningFraction) return '[&_[data-slot=progress-indicator]]:bg-attention'
    return ''
}

function PurchasedCreditLine({ purchasedRemainingCents }: { purchasedRemainingCents: number }) {
    if (purchasedRemainingCents <= 0) return null
    return (
        <p className="text-sm text-muted-foreground">
            +{formatHostedUsd(purchasedRemainingCents)} purchased credit available
        </p>
    )
}

export function MonthlyUsageMeter({ summary }: { summary: HostedBillingSummary }) {
    const grantCents = Math.max(0, summary.includedMonthlyCents)
    const includedRemainingCents = Math.max(0, Math.min(summary.includedRemainingCents, grantCents))
    const purchasedRemainingCents = Math.max(0, summary.purchasedRemainingCents)

    if (grantCents <= 0) {
        return (
            <div className="flex flex-col gap-1">
                {purchasedRemainingCents > 0 ? (
                    <PurchasedCreditLine purchasedRemainingCents={purchasedRemainingCents} />
                ) : (
                    <p className="text-sm text-muted-foreground">
                        Your plan does not include monthly usage. Add credits to run managed work.
                    </p>
                )}
            </div>
        )
    }

    const usedCents = Math.max(0, Math.min(grantCents - includedRemainingCents, grantCents))
    const fraction = usedCents / grantCents
    const warning = fraction >= warningFraction

    return (
        <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <div className="text-2xl font-semibold tracking-tight tabular-nums">
                    {formatHostedUsd(includedRemainingCents)}
                    <span className="ml-1.5 text-sm font-normal text-muted-foreground">
                        remaining this month
                    </span>
                </div>
                <span
                    className={`text-sm tabular-nums ${warning ? toneStyles.attention.text : 'text-muted-foreground'}`}
                >
                    {formatHostedUsd(usedCents)} of {formatHostedUsd(grantCents)} used this month
                </span>
            </div>
            <Progress
                value={usedCents}
                max={grantCents}
                className={`h-2 ${barToneClass(fraction)}`}
                aria-label="Included monthly usage"
            />
            <PurchasedCreditLine purchasedRemainingCents={purchasedRemainingCents} />
        </div>
    )
}
