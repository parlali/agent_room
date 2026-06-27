import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
    BrainIcon,
    CalendarClockIcon,
    FolderIcon,
    MessagesSquareIcon,
    PauseIcon,
    PlayIcon,
    PlusIcon,
    SettingsIcon,
    type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { useEffect, type ReactNode } from 'react'

import { roomModeLabel } from '#/domain/room-modes'
import { sanitizeRuntimeError } from '#/domain/runtime-error'
import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover'
import {
    Chip,
    NavTabBar,
    navTabClass,
    Page,
    PageHeader,
    RoomGlyph,
    StateBadge,
    StatusDot,
    useStartRoomSession,
} from '#/components/agent-room'
import { getRoomSidebarServer, setRoomDesiredStateServer } from '#/routes/-room-runtime-server'
import { getRoomConfigServer } from '#/routes/-operator-config-server'
import type { RoomRuntimeOverview, RoomSetupSnapshot } from '#/domain/room-execution-types'
import type { RoomConfigSnapshot } from '#/server/configuration/operator-configuration'
import { preloadRoomDashboardRoutes, scheduleRoomDashboardRoutePreload } from './preload'
import { buildRoomReadiness, roomNeedsSetup } from './room-readiness'
import { roomQueryKey, roomQueryPolicy } from '#/lib/room-query-keys'

export type RoomDashboardTab = 'chat' | 'files' | 'tasks' | 'memory' | 'settings'

interface TabDef {
    id: RoomDashboardTab
    label: string
    icon: LucideIcon
    to:
        | '/rooms/$roomId'
        | '/rooms/$roomId/files'
        | '/rooms/$roomId/jobs'
        | '/rooms/$roomId/memory'
        | '/rooms/$roomId/settings'
}

const ROOM_TABS: TabDef[] = [
    { id: 'chat', label: 'Chat', icon: MessagesSquareIcon, to: '/rooms/$roomId' },
    { id: 'files', label: 'Files', icon: FolderIcon, to: '/rooms/$roomId/files' },
    { id: 'tasks', label: 'Tasks', icon: CalendarClockIcon, to: '/rooms/$roomId/jobs' },
    { id: 'memory', label: 'Memory', icon: BrainIcon, to: '/rooms/$roomId/memory' },
    { id: 'settings', label: 'Settings', icon: SettingsIcon, to: '/rooms/$roomId/settings' },
]

export function RoomDashboardLayout({
    roomId,
    activeTab,
    children,
}: {
    roomId: string
    activeTab: RoomDashboardTab
    children: ReactNode
}) {
    usePreloadRoomDashboardRoutes()
    usePendingOnboardingRedirect(roomId)

    const header = <RoomHeader roomId={roomId} />
    const subnav = <RoomNav roomId={roomId} activeTab={activeTab} />

    if (activeTab === 'chat') {
        return (
            <div className="flex h-full min-h-0 flex-col">
                <div className="shrink-0 border-b border-border/60 bg-background/95 backdrop-blur">
                    <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">{header}</div>
                    <div className="mx-auto w-full max-w-7xl px-4 pb-2 sm:px-6">{subnav}</div>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                    <div className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col">
                        {children}
                    </div>
                </div>
            </div>
        )
    }

    return (
        <Page width="xl" header={header} subnav={subnav}>
            {children}
        </Page>
    )
}

function useRoomSidebarQuery(roomId: string) {
    return useQuery({
        queryKey: roomQueryKey.roomSidebar(roomId),
        queryFn: () => getRoomSidebarServer({ data: { roomId } }),
        staleTime: roomQueryPolicy.hotStaleMs,
        refetchInterval: (query) => {
            const data = query.state.data
            if (!data || data.room.desiredState !== 'running') return false
            return data.setup.phase === 'ready' ? false : 2500
        },
    })
}

function usePendingOnboardingRedirect(roomId: string): void {
    const navigate = useNavigate()
    const pathname = useRouterState({
        select: (state) => state.location.pathname,
    })
    const sidebarQuery = useRoomSidebarQuery(roomId)
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
            replace: true,
        })
    }, [navigate, onboardingSessionKey, roomId, shouldRedirect])
}

function usePreloadRoomDashboardRoutes(): void {
    useEffect(() => {
        return scheduleRoomDashboardRoutePreload(350)
    }, [])
}

