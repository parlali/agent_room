import { Link, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
    ActivityIcon,
    BarChart3Icon,
    CalendarClockIcon,
    FolderIcon,
    PlusIcon,
    SearchIcon,
    SettingsIcon,
    HomeIcon,
} from 'lucide-react'

import { cn } from '#/lib/utils'
import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import { BrandWordmark } from '#/components/agent-room'
import { listRoomsServer } from '#/routes/-room-runtime-server'
import { currentUserServer } from '#/routes/-auth-server'
import { SidebarRoomTree } from './sidebar-room-tree'
import { UserMenu } from './user-menu'

const TOP_LINKS = [
    { to: '/', label: 'Home', icon: HomeIcon, exact: true },
    { to: '/activity', label: 'Activity', icon: ActivityIcon, exact: true },
    { to: '/jobs', label: 'Jobs', icon: CalendarClockIcon, exact: true },
    { to: '/files', label: 'Files', icon: FolderIcon, exact: true },
    { to: '/usage', label: 'Usage', icon: BarChart3Icon, exact: true },
] as const

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
    const pathname = useRouterState({ select: (s) => s.location.pathname })

    const userQuery = useQuery({
        queryKey: ['auth-current-user'],
        queryFn: () => currentUserServer(),
        staleTime: 60_000,
    })

    const roomsQuery = useQuery({
        queryKey: ['rooms-list'],
        queryFn: () => listRoomsServer(),
        staleTime: 10_000,
        refetchInterval: 15_000,
    })

    return (
        <div className="flex h-full w-full flex-col bg-sidebar text-sidebar-foreground">
            <div className="flex items-center justify-between gap-2 px-4 pb-3 pt-4">
                <Link to="/" onClick={onNavigate}>
                    <BrandWordmark />
                </Link>
                <span className="rounded-full border border-sidebar-border bg-sidebar-accent/60 px-1.5 py-0.5 text-[0.625rem] font-medium uppercase tracking-wide text-muted-foreground">
                    Self-hosted
                </span>
            </div>

            <div className="px-2">
                <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-full justify-start gap-2 bg-card text-muted-foreground hover:text-foreground"
                    onClick={() => undefined}
                >
                    <SearchIcon className="size-3.5" />
                    <span className="flex-1 text-left text-xs">Search rooms, sessions…</span>
                    <kbd className="hidden rounded border border-border bg-background px-1.5 py-0.5 text-[0.625rem] text-muted-foreground sm:inline">
                        ⌘K
                    </kbd>
                </Button>
            </div>

            <nav className="mt-3 flex flex-col gap-0.5 px-2">
                {TOP_LINKS.map((link) => {
                    const Icon = link.icon
                    const active = link.exact ? pathname === link.to : pathname.startsWith(link.to)
                    return (
                        <Link
                            key={link.to}
                            to={link.to}
                            onClick={onNavigate}
                            className={cn(
                                'flex h-8 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                                active &&
                                    'bg-sidebar-accent font-medium text-sidebar-accent-foreground',
                            )}
                        >
                            <Icon className="size-3.5" />
                            {link.label}
                        </Link>
                    )
                })}
            </nav>

            <div className="mt-5 flex items-center justify-between px-3">
                <span className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
                    Rooms
                </span>
                <Link to="/" onClick={onNavigate}>
                    <Button variant="ghost" size="icon-xs" aria-label="Add room">
                        <PlusIcon />
                    </Button>
                </Link>
            </div>

            <div className="mt-1 flex-1 overflow-y-auto pb-2">
                {roomsQuery.isLoading ? (
                    <div className="space-y-1 px-2">
                        <Skeleton className="h-7 w-full" />
                        <Skeleton className="h-7 w-full" />
                        <Skeleton className="h-7 w-2/3" />
                    </div>
                ) : roomsQuery.isError ? (
                    <div className="px-3 text-xs text-muted-foreground">Could not load rooms.</div>
                ) : (
                    <SidebarRoomTree rooms={roomsQuery.data ?? []} onNavigate={onNavigate} />
                )}
            </div>

            <div className="border-t border-sidebar-border px-2 py-2">
                <Link to="/settings" onClick={onNavigate}>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-full justify-start gap-2 hover:bg-sidebar-accent"
                    >
                        <SettingsIcon className="size-3.5" /> Settings
                    </Button>
                </Link>
                <div className="mt-1">
                    <UserMenu user={userQuery.data ?? null} />
                </div>
            </div>
        </div>
    )
}
