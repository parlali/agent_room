import type { ReactNode } from 'react'

import { cn } from '#/lib/utils'

export interface KeyValueItem {
    label: ReactNode
    value: ReactNode
    hint?: ReactNode
}

export function KeyValueList({
    items,
    className,
    layout = 'rows',
}: {
    items: KeyValueItem[]
    className?: string
    layout?: 'rows' | 'columns'
}) {
    if (layout === 'columns') {
        return (
            <dl
                className={cn('grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3', className)}
            >
                {items.map((item, i) => (
                    <div key={i} className="min-w-0">
                        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            {item.label}
                        </dt>
                        <dd className="mt-1 truncate text-foreground">{item.value}</dd>
                        {item.hint ? (
                            <div className="mt-0.5 text-xs text-muted-foreground">{item.hint}</div>
                        ) : null}
                    </div>
                ))}
            </dl>
        )
    }

    return (
        <dl className={cn('divide-y divide-border/60 text-sm', className)}>
            {items.map((item, i) => (
                <div
                    key={i}
                    className="flex items-start justify-between gap-4 py-2.5 first:pt-0 last:pb-0"
                >
                    <dt className="min-w-0 shrink-0 text-muted-foreground">{item.label}</dt>
                    <dd className="min-w-0 flex-1 text-right">
                        <div className="truncate text-foreground">{item.value}</div>
                        {item.hint ? (
                            <div className="mt-0.5 text-xs text-muted-foreground">{item.hint}</div>
                        ) : null}
                    </dd>
                </div>
            ))}
        </dl>
    )
}
