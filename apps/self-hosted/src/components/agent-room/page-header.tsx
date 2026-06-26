import type { ReactNode } from 'react'

import { cn } from '#/lib/utils'

export function PageHeader({
    title,
    subtitle,
    eyebrow,
    actions,
    glyph,
    status,
    className,
}: {
    title: ReactNode
    subtitle?: ReactNode
    eyebrow?: ReactNode
    actions?: ReactNode
    glyph?: ReactNode
    status?: ReactNode
    className?: string
}) {
    return (
        <header
            data-slot="page-header"
            className={cn(
                'flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6',
                className,
            )}
        >
            <div className="flex min-w-0 items-center gap-3">
                {glyph ? <div className="shrink-0">{glyph}</div> : null}
                <div className="min-w-0">
                    {eyebrow ? (
                        <div className="mb-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            {eyebrow}
                        </div>
                    ) : null}
                    <div className="flex min-w-0 items-center gap-2">
                        <h1 className="truncate text-lg font-semibold tracking-tight sm:text-xl">
                            {title}
                        </h1>
                        {status ? <span className="shrink-0">{status}</span> : null}
                    </div>
                    {subtitle ? (
                        <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
                    ) : null}
                </div>
            </div>
            {actions ? (
                <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
            ) : null}
        </header>
    )
}
