import { useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Plus } from 'lucide-react'

import { cn } from '#/lib/utils'
import { describeRoomState, describeSessionState, toneStyles } from '#/lib/state'
import { formatRelativeTime } from '#/lib/format'
import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import { StatusDot } from '#/components/agent-room'
import { getRoomExecutionServer } from '#/routes/-room-runtime-server'
import type { RoomRuntimeOverview } from '#/server/rooms/execution-types'

const SESSION_PREVIEW_LIMIT = 4

export function SidebarRoomTree({
    rooms,
    onNavigate,
}: {
    rooms: RoomRuntimeOverview[]
    onNavigate?: () => void
}) {
    const pathname = useRouterState({ select: (s) => s.location.pathname })
    const activeRoomId = pathname.match(/^\/rooms\/([^/]+)/)?.[1] ?? null
    const [expanded, setExpanded] = useState<Set<string>>(() =>
        activeRoomId ? new Set([activeRoomId]) : new Set(),
    )

    const toggle = (id: string) => {
        setExpanded((prev) => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    if (rooms.length === 0) {
        return (
            <div className="px-2 py-4 text-xs text-muted-foreground">
                No rooms yet. Add your first one below.
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-0.5 px-1">
            {rooms.map((room) => (
                <RoomNode
                    key={room.roomId}
                    room={room}
                    expanded={expanded.has(room.roomId)}
                    isActiveRoom={activeRoomId === room.roomId}
                    onToggle={() => toggle(room.roomId)}
                    activePathname={pathname}
                    onNavigate={onNavigate}
                />
            ))}
        </div>
    )
}

function RoomNode({
    room,
    expanded,
    isActiveRoom,
    onToggle,
    activePathname,
    onNavigate,
}: {
    room: RoomRuntimeOverview
    expanded: boolean
    isActiveRoom: boolean
    onToggle: () => void
    activePathname: string
    onNavigate?: () => void
}) {
    const state = describeRoomState({
        status: room.status,
        desiredState: room.desiredState,
        healthStatus: room.healthStatus,
    })
    const isOnHomeOrSurface =
        activePathname === `/rooms/${room.roomId}` ||
        (activePathname.startsWith(`/rooms/${room.roomId}/`) &&
            !activePathname.includes('/sessions/'))

    return (
        <div className="group/room">
            <div
                className={cn(
                    'flex items-center gap-1 rounded-md px-1.5 py-1.5 text-sm transition-colors hover:bg-sidebar-accent',
                    isActiveRoom &&
                        isOnHomeOrSurface &&
                        'bg-sidebar-accent text-sidebar-accent-foreground',
                )}
            >
                <button
                    type="button"
                    onClick={onToggle}
                    className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-expanded={expanded}
                    aria-label={expanded ? 'Collapse room' : 'Expand room'}
                >
                    <ChevronRight
                        className={cn('size-3.5 transition-transform', expanded && 'rotate-90')}
                    />
                </button>
                <Link
                    to="/rooms/$roomId"
                    params={{ roomId: room.roomId }}
                    onClick={onNavigate}
                    className="flex min-w-0 flex-1 items-center gap-2"
                >
                    <span className="truncate text-sm font-medium">{room.displayName}</span>
                    <StatusDot
                        tone={state.tone}
                        pulse={state.tone === 'working'}
                        className="ml-auto"
                    />
                </Link>
            </div>
            {expanded ? (
                <RoomSessions
                    roomId={room.roomId}
                    activePathname={activePathname}
                    onNavigate={onNavigate}
                />
            ) : null}
        </div>
    )
}

function RoomSessions({
    roomId,
    activePathname,
    onNavigate,
}: {
    roomId: string
    activePathname: string
    onNavigate?: () => void
}) {
    const query = useQuery({
        queryKey: ['room-execution', roomId, 'sidebar'],
        queryFn: () => getRoomExecutionServer({ data: { roomId } }),
        staleTime: 15_000,
    })

    if (query.isLoading) {
        return (
            <div className="space-y-1 py-1 pl-7 pr-1">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-5 w-2/3" />
            </div>
        )
    }

    if (query.isError) {
        return (
            <div className="px-7 pb-1 pt-0.5 text-xs text-muted-foreground">
                Could not load sessions
            </div>
        )
    }

    const threads = query.data?.threads ?? []

    if (threads.length === 0) {
        return (
            <div className="space-y-1 px-7 pb-1.5 pt-0.5">
                <p className="text-xs text-muted-foreground">No sessions yet.</p>
                <Link to="/rooms/$roomId" params={{ roomId }} onClick={onNavigate}>
                    <Button variant="ghost" size="xs" className="h-6 w-full justify-start">
                        <Plus className="size-3" />
                        Start session
                    </Button>
                </Link>
            </div>
        )
    }

    const visible = threads.slice(0, SESSION_PREVIEW_LIMIT)
    const remaining = threads.length - visible.length

    return (
        <ul className="flex flex-col gap-px py-0.5 pl-7 pr-1">
            {visible.map((thread) => {
                const sessionState = describeSessionState(thread.status)
                const sessionPath = `/rooms/${roomId}/sessions/${encodeURIComponent(thread.key)}`
                const isActive = activePathname === sessionPath
                return (
                    <li key={thread.key}>
                        <Link
                            to="/rooms/$roomId/sessions/$sessionKey"
                            params={{ roomId, sessionKey: thread.key }}
                            onClick={onNavigate}
                            className={cn(
                                'group/session flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-[0.8125rem] text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                                isActive &&
                                    'bg-sidebar-accent font-medium text-sidebar-accent-foreground',
                            )}
                        >
                            <span
                                className={cn(
                                    'size-1.5 shrink-0 rounded-full',
                                    toneStyles[sessionState.tone].dot,
                                )}
                            />
                            <span className="min-w-0 flex-1 truncate">
                                {thread.title || 'Untitled session'}
                            </span>
                            <span className="shrink-0 text-[0.6875rem] text-muted-foreground/80 group-hover/session:text-current">
                                {formatRelativeTime(thread.updatedAt)}
                            </span>
                        </Link>
                    </li>
                )
            })}
            {remaining > 0 ? (
                <li className="px-2 pt-0.5 text-[0.6875rem] text-muted-foreground">
                    + {remaining} more
                </li>
            ) : null}
        </ul>
    )
}
