import { useState } from 'react'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
    ChevronRight,
    CopyIcon,
    Loader2Icon,
    MoreHorizontalIcon,
    PencilIcon,
    Plus,
    Trash2Icon,
} from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '#/lib/utils'
import { describeRoomState } from '#/lib/state'
import { formatRelativeTime } from '#/lib/format'
import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import { StatusDot } from '#/components/agent-room'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '#/components/ui/dialog'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { copyText } from '#/lib/clipboard'
import {
    createThreadServer,
    deleteSessionServer,
    getRoomExecutionServer,
    renameSessionServer,
} from '#/routes/-room-runtime-server'
import type { RoomExecutionThread, RoomRuntimeOverview } from '#/server/rooms/execution-types'

const SESSION_PREVIEW_LIMIT = 5

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
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const startSession = useMutation({
        mutationFn: () => createThreadServer({ data: { roomId: room.roomId } }),
        onSuccess: async ({ key }) => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['room-execution', room.roomId] }),
                queryClient.invalidateQueries({
                    queryKey: ['room-execution', room.roomId, 'sidebar'],
                }),
                queryClient.invalidateQueries({ queryKey: ['rooms-list'] }),
            ])
            onNavigate?.()
            navigate({
                to: '/rooms/$roomId/sessions/$sessionKey',
                params: { roomId: room.roomId, sessionKey: key },
            })
        },
        onError: (e: unknown) => {
            toast.error('Could not start a new session', {
                description: e instanceof Error ? e.message : 'Unexpected error',
            })
        },
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
    const navigate = useNavigate()
    const [showAll, setShowAll] = useState(false)
    const query = useQuery({
        queryKey: ['room-execution', roomId, 'sidebar'],
        queryFn: () => getRoomExecutionServer({ data: { roomId } }),
        staleTime: 15_000,
    })

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
                <Link to="/rooms/$roomId" params={{ roomId }} onClick={onNavigate}>
                    <Button variant="ghost" size="xs" className="h-6 w-full justify-start">
                        <Plus className="size-3" />
                        Start session
                    </Button>
                </Link>
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
                                onClick={onNavigate}
                                className="flex min-w-0 flex-1 items-center"
                            >
                                <span className="min-w-0 flex-1 truncate">
                                    {thread.title || 'Untitled session'}
                                </span>
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
        </ul>
    )
}

type SidebarSessionDialog =
    | { type: 'closed' }
    | { type: 'rename'; title: string }
    | { type: 'delete' }

function SidebarSessionActions({
    roomId,
    thread,
    onDeleted,
}: {
    roomId: string
    thread: RoomExecutionThread
    onDeleted: () => void
}) {
    const queryClient = useQueryClient()
    const [dialog, setDialog] = useState<SidebarSessionDialog>({ type: 'closed' })
    const title = thread.title || 'Untitled session'

    const renameMutation = useMutation({
        mutationFn: (nextTitle: string) =>
            renameSessionServer({ data: { roomId, sessionKey: thread.key, title: nextTitle } }),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['room-execution', roomId] }),
                queryClient.invalidateQueries({ queryKey: ['room-execution', roomId, 'sidebar'] }),
                queryClient.invalidateQueries({
                    queryKey: ['room-execution', roomId, thread.key],
                }),
            ])
            toast.success('Session renamed')
            setDialog({ type: 'closed' })
        },
        onError: (error: unknown) => {
            toast.error('Failed to rename session', {
                description: error instanceof Error ? error.message : 'Unexpected error',
            })
        },
    })

    const deleteMutation = useMutation({
        mutationFn: () => deleteSessionServer({ data: { roomId, sessionKey: thread.key } }),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['room-execution', roomId] }),
                queryClient.invalidateQueries({ queryKey: ['room-execution', roomId, 'sidebar'] }),
                queryClient.invalidateQueries({
                    queryKey: ['room-execution', roomId, thread.key],
                }),
            ])
            toast.success('Session deleted')
            setDialog({ type: 'closed' })
            onDeleted()
        },
        onError: (error: unknown) => {
            toast.error('Failed to delete session', {
                description: error instanceof Error ? error.message : 'Unexpected error',
            })
        },
    })

    const isPending = renameMutation.isPending || deleteMutation.isPending

    const copySessionLink = async () => {
        try {
            const path = `/rooms/${encodeURIComponent(roomId)}/sessions/${encodeURIComponent(thread.key)}`
            await copyText(`${window.location.origin}${path}`)
            toast.success('Session link copied')
        } catch {
            toast.error('Could not copy session link')
        }
    }

    return (
        <>
            <span className="flex h-5 w-16 shrink-0 items-center justify-end">
                <span className="text-[0.6875rem] whitespace-nowrap text-muted-foreground/80 group-hover/item:hidden group-focus-within/item:hidden">
                    {formatRelativeTime(thread.updatedAt)}
                </span>
                <DropdownMenu>
                    <DropdownMenuTrigger
                        className="hidden size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 group-hover/item:inline-flex group-focus-within/item:inline-flex data-[state=open]:inline-flex"
                        aria-label={`Session options for ${title}`}
                    >
                        <MoreHorizontalIcon className="size-3.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem onSelect={() => void copySessionLink()}>
                            <CopyIcon className="size-4" />
                            Copy link
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setDialog({ type: 'rename', title })}>
                            <PencilIcon className="size-4" />
                            Rename
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => setDialog({ type: 'delete' })}
                        >
                            <Trash2Icon className="size-4" />
                            Delete
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </span>

            <Dialog
                open={dialog.type === 'rename'}
                onOpenChange={(nextOpen) => {
                    if (!nextOpen && !isPending) setDialog({ type: 'closed' })
                }}
            >
                <DialogContent>
                    <form
                        onSubmit={(event) => {
                            event.preventDefault()
                            if (dialog.type === 'rename' && dialog.title.trim()) {
                                renameMutation.mutate(dialog.title.trim())
                            }
                        }}
                    >
                        <DialogHeader>
                            <DialogTitle>Rename session</DialogTitle>
                            <DialogDescription>
                                Give this session a memorable name.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="py-4">
                            <Label htmlFor={`session-title-${thread.key}`} className="sr-only">
                                Session title
                            </Label>
                            <Input
                                id={`session-title-${thread.key}`}
                                value={dialog.type === 'rename' ? dialog.title : ''}
                                onChange={(event) =>
                                    setDialog({ type: 'rename', title: event.target.value })
                                }
                                placeholder="Session title"
                                autoFocus
                                disabled={isPending}
                            />
                        </div>
                        <DialogFooter>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => setDialog({ type: 'closed' })}
                                disabled={isPending}
                            >
                                Cancel
                            </Button>
                            <Button
                                type="submit"
                                disabled={
                                    isPending || (dialog.type === 'rename' && !dialog.title.trim())
                                }
                            >
                                {renameMutation.isPending ? (
                                    <Loader2Icon className="animate-spin" />
                                ) : null}
                                Save
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <Dialog
                open={dialog.type === 'delete'}
                onOpenChange={(nextOpen) => {
                    if (!nextOpen && !isPending) setDialog({ type: 'closed' })
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete this session?</DialogTitle>
                        <DialogDescription>
                            "{title}" and all its messages will be permanently deleted. This cannot
                            be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setDialog({ type: 'closed' })}
                            disabled={isPending}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={() => deleteMutation.mutate()}
                            disabled={isPending}
                        >
                            {deleteMutation.isPending ? (
                                <Loader2Icon className="animate-spin" />
                            ) : (
                                <Trash2Icon />
                            )}
                            Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
