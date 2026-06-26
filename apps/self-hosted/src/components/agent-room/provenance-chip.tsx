import type { ReactNode } from 'react'

import { cn } from '#/lib/utils'

export function ProvenanceChip({
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
            data-slot="provenance-chip"
            className={cn(
                'inline-flex items-center gap-1 text-xs text-muted-foreground [&>svg]:size-3',
                className,
            )}
        >
            {icon}
            <span className="truncate">{children}</span>
        </span>
    )
}
