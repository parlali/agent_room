import type { ReactNode } from 'react'

import { cn } from '#/lib/utils'

export function Chip({
    icon,
    children,
    className,
}: {
    icon?: ReactNode
    children: ReactNode
    className?: string
}) {
    return (
        <span
            data-slot="chip"
            className={cn(
                'inline-flex items-center gap-1 rounded-md border border-border bg-card px-1.5 py-0.5 text-xs font-medium text-muted-foreground',
                className,
            )}
        >
            {icon ? <span className="shrink-0 [&>svg]:size-3">{icon}</span> : null}
            <span className="truncate">{children}</span>
        </span>
    )
}
