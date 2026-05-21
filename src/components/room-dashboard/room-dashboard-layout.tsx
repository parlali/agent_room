import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
    HomeIcon,
    FolderIcon,
    CalendarClockIcon,
    ActivityIcon,
    SettingsIcon,
    BrainIcon,
    BarChart3Icon,
    CheckIcon,
    ChevronDownIcon,
    PauseIcon,
    PlayIcon,
    type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { useEffect, type ReactNode } from 'react'

import { cn } from '#/lib/utils'
import { roomModeLabel } from '#/lib/room-modes'
import { Button } from '#/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Skeleton } from '#/components/ui/skeleton'
import { ScrollArea } from '#/components/ui/scroll-area'
import { RoomGlyph, StateBadge } from '#/components/agent-room'
import {
    getRoomSidebarServer,
    listRoomsServer,
    setRoomDesiredStateServer,
} from '#/routes/-room-runtime-server'
import type { RoomRuntimeOverview } from '#/lib/room-execution-types'
import { preloadRoomDashboardRoutes, scheduleRoomDashboardRoutePreload } from './preload'
import { roomQueryKey, roomQueryPolicy } from '#/lib/room-query-keys'

export type RoomDashboardTab =
    | 'home'
    | 'files'
    | 'jobs'
    | 'memory'
    | 'usage'
    | 'status'
    | 'settings'

interface TabDef {
    id: RoomDashboardTab
    label: string
    description: string
    icon: LucideIcon
    to:
        | '/rooms/$roomId'
        | '/rooms/$roomId/files'
        | '/rooms/$roomId/jobs'
        | '/rooms/$roomId/memory'
        | '/rooms/$roomId/usage'
        | '/rooms/$roomId/status'
        | '/rooms/$roomId/settings'
}

interface TabGroup {
    id: string
    label: string
    heading: string
    icon: LucideIcon
    tabs: TabDef[]
}

const TAB_GROUPS: TabGroup[] = [
    {
        id: 'workspace',
        label: 'Workspace',
        heading: 'Room workspace',
        icon: HomeIcon,
        tabs: [
            {
                id: 'home',
                label: 'Home',
                description: 'Overview, recent activity, and quick actions',
                icon: HomeIcon,
                to: '/rooms/$roomId',
            },
            {
                id: 'files',
                label: 'Files',
                description: 'Uploads and files produced by the room',
                icon: FolderIcon,
                to: '/rooms/$roomId/files',
            },
            {
                id: 'jobs',
                label: 'Jobs',
                description: 'Scheduled recurring work',
                icon: CalendarClockIcon,
                to: '/rooms/$roomId/jobs',
            },
        ],
    },
    {
        id: 'knowledge',
        label: 'Knowledge',
        heading: 'Room knowledge',
        icon: BrainIcon,
        tabs: [
            {
                id: 'memory',
                label: 'Memory',
                description: 'Durable room memory and user-facing facts',
                icon: BrainIcon,
                to: '/rooms/$roomId/memory',
            },
        ],
    },
    {
        id: 'operations',
        label: 'Operations',
        heading: 'Room operations',
        icon: ActivityIcon,
        tabs: [
            {
                id: 'usage',
                label: 'Usage',
                description: 'Activity, runtime, token, and cost reporting',
                icon: BarChart3Icon,
                to: '/rooms/$roomId/usage',
            },
            {
                id: 'status',
                label: 'Status',
                description: 'Readiness, health, and runtime state',
                icon: ActivityIcon,
                to: '/rooms/$roomId/status',
            },
            {
                id: 'settings',
                label: 'Settings',
                description: 'Model, OAuth, capabilities, and room configuration',
                icon: SettingsIcon,
                to: '/rooms/$roomId/settings',
            },
        ],
    },
]

