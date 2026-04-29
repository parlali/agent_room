import type { ReactNode } from 'react'

import { cn } from '#/lib/utils'

export function Section({
    title,
    description,
    actions,
    children,
    className,
    bodyClassName,
}: {
    title?: ReactNode
    description?: ReactNode
    actions?: ReactNode
    children: ReactNode
    className?: string
    bodyClassName?: string
}) {
    return (
        <section
            data-slot="section"
            className={cn('rounded-xl border border-border/70 bg-card', className)}
        >
            {title || description || actions ? (
                <header className="flex items-start justify-between gap-3 border-b border-border/60 px-4 py-3">
                    <div className="min-w-0">
                        {title ? (
                            <h2 className="text-sm font-semibold tracking-tight text-foreground">
                                {title}
                            </h2>
                        ) : null}
                        {description ? (
                            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
                        ) : null}
                    </div>
                    {actions ? (
                        <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
                    ) : null}
                </header>
            ) : null}
            <div className={cn('p-4', bodyClassName)}>{children}</div>
        </section>
    )
}
