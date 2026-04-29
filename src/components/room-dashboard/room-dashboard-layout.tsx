import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
    HomeIcon,
    FolderIcon,
    CalendarClockIcon,
    ActivityIcon,
    SettingsIcon,
    PauseIcon,
    PlayIcon,
    type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import type { ReactNode } from 'react'

import { cn } from '#/lib/utils'
import { describeRoomState } from '#/lib/state'
import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import { ScrollArea } from '#/components/ui/scroll-area'
import { AppShell } from '#/components/app-shell'
import { RoomGlyph, StateBadge } from '#/components/agent-room'
import { listRoomsServer, setRoomDesiredStateServer } from '#/routes/-room-runtime-server'
import type { RoomRuntimeOverview } from '#/server/rooms/execution-types'

export type RoomDashboardTab = 'home' | 'files' | 'jobs' | 'status' | 'settings'

interface TabDef {
    id: RoomDashboardTab
    label: string
    icon: LucideIcon
    to:
        | '/rooms/$roomId'
        | '/rooms/$roomId/files'
        | '/rooms/$roomId/jobs'
        | '/rooms/$roomId/status'
        | '/rooms/$roomId/settings'
}

const TABS: TabDef[] = [
    { id: 'home', label: 'Home', icon: HomeIcon, to: '/rooms/$roomId' },
    { id: 'files', label: 'Files', icon: FolderIcon, to: '/rooms/$roomId/files' },
    { id: 'jobs', label: 'Jobs', icon: CalendarClockIcon, to: '/rooms/$roomId/jobs' },
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
    return (
        <AppShell>
            <div className="flex min-h-full flex-col">
                <RoomHeader roomId={roomId} headerActions={headerActions} />
                <RoomTabs roomId={roomId} activeTab={activeTab} />
                <ScrollArea className="flex-1">
                    <div className="px-4 py-6 sm:px-6">{children}</div>
                </ScrollArea>
            </div>
        </AppShell>
    )
}

function RoomHeader({ roomId, headerActions }: { roomId: string; headerActions?: ReactNode }) {
    const queryClient = useQueryClient()
    const roomsQuery = useQuery({
        queryKey: ['rooms-list'],
        queryFn: () => listRoomsServer(),
        staleTime: 10_000,
    })
    const room = roomsQuery.data?.find((r) => r.roomId === roomId) ?? null

    const setDesired = useMutation({
        mutationFn: (desiredState: 'running' | 'stopped') =>
            setRoomDesiredStateServer({ data: { roomId, desiredState } }),
        onSuccess: async (_data, desiredState) => {
            await queryClient.invalidateQueries({ queryKey: ['rooms-list'] })
            await queryClient.invalidateQueries({ queryKey: ['room-execution', roomId] })
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
    const state = describeRoomState({
        status: room.status,
        desiredState: room.desiredState,
        healthStatus: room.healthStatus,
    })
    const paused = room.desiredState === 'stopped'
    return (
        <header className="flex flex-col gap-3 border-b border-border/60 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
                <RoomGlyph name={room.displayName} seed={room.roomId} size="lg" />
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <h1 className="truncate text-lg font-semibold tracking-tight sm:text-xl">
                            {room.displayName}
                        </h1>
                        <StateBadge
                            tone={state.tone}
                            label={state.label}
                            pulse={state.tone === 'working'}
                        />
                    </div>
                    {room.lastError ? (
                        <p className="mt-0.5 truncate text-xs text-danger-fg">{room.lastError}</p>
                    ) : (
                        <p className="text-xs text-muted-foreground">/{room.slug}</p>
                    )}
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
    return (
        <nav
            className="sticky top-0 z-10 flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border/60 bg-background/95 px-2 backdrop-blur sm:px-4"
            role="tablist"
        >
            {TABS.map((tab) => {
                const Icon = tab.icon
                const isActive = tab.id === activeTab
                return (
                    <Link
                        key={tab.id}
                        to={tab.to}
                        params={{ roomId }}
                        role="tab"
                        aria-selected={isActive}
                        className={cn(
                            'relative flex h-11 items-center gap-1.5 whitespace-nowrap rounded-none border-b-2 border-transparent px-3 text-sm text-muted-foreground transition-colors hover:text-foreground',
                            isActive && 'border-foreground text-foreground',
                        )}
                    >
                        <Icon className="size-3.5" />
                        {tab.label}
                    </Link>
                )
            })}
        </nav>
    )
}
