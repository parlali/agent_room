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
    PauseIcon,
    PlayIcon,
    type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { useEffect, type ReactNode } from 'react'

import { roomModeLabel } from '#/domain/room-modes'
import { describeRoomState } from '#/domain/state'
import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import {
    Chip,
    NavTabBar,
    navTabClass,
    Page,
    PageHeader,
    RoomGlyph,
    StateBadge,
} from '#/components/agent-room'
import { getRoomSidebarServer, setRoomDesiredStateServer } from '#/routes/-room-runtime-server'
import type { RoomRuntimeOverview } from '#/domain/room-execution-types'
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

const ROOM_TABS: TabDef[] = [
    { id: 'home', label: 'Home', icon: HomeIcon, to: '/rooms/$roomId' },
    { id: 'files', label: 'Files', icon: FolderIcon, to: '/rooms/$roomId/files' },
    { id: 'jobs', label: 'Jobs', icon: CalendarClockIcon, to: '/rooms/$roomId/jobs' },
    { id: 'memory', label: 'Memory', icon: BrainIcon, to: '/rooms/$roomId/memory' },
    { id: 'usage', label: 'Usage', icon: BarChart3Icon, to: '/rooms/$roomId/usage' },
    { id: 'status', label: 'Status', icon: ActivityIcon, to: '/rooms/$roomId/status' },
    { id: 'settings', label: 'Settings', icon: SettingsIcon, to: '/rooms/$roomId/settings' },
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
        <Page
            width="full"
            header={<RoomHeader roomId={roomId} headerActions={headerActions} />}
            subnav={<RoomNav roomId={roomId} activeTab={activeTab} />}
        >
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
    const sidebarQuery = useRoomSidebarQuery(roomId)
    const room = sidebarQuery.data?.room ?? null

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

    if (!room) {
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
    const state = describeRoomState({
        status: room.status,
        desiredState: room.desiredState,
        healthStatus: room.healthStatus,
    })
    return (
        <PageHeader
            glyph={<RoomGlyph name={room.displayName} seed={room.roomId} size="lg" />}
            title={room.displayName}
            status={
                <span className="flex items-center gap-2">
                    <StateBadge
                        tone={state.tone}
                        label={state.label}
                        pulse={state.tone === 'working'}
                    />
                    <Chip>{roomModeLabel(room.roomMode)}</Chip>
                </span>
            }
            subtitle={
                room.lastError ? (
                    <span className="text-danger-fg">{room.lastError}</span>
                ) : undefined
            }
            actions={
                <>
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
                </>
            }
        />
    )
}

function RoomNav({ roomId, activeTab }: { roomId: string; activeTab: RoomDashboardTab }) {
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
