import type { ReactNode } from 'react'

import { cn } from '#/lib/utils'

export type PageWidth = 'sm' | 'md' | 'lg' | 'xl' | 'full'

const pageWidth: Record<PageWidth, string> = {
    sm: 'max-w-2xl',
    md: 'max-w-3xl',
    lg: 'max-w-5xl',
    xl: 'max-w-7xl',
    full: 'max-w-none',
}

export function Page({
    width = 'lg',
    header,
    subnav,
    children,
    className,
    bodyClassName,
}: {
    width?: PageWidth
    header?: ReactNode
    subnav?: ReactNode
    children: ReactNode
    className?: string
    bodyClassName?: string
}) {
    const aligned = cn('mx-auto w-full px-4 sm:px-6', pageWidth[width])
    return (
        <div className={cn('flex min-h-full flex-col', className)}>
            {header || subnav ? (
                <div className="sticky top-0 z-20 border-b border-border/60 bg-background/95 backdrop-blur">
                    {header ? <div className={aligned}>{header}</div> : null}
                    {subnav ? <div className={cn(aligned, 'pb-2')}>{subnav}</div> : null}
                </div>
            ) : null}
            <div className={cn(aligned, 'flex-1 py-6', bodyClassName)}>{children}</div>
        </div>
    )
}
