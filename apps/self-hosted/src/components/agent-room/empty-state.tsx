import type { ReactNode } from 'react'
import { type LucideIcon } from 'lucide-react'

import { cn } from '#/lib/utils'

export function EmptyState({
    icon: Icon,
    title,
    description,
    action,
    className,
}: {
    icon?: LucideIcon
    title: string
    description?: ReactNode
    action?: ReactNode
    className?: string
}) {
    return (
        <div
            data-slot="empty-state"
            className={cn(
                'flex min-h-[14rem] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/70 bg-muted/30 px-6 py-10 text-center',
                className,
            )}
        >
            {Icon ? (
                <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Icon className="size-5" aria-hidden />
                </span>
            ) : null}
            <div className="max-w-sm space-y-1">
                <h3 className="text-sm font-medium text-foreground">{title}</h3>
                {description ? (
                    <p className="text-sm text-muted-foreground">{description}</p>
                ) : null}
            </div>
            {action ? <div className="pt-1">{action}</div> : null}
        </div>
    )
}