export function RoomDashboardLayout({
    roomId,
    activeTab,
    children,
    headerActions,
}: {
    roomId: string
    activeTab: RoomDashboardTab
    children: ReactNode
    headerActions?: ReactNode
}) {
    usePreloadRoomDashboardRoutes()
    usePendingOnboardingRedirect(roomId)

    return (
        <div className="flex min-h-full flex-col">
            <RoomHeader roomId={roomId} headerActions={headerActions} />
            <RoomTabs roomId={roomId} activeTab={activeTab} />
            <ScrollArea className="flex-1">
                <div className="px-4 py-6 sm:px-6">{children}</div>
            </ScrollArea>
        </div>
    )
}

function usePendingOnboardingRedirect(roomId: string): void {
    const navigate = useNavigate()
    const pathname = useRouterState({
        select: (state) => state.location.pathname,
    })
    const sidebarQuery = useQuery({
        queryKey: roomQueryKey.roomSidebar(roomId),
        queryFn: () => getRoomSidebarServer({ data: { roomId } }),
        staleTime: roomQueryPolicy.hotStaleMs,
        refetchInterval: (query) => {
            const data = query.state.data
            if (!data || data.room.desiredState !== 'running') return false
            return data.setup.phase === 'ready' ? false : 2500
        },
    })
    const onboardingSessionKey = sidebarQuery.data?.setup.onboardingSessionKey ?? null
    const shouldRedirect =
        sidebarQuery.data?.setup.phase === 'onboarding' &&
        Boolean(onboardingSessionKey) &&
        pathname !== `/rooms/${roomId}/sessions/${onboardingSessionKey}`

    useEffect(() => {
        if (!shouldRedirect || !onboardingSessionKey) return
        void navigate({
            to: '/rooms/$roomId/sessions/$sessionKey',
            params: {
                roomId,
                sessionKey: onboardingSessionKey,
            },
        })
    }, [navigate, onboardingSessionKey, roomId, shouldRedirect])
}

function usePreloadRoomDashboardRoutes(): void {
    useEffect(() => {
        return scheduleRoomDashboardRoutePreload(350)
    }, [])
}

function RoomHeader({ roomId, headerActions }: { roomId: string; headerActions?: ReactNode }) {
    const queryClient = useQueryClient()
    const roomsQuery = useQuery({
        queryKey: roomQueryKey.roomsList,
        queryFn: () => listRoomsServer(),
        staleTime: roomQueryPolicy.warmStaleMs,
    })
    const room = roomsQuery.data?.find((r) => r.roomId === roomId) ?? null

    const setDesired = useMutation({
        mutationFn: (desiredState: 'running' | 'stopped') =>
            setRoomDesiredStateServer({ data: { roomId, desiredState } }),
        onSuccess: async (_data, desiredState) => {
            await queryClient.invalidateQueries({ queryKey: roomQueryKey.roomsList })
            await queryClient.invalidateQueries({ queryKey: roomQueryKey.roomExecution(roomId) })
            await queryClient.invalidateQueries({ queryKey: roomQueryKey.roomSidebar(roomId) })
            toast.success(desiredState === 'running' ? 'Room resumed' : 'Room paused')
        },
        onError: (e: unknown) =>
            toast.error('Could not change room state', {
                description: e instanceof Error ? e.message : 'Unexpected error',
            }),
    })

    if (roomsQuery.isLoading) {
        return (
            <header className="flex items-center gap-3 border-b border-border/60 px-4 py-4 sm:px-6">
                <Skeleton className="size-10 rounded-md" />
                <div className="flex-1 space-y-1">
                    <Skeleton className="h-5 w-1/3" />
                    <Skeleton className="h-3 w-1/2" />
                </div>
            </header>
        )
    }

    if (!room) {
        return (
            <header className="flex items-center justify-between border-b border-border/60 px-4 py-4 sm:px-6">
                <div>
                    <h1 className="text-lg font-semibold">Room not found</h1>
                    <p className="text-sm text-muted-foreground">
                        This room may have been removed or you do not have access.
                    </p>
                </div>
                <Link to="/">
                    <Button variant="outline" size="sm">
                        Back to home
                    </Button>
                </Link>
            </header>
        )
    }

    return <RoomHeaderContent room={room} headerActions={headerActions} setDesired={setDesired} />
}

