import type { ReactNode } from 'react'

import { cn } from '#/lib/utils'

export function NavTabBar({
    children,
    className,
    ...props
}: { children: ReactNode; className?: string } & React.ComponentProps<'nav'>) {
    return (
        <nav
            data-slot="nav-tab-bar"
            className={cn(
                'flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
                className,
            )}
            {...props}
        >
            {children}
        </nav>
    )
}

export function navTabClass(active: boolean): string {
    return cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&>svg]:size-4',
        active
            ? 'bg-secondary text-foreground'
            : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
    )
}

export function BottomTabBar({ children, className }: { children: ReactNode; className?: string }) {
    return (
        <nav
            data-slot="bottom-tab-bar"
            className={cn(
                'flex items-stretch justify-around border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur',
                className,
            )}
        >
            {children}
        </nav>
    )
}

export function bottomTabClass(active: boolean): string {
    return cn(
        'flex flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[0.6875rem] font-medium transition-colors outline-none [&>svg]:size-5',
        active ? 'text-foreground' : 'text-muted-foreground',
    )
}
