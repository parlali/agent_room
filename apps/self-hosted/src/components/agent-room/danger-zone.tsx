import type { ReactNode } from 'react'

import { cn } from '#/lib/utils'

export function DangerZone({
    title,
    description,
    children,
    className,
}: {
    title?: ReactNode
    description?: ReactNode
    children: ReactNode
    className?: string
}) {
    return (
        <section
            data-slot="danger-zone"
            className={cn('rounded-xl border-2 border-danger/40 bg-danger-soft/30', className)}
        >
            {title || description ? (
                <header className="border-b border-danger/20 px-4 py-3">
                    {title ? (
                        <h2 className="text-sm font-semibold tracking-tight text-danger-fg">
                            {title}
                        </h2>
                    ) : null}
                    {description ? (
                        <p className="mt-0.5 text-xs text-danger-fg/80">{description}</p>
                    ) : null}
                </header>
            ) : null}
            <div className="p-4">{children}</div>
        </section>
    )
}

export function DangerZoneItem({
    icon,
    title,
    description,
    action,
}: {
    icon?: ReactNode
    title: ReactNode
    description?: ReactNode
    action: ReactNode
}) {
    return (
        <div className="flex items-center gap-4">
            {icon ? (
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-danger/10 text-danger-fg">
                    {icon}
                </span>
            ) : null}
            <div className="min-w-0 flex-1">
                <h4 className="text-sm font-medium text-foreground">{title}</h4>
                {description ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
                ) : null}
            </div>
            <div className="shrink-0">{action}</div>
        </div>
    )
}