function RoomHeaderContent({
    room,
    headerActions,
    setDesired,
}: {
    room: RoomRuntimeOverview
    headerActions?: ReactNode
    setDesired: ReturnType<typeof useMutation<unknown, unknown, 'running' | 'stopped'>>
}) {
    const paused = room.desiredState === 'stopped'
    return (
        <header className="flex flex-col gap-3 border-b border-border/60 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
                <RoomGlyph name={room.displayName} seed={room.roomId} size="lg" />
                <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                        <h1 className="truncate text-lg font-semibold tracking-tight sm:text-xl">
                            {room.displayName}
                        </h1>
                        <StateBadge
                            tone={room.roomMode === 'programmer' ? 'ready' : 'muted'}
                            label={roomModeLabel(room.roomMode)}
                            showDot={false}
                            className="shrink-0"
                        />
                    </div>
                    {room.lastError ? (
                        <p className="mt-0.5 truncate text-xs text-danger-fg">{room.lastError}</p>
                    ) : null}
                </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
                {headerActions}
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDesired.mutate(paused ? 'running' : 'stopped')}
                    disabled={setDesired.isPending}
                >
                    {paused ? <PlayIcon /> : <PauseIcon />}
                    {paused ? 'Resume' : 'Pause'}
                </Button>
            </div>
        </header>
    )
}

function RoomTabs({ roomId, activeTab }: { roomId: string; activeTab: RoomDashboardTab }) {
    const navigate = useNavigate()

    return (
        <nav
            className="sticky top-0 z-10 flex shrink-0 items-center gap-2 border-b border-border/60 bg-background/95 px-4 py-2 backdrop-blur sm:px-6"
            aria-label="Room navigation"
        >
            {TAB_GROUPS.map((group) => {
                const GroupIcon = group.icon
                const activeItem = group.tabs.find((tab) => tab.id === activeTab) ?? null
                const isActive = activeItem !== null
                return (
                    <DropdownMenu
                        key={group.id}
                        onOpenChange={(open) => {
                            if (open) void preloadRoomDashboardRoutes()
                        }}
                    >
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant={isActive ? 'secondary' : 'ghost'}
                                size="sm"
                                className={cn('gap-2', isActive && 'text-foreground')}
                            >
                                <GroupIcon className="size-4" />
                                <span>{group.label}</span>
                                {activeItem ? (
                                    <span className="hidden max-w-28 truncate text-muted-foreground sm:inline">
                                        {activeItem.label}
                                    </span>
                                ) : null}
                                <ChevronDownIcon className="size-3.5 text-muted-foreground" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-72">
                            <DropdownMenuLabel>{group.heading}</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            {group.tabs.map((tab) => {
                                const Icon = tab.icon
                                const tabActive = tab.id === activeTab
                                return (
                                    <DropdownMenuItem
                                        key={tab.id}
                                        className={cn(
                                            'items-start gap-2 py-2',
                                            tabActive && 'bg-accent text-accent-foreground',
                                        )}
                                        onSelect={(event) => {
                                            event.preventDefault()
                                            void preloadRoomDashboardRoutes()
                                            void navigate({
                                                to: tab.to,
                                                params: { roomId },
                                            })
                                        }}
                                    >
                                        <Icon className="mt-0.5 size-4" />
                                        <span className="min-w-0 flex-1">
                                            <span className="block font-medium">{tab.label}</span>
                                            <span className="mt-0.5 block text-xs leading-snug text-muted-foreground group-focus/dropdown-menu-item:text-accent-foreground">
                                                {tab.description}
                                            </span>
                                        </span>
                                        {tabActive ? (
                                            <CheckIcon className="ml-auto mt-0.5 size-4" />
                                        ) : null}
                                    </DropdownMenuItem>
                                )
                            })}
                        </DropdownMenuContent>
                    </DropdownMenu>
                )
            })}
        </nav>
    )
}
