import { useEffect, useState } from 'react'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Loader2Icon, Plus } from 'lucide-react'

import { cn } from '#/lib/utils'
import { describeRoomState } from '#/lib/state'
import { formatRelativeTime } from '#/lib/format'
import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import {
    SessionContextMenu,
    SessionContextMenuTrigger,
    StatusDot,
    useStartRoomSession,
} from '#/components/agent-room'
import { roomQueryKey, roomQueryPolicy } from '#/lib/room-query-keys'
import { getRoomSidebarServer } from '#/routes/-room-runtime-server'
import type { RoomExecutionThread, RoomRuntimeOverview } from '#/lib/room-execution-types'
import { markChatSelection } from '#/lib/browser-performance'
import { prewarmSessionDetail } from '#/routes/-session-chat/chat-projection-store'
import { useRoomEventCacheSync } from '#/routes/-session-chat/room-event-cache'

const SESSION_PREVIEW_LIMIT = 5

export function SidebarRoomTree({
    rooms,
    onNavigate,
}: {
    rooms: RoomRuntimeOverview[]
    onNavigate?: () => void
}) {
    const pathname = useRouterState({ select: (s) => s.location.pathname })
    const [optimisticPathname, setOptimisticPathname] = useState<string | null>(null)
    const activePathname = optimisticPathname ?? pathname
    const activeRoomId = activePathname.match(/^\/rooms\/([^/]+)/)?.[1] ?? null
    const [expanded, setExpanded] = useState<Set<string>>(() =>
        activeRoomId ? new Set([activeRoomId]) : new Set(),
    )

    useEffect(() => {
        if (optimisticPathname === pathname) {
            setOptimisticPathname(null)
        }
    }, [optimisticPathname, pathname])

    useEffect(() => {
        const nextActiveRoomId = activePathname.match(/^\/rooms\/([^/]+)/)?.[1] ?? null
        if (!nextActiveRoomId) return
        setExpanded((current) => {
            if (current.has(nextActiveRoomId)) return current
            const next = new Set(current)
            next.add(nextActiveRoomId)
            return next
        })
    }, [activePathname])

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
                    activePathname={activePathname}
                    onPreviewNavigate={setOptimisticPathname}
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
    onPreviewNavigate,
    onNavigate,
}: {
    room: RoomRuntimeOverview
    expanded: boolean
    isActiveRoom: boolean
    onToggle: () => void
    activePathname: string
    onPreviewNavigate: (pathname: string) => void
    onNavigate?: () => void
}) {
    const state = describeRoomState({
        status: room.status,
        desiredState: room.desiredState,
        healthStatus: room.healthStatus,
    })
    const startSession = useStartRoomSession({ roomId: room.roomId, onStarted: onNavigate })
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
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={onToggle}
                    className="size-5 shrink-0 rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-expanded={expanded}
                    aria-label={expanded ? 'Collapse room' : 'Expand room'}
                >
                    <ChevronRight
                        className={cn('size-3.5 transition-transform', expanded && 'rotate-90')}
                    />
                </Button>
                <Link
                    to="/rooms/$roomId"
                    params={{ roomId: room.roomId }}
                    onClick={() => {
                        onPreviewNavigate(`/rooms/${room.roomId}`)
                        onNavigate?.()
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2"
                >
                    <span className="truncate text-sm font-medium">{room.displayName}</span>
                    <StatusDot
                        tone={state.tone}
                        pulse={state.tone === 'working'}
                        className="ml-auto"
                    />
                </Link>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="size-5 opacity-0 transition-opacity group-hover/room:opacity-100 focus-visible:opacity-100 disabled:opacity-50"
                    onClick={() => startSession.mutate()}
                    disabled={startSession.isPending}
                    aria-label={`Start a session in ${room.displayName}`}
                >
                    {startSession.isPending ? (
                        <Loader2Icon className="size-3.5 animate-spin" />
                    ) : (
                        <Plus className="size-3.5" />
                    )}
                </Button>
            </div>
            {expanded ? (
                <RoomSessions
                    roomId={room.roomId}
                    activePathname={activePathname}
                    onPreviewNavigate={onPreviewNavigate}
                    onNavigate={onNavigate}
                />
            ) : null}
        </div>
    )
}

function RoomSessions({
    roomId,
    activePathname,
    onPreviewNavigate,
    onNavigate,
}: {
    roomId: string
    activePathname: string
    onPreviewNavigate: (pathname: string) => void
    onNavigate?: () => void
}) {
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const startSession = useStartRoomSession({ roomId, onStarted: onNavigate })
    const [showAll, setShowAll] = useState(false)
    const [streamError, setStreamError] = useState<string | null>(null)
    const query = useQuery({
        queryKey: roomQueryKey.roomSidebar(roomId),
        queryFn: () => getRoomSidebarServer({ data: { roomId } }),
        staleTime: roomQueryPolicy.hotStaleMs,
        gcTime: roomQueryPolicy.retainedSessionMs,
    })
    useRoomEventCacheSync({ roomId, queryClient, onError: setStreamError })

    useEffect(() => {
        const threads = query.data?.threads ?? []
        const targets = threads
            .filter((thread, index) => index < SESSION_PREVIEW_LIMIT || isThreadActive(thread))
            .slice(0, SESSION_PREVIEW_LIMIT + 3)
        const timeout = window.setTimeout(() => {
            for (const thread of targets) {
                void prewarmSessionDetail(queryClient, {
                    roomId,
                    sessionKey: thread.key,
                })
            }
        }, 600)
        return () => window.clearTimeout(timeout)
    }, [query.data?.threads, queryClient, roomId])

    if (query.isLoading) {
        return (
            <div className="space-y-1 py-1 pl-5 pr-1">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-5 w-2/3" />
            </div>
        )
    }

    if (query.isError) {
        return (
            <div className="px-5 pb-1 pt-0.5 text-xs text-muted-foreground">
                Could not load sessions
            </div>
        )
    }

    const threads = query.data?.threads ?? []

    if (threads.length === 0) {
        return (
            <div className="space-y-1 px-5 pb-1.5 pt-0.5">
                <p className="text-xs text-muted-foreground">No sessions yet.</p>
                <Button
                    variant="ghost"
                    size="xs"
                    className="h-6 w-full justify-start"
                    onClick={() => startSession.mutate()}
                    disabled={startSession.isPending}
                >
                    {startSession.isPending ? (
                        <Loader2Icon className="size-3 animate-spin" />
                    ) : (
                        <Plus className="size-3" />
                    )}
                    Start session
                </Button>
            </div>
        )
    }

    const visible = showAll ? threads : threads.slice(0, SESSION_PREVIEW_LIMIT)
    const remaining = threads.length - visible.length

    return (
        <ul className="flex flex-col gap-px py-0.5 pl-5 pr-1">
            {visible.map((thread) => {
                const sessionPath = `/rooms/${roomId}/sessions/${encodeURIComponent(thread.key)}`
                const isActive = activePathname === sessionPath
                return (
                    <li key={thread.key} className="group/item">
                        <div
                            className={cn(
                                'flex h-7 min-w-0 items-center gap-2 rounded-md px-2 text-[0.8125rem] text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                                isActive &&
                                    'bg-sidebar-accent font-medium text-sidebar-accent-foreground',
                            )}
                        >
                            <Link
                                to="/rooms/$roomId/sessions/$sessionKey"
                                params={{ roomId, sessionKey: thread.key }}
                                onClick={() => {
                                    markChatSelection(roomId, thread.key)
                                    onPreviewNavigate(sessionPath)
                                    void prewarmSessionDetail(queryClient, {
                                        roomId,
                                        sessionKey: thread.key,
                                    })
                                    onNavigate?.()
                                }}
                                className="flex min-w-0 flex-1 items-center"
                            >
                                <span className="min-w-0 flex-1 truncate">
                                    {thread.title || 'Untitled session'}
                                </span>
                                <SessionStatusBadge thread={thread} />
                            </Link>
                            <SidebarSessionActions
                                roomId={roomId}
                                thread={thread}
                                onDeleted={() => {
                                    if (isActive) {
                                        navigate({ to: '/rooms/$roomId', params: { roomId } })
                                    }
                                }}
                            />
                        </div>
                    </li>
                )
            })}
            {threads.length > SESSION_PREVIEW_LIMIT ? (
                <li className="pt-0.5">
                    <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="h-6 w-full justify-start px-2 text-[0.6875rem] text-muted-foreground"
                        onClick={() => setShowAll((value) => !value)}
                    >
                        {showAll ? 'Show fewer' : `Show ${remaining} more`}
                    </Button>
                </li>
            ) : null}
            {streamError ? (
                <li className="px-2 py-1 text-[0.6875rem] text-muted-foreground">{streamError}</li>
            ) : null}
        </ul>
    )
}

function isThreadActive(thread: RoomExecutionThread): boolean {
    return (
        thread.status === 'running' || thread.status === 'compacting' || thread.status === 'queued'
    )
}

function SessionStatusBadge({ thread }: { thread: RoomExecutionThread }) {
    if (thread.status === 'running' || thread.status === 'compacting') {
        return (
            <span className="ml-2 shrink-0 rounded-full bg-working-soft px-1.5 py-0.5 text-[0.625rem] font-medium text-working-fg">
                Working
            </span>
        )
    }

    if (thread.readState.unread) {
        return (
            <span
                className="ml-2 shrink-0 rounded-full bg-ready-soft px-1.5 py-0.5 text-[0.625rem] font-medium text-ready-fg"
                aria-label="Done, unread"
            >
                Done
            </span>
        )
    }

    return null
}

function SidebarSessionActions({
    roomId,
    thread,
    onDeleted,
}: {
    roomId: string
    thread: RoomExecutionThread
    onDeleted: () => void
}) {
    const title = thread.title || 'Untitled session'

    return (
        <span className="flex h-5 w-16 shrink-0 items-center justify-end">
            <span className="text-[0.6875rem] whitespace-nowrap text-muted-foreground/80 group-hover/item:hidden group-focus-within/item:hidden">
                {formatRelativeTime(thread.updatedAt)}
            </span>
            <SessionContextMenu
                roomId={roomId}
                sessionKey={thread.key}
                sessionTitle={title}
                onDeleted={onDeleted}
            >
                <SessionContextMenuTrigger
                    className="hidden group-hover/item:inline-flex group-focus-within/item:inline-flex data-[state=open]:inline-flex"
                    label={`Session options for ${title}`}
                />
            </SessionContextMenu>
        </span>
    )
}