function RoomHeader({ roomId }: { roomId: string }) {
    const queryClient = useQueryClient()
    const sidebarQuery = useRoomSidebarQuery(roomId)
    const configQuery = useQuery({
        queryKey: roomQueryKey.roomConfig(roomId),
        queryFn: () => getRoomConfigServer({ data: { roomId } }),
        staleTime: roomQueryPolicy.coldStaleMs,
    })
    const room = sidebarQuery.data?.room ?? null
    const setup = sidebarQuery.data?.setup ?? null

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

    if (sidebarQuery.isLoading) {
        return (
            <div className="flex items-center gap-3 py-4">
                <Skeleton className="size-10 rounded-md" />
                <div className="flex-1 space-y-1">
                    <Skeleton className="h-5 w-1/3" />
                    <Skeleton className="h-3 w-1/2" />
                </div>
            </div>
        )
    }

    if (sidebarQuery.isError) {
        return (
            <PageHeader
                title="Could not load this room"
                subtitle="We hit a problem loading this room. Check your connection and try again."
                actions={
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void sidebarQuery.refetch()}
                        disabled={sidebarQuery.isFetching}
                    >
                        Try again
                    </Button>
                }
            />
        )
    }

    if (!room || !setup) {
        return (
            <PageHeader
                title="Room not found"
                subtitle="This room may have been removed or you do not have access."
                actions={
                    <Link to="/">
                        <Button variant="outline" size="sm">
                            Back to home
                        </Button>
                    </Link>
                }
            />
        )
    }

    return (
        <RoomHeaderContent
            roomId={roomId}
            room={room}
            setup={setup}
            config={configQuery.data ?? null}
            setDesired={setDesired}
        />
    )
}

function RoomHeaderContent({
    roomId,
    room,
    setup,
    config,
    setDesired,
}: {
    roomId: string
    room: RoomRuntimeOverview
    setup: RoomSetupSnapshot
    config: RoomConfigSnapshot | null
    setDesired: ReturnType<typeof useMutation<unknown, unknown, 'running' | 'stopped'>>
}) {
    const paused = room.desiredState === 'stopped'
    const readiness = buildRoomReadiness({ room, setup, config })
    const needsSetup = roomNeedsSetup({ setup, room })
    const startSession = useStartRoomSession({ roomId })

    return (
        <PageHeader
            glyph={<RoomGlyph name={room.displayName} seed={room.roomId} size="lg" />}
            title={room.displayName}
            status={
                <span className="flex items-center gap-2">
                    <Popover>
                        <PopoverTrigger
                            className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label="Room readiness details"
                        >
                            <StateBadge
                                tone={readiness.tone}
                                label={readiness.label}
                                pulse={readiness.tone === 'working'}
                            />
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-72 space-y-2 p-3">
                            <p className="text-xs font-medium text-foreground">{readiness.label}</p>
                            <ul className="space-y-2">
                                {readiness.checks.map((check) => (
                                    <li key={check.label} className="flex items-start gap-2">
                                        <span className="mt-1">
                                            <StatusDot tone={check.tone} />
                                        </span>
                                        <span className="min-w-0">
                                            <span className="block text-xs font-medium text-foreground">
                                                {check.label}
                                            </span>
                                            <span className="block text-xs text-muted-foreground">
                                                {check.detail}
                                            </span>
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </PopoverContent>
                    </Popover>
                    <Chip>{roomModeLabel(room.roomMode)}</Chip>
                </span>
            }
            subtitle={
                room.lastError ? (
                    <span className="text-muted-foreground">
                        {sanitizeRuntimeError(room.lastError)}
                    </span>
                ) : undefined
            }
            actions={
                <>
                    {needsSetup ? (
                        <Button asChild size="sm">
                            <Link to="/settings" hash="advanced">
                                Finish setup
                            </Link>
                        </Button>
                    ) : (
                        <Button
                            size="sm"
                            onClick={() => startSession.mutate()}
                            disabled={startSession.isPending || setup.canStartSessions === false}
                        >
                            <PlusIcon /> New conversation
                        </Button>
                    )}
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDesired.mutate(paused ? 'running' : 'stopped')}
                        disabled={setDesired.isPending}
                    >
                        {paused ? <PlayIcon /> : <PauseIcon />}
                        {paused ? 'Resume' : 'Pause'}
                    </Button>
                </>
            }
        />
    )
}

function RoomNav({ roomId, activeTab }: { roomId: string; activeTab?: RoomDashboardTab }) {
    return (
        <NavTabBar aria-label="Room navigation">
            {ROOM_TABS.map((tab) => {
                const Icon = tab.icon
                const active = tab.id === activeTab
                return (
                    <Link
                        key={tab.id}
                        to={tab.to}
                        params={{ roomId }}
                        className={navTabClass(active)}
                        aria-current={active ? 'page' : undefined}
                        onMouseEnter={() => void preloadRoomDashboardRoutes()}
                    >
                        <Icon />
                        {tab.label}
                    </Link>
                )
            })}
        </NavTabBar>
    )
}
