import { Link, useRouterState } from '@tanstack/react-router'
import {
    ActivityIcon,
    BarChart3Icon,
    CalendarClockIcon,
    FolderIcon,
    HomeIcon,
    SettingsIcon,
} from 'lucide-react'

import { cn } from '#/lib/utils'

const ITEMS = [
    {
        to: '/',
        label: 'Rooms',
        icon: HomeIcon,
        match: (p: string) => p === '/' || p.startsWith('/rooms'),
    },
    {
        to: '/activity',
        label: 'Activity',
        icon: ActivityIcon,
        match: (p: string) => p === '/activity',
    },
    { to: '/jobs', label: 'Jobs', icon: CalendarClockIcon, match: (p: string) => p === '/jobs' },
    { to: '/files', label: 'Files', icon: FolderIcon, match: (p: string) => p === '/files' },
    { to: '/usage', label: 'Usage', icon: BarChart3Icon, match: (p: string) => p === '/usage' },
    {
        to: '/settings',
        label: 'Settings',
        icon: SettingsIcon,
        match: (p: string) => p.startsWith('/settings'),
    },
] as const

export function MobileBottomNav() {
    const pathname = useRouterState({ select: (s) => s.location.pathname })
    return (
        <nav className="fixed inset-x-0 bottom-0 z-30 grid h-14 grid-cols-6 border-t border-border bg-background/95 backdrop-blur md:hidden">
            {ITEMS.map((item) => {
                const Icon = item.icon
                const active = item.match(pathname)
                return (
                    <Link
                        key={item.to}
                        to={item.to}
                        className={cn(
                            'flex flex-col items-center justify-center gap-0.5 py-2 text-[0.625rem] font-medium text-muted-foreground transition-colors',
                            active && 'text-foreground',
                        )}
                    >
                        <Icon className={cn('size-4', active && 'text-foreground')} />
                        {item.label}
                    </Link>
                )
            })}
        </nav>
    )
}
