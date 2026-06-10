import type { ReactNode } from 'react'

import { cn } from '#/lib/utils'

export function PageHeader({
    title,
    subtitle,
    eyebrow,
    actions,
    glyph,
    className,
}: {
    title: ReactNode
    subtitle?: ReactNode
    eyebrow?: ReactNode
    actions?: ReactNode
    glyph?: ReactNode
    className?: string
}) {
    return (
        <header
            data-slot="page-header"
            className={cn(
                'flex flex-col gap-3 border-b border-border/60 px-6 py-5 sm:flex-row sm:items-start sm:justify-between sm:gap-6',
                className,
            )}
        >
            <div className="flex min-w-0 items-start gap-3">
                {glyph ? <div className="shrink-0">{glyph}</div> : null}
                <div className="min-w-0">
                    {eyebrow ? (
                        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            {eyebrow}
                        </div>
                    ) : null}
                    <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">
                        {title}
                    </h1>
                    {subtitle ? (
                        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
                    ) : null}
                </div>
            </div>
            {actions ? (
                <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
            ) : null}
        </header>
    )
}
