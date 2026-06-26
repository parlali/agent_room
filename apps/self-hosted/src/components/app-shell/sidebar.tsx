import { useEffect } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { PlusIcon } from 'lucide-react'

import { cn } from '#/lib/utils'
import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import { BrandWordmark, CreateRoomButton } from '#/components/agent-room'
import { listRoomsServer } from '#/routes/-room-runtime-server'
import { currentUserServer } from '#/routes/-auth-server'
import { scheduleRoomDashboardRoutePreload } from '#/components/room-dashboard/preload'
import { roomQueryKey, roomQueryPolicy } from '#/lib/room-query-keys'
import { SidebarRoomTree } from './sidebar-room-tree'
import { UserMenu } from './user-menu'
import { useAccountNavItems } from './nav-config'

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
    useEffect(() => scheduleRoomDashboardRoutePreload(), [])

    const pathname = useRouterState({ select: (s) => s.location.pathname })
    const accountNavItems = useAccountNavItems()

    const userQuery = useQuery({
        queryKey: roomQueryKey.authUser,
        queryFn: () => currentUserServer(),
        staleTime: 5 * 60_000,
        gcTime: 15 * 60_000,
    })

    const roomsQuery = useQuery({
        queryKey: roomQueryKey.roomsList,
        queryFn: () => listRoomsServer(),
        staleTime: roomQueryPolicy.warmStaleMs,
        refetchInterval: roomQueryPolicy.sidebarPollMs,
    })

    return (
        <div className="flex h-full w-full flex-col bg-sidebar text-sidebar-foreground">
            <div className="px-4 pb-3 pt-4">
                <Link to="/" onClick={onNavigate}>
                    <BrandWordmark />
                </Link>
            </div>

            <nav className="flex flex-col gap-0.5 px-2 pb-2">
                {accountNavItems.map((item) => {
                    const Icon = item.icon
                    const active = item.match(pathname)
                    return (
                        <Link
                            key={item.id}
                            {...item.link}
                            onClick={onNavigate}
                            className={cn(
                                'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-colors hover:bg-sidebar-accent',
                                active
                                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                                    : 'text-muted-foreground hover:text-sidebar-accent-foreground',
                            )}
                        >
                            <Icon className="size-4 shrink-0" />
                            {item.label}
                        </Link>
                    )
                })}
            </nav>

            <div className="flex items-center justify-between px-3 pt-1">
                <span className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
                    Rooms
                </span>
                <CreateRoomButton
                    buttonVariant="ghost"
                    size="icon-xs"
                    ariaLabel="Create room"
                    onCreated={onNavigate}
                >
                    <PlusIcon />
                </CreateRoomButton>
            </div>

            <div className="mt-1 flex-1 overflow-y-auto pb-2">
                {roomsQuery.isLoading ? (
                    <div className="space-y-1 px-2">
                        <Skeleton className="h-7 w-full" />
                        <Skeleton className="h-7 w-full" />
                        <Skeleton className="h-7 w-2/3" />
                    </div>
                ) : roomsQuery.isError ? (
                    <div className="space-y-2 px-3 py-2">
                        <p className="text-xs text-muted-foreground">Could not load rooms.</p>
                        <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            onClick={() => roomsQuery.refetch()}
                            disabled={roomsQuery.isFetching}
                        >
                            {roomsQuery.isFetching ? 'Retrying...' : 'Retry'}
                        </Button>
                    </div>
                ) : (
                    <SidebarRoomTree rooms={roomsQuery.data ?? []} onNavigate={onNavigate} />
                )}
            </div>

            <div className="border-t border-sidebar-border px-2 py-2">
                <UserMenu user={userQuery.data ?? null} />
            </div>
        </div>
    )
}
