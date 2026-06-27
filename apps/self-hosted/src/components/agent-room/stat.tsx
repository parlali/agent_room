import type { ReactNode } from 'react'

import { cn } from '#/lib/utils'
import { toneStyles, type Tone } from '#/domain/state'

export function Stat({
    label,
    value,
    hint,
    icon,
    tone,
    className,
}: {
    label: ReactNode
    value: ReactNode
    hint?: ReactNode
    icon?: ReactNode
    tone?: Tone
    className?: string
}) {
    return (
        <div
            data-slot="stat"
            className={cn(
                'flex flex-col gap-1 rounded-xl border border-border/70 bg-card p-3',
                className,
            )}
        >
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                {icon ? <span className="shrink-0 [&>svg]:size-3.5">{icon}</span> : null}
                <span className="truncate">{label}</span>
            </div>
            <div
                className={cn(
                    'text-lg font-semibold tracking-tight tabular-nums',
                    tone ? toneStyles[tone].text : 'text-foreground',
                )}
            >
                {value}
            </div>
            {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
        </div>
    )
}

export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
    return (
        <div
            data-slot="stat-grid"
            className={cn('grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4', className)}
        >
            {children}
        </div>
    )
}
