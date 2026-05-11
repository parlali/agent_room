import { Link, Outlet, createFileRoute, useNavigate, useRouterState } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import {
    CalendarClockIcon,
    FileIcon,
    FolderIcon,
    MessagesSquareIcon,
    PlusIcon,
    SettingsIcon,
    UploadIcon,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '#/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip'
import { RoomDashboardLayout } from '#/components/room-dashboard'
import {
    AttentionBanner,
    EmptyState,
    LoadingPage,
    Section,
    SessionContextMenu,
    SessionContextMenuTrigger,
    StateBadge,
} from '#/components/agent-room'
import { describeSchedule, describeSessionState } from '#/lib/state'
import { formatBytes, formatRelativeTime, pluralize } from '#/lib/format'
import { requireRouteUser } from './-route-auth'
import {
    createThreadServer,
    getRoomExecutionServer,
    getRoomSetupReadinessServer,
    listCronJobsServer,
    listRoomFilesServer,
} from './-room-runtime-server'
import { getRoomConfigServer } from './-operator-config-server'
import { SessionRunStatus } from './-session-chat/session-run-status'

export const Route = createFileRoute('/rooms/$roomId')({
    beforeLoad: requireRouteUser,
    component: RoomHomePage,
})

function RoomHomePage() {
    const { roomId } = Route.useParams()
    const pathname = useRouterState({
        select: (state) => state.location.pathname,
    })

    if (pathname !== `/rooms/${roomId}`) {
        return <Outlet />
    }

    return <RoomHomeContent roomId={roomId} />
}

function RoomHomeContent({ roomId }: { roomId: string }) {
    const navigate = useNavigate()
    const queryClient = useQueryClient()

    const executionQuery = useQuery({
        queryKey: ['room-execution', roomId],
        queryFn: () => getRoomExecutionServer({ data: { roomId } }),
        staleTime: 10_000,
        refetchInterval: 20_000,
    })
    const jobsQuery = useQuery({
        queryKey: ['room-cron-jobs', roomId],
        queryFn: () => listCronJobsServer({ data: { roomId } }),
        staleTime: 30_000,
    })
    const filesQuery = useQuery({
        queryKey: ['room-files', roomId],
        queryFn: () => listRoomFilesServer({ data: { roomId } }),
        staleTime: 30_000,
    })
    const configQuery = useQuery({
        queryKey: ['room-config', roomId],
        queryFn: () => getRoomConfigServer({ data: { roomId } }),
        staleTime: 60_000,
    })
    const readinessQuery = useQuery({
        queryKey: ['room-setup-readiness'],
        queryFn: () => getRoomSetupReadinessServer(),
        staleTime: 60_000,
    })

    const startSession = useMutation({
        mutationFn: () => createThreadServer({ data: { roomId } }),
        onSuccess: async ({ key }) => {
            await queryClient.invalidateQueries({ queryKey: ['room-execution', roomId] })
            await queryClient.invalidateQueries({ queryKey: ['rooms-list'] })
            navigate({
                to: '/rooms/$roomId/sessions/$sessionKey',
                params: { roomId, sessionKey: key },
            })
        },
        onError: (e: unknown) => {
            toast.error('Could not start a new session', {
                description: e instanceof Error ? e.message : 'Unexpected error',
            })
        },
    })

    const snapshot = executionQuery.data
    const room = snapshot?.room ?? null
    const threads = snapshot?.threads ?? []
    const recentActivity = snapshot?.recentActivity ?? []
    const jobs = jobsQuery.data ?? []
    const files = filesQuery.data ?? []
    const config = configQuery.data
    const blockingIssues =
        readinessQuery.data?.issues.filter((i) => i.severity === 'blocking') ?? []

    const activeSessions = useMemo(() => {
        return threads.filter((t) => {
            if (!t.status) return false
            const lower = t.status.toLowerCase()
            return (
                lower.includes('working') ||
                lower.includes('running') ||
                lower.includes('streaming') ||
                lower.includes('thinking') ||
                lower.includes('waiting') ||
                lower.includes('approval') ||
                lower.includes('pending')
            )
        })
    }, [threads])

    const sessionRows = useMemo(() => threads.slice(0, 5), [threads])

    const upcomingJobs = useMemo(() => {
        return [...jobs]
            .filter((j) => j.enabled)
            .sort((a, b) => (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity))
            .slice(0, 5)
    }, [jobs])

    const recentFiles = useMemo(() => {
        return [...files]
            .filter((f) => f.kind === 'file')
            .sort((a, b) => {
                const at = a.updatedAt ? Date.parse(a.updatedAt) : 0
                const bt = b.updatedAt ? Date.parse(b.updatedAt) : 0
                return bt - at
            })
            .slice(0, 5)
    }, [files])

    if (executionQuery.isLoading) {
        return (
            <RoomDashboardLayout roomId={roomId} activeTab="home">
                <LoadingPage />
            </RoomDashboardLayout>
        )
    }

    const showAttention = blockingIssues.length > 0 || (room?.lastError ?? null) !== null

    return (
        <RoomDashboardLayout
            roomId={roomId}
            activeTab="home"
            headerActions={
                <Button
                    size="sm"
                    onClick={() => startSession.mutate()}
                    disabled={startSession.isPending}
                >
                    <MessagesSquareIcon /> Start session
                </Button>
            }
        >
            <div className="space-y-6">
                {showAttention ? (
                    <div className="space-y-2">
                        {room?.lastError ? (
                            <AttentionBanner
                                tone="danger"
                                title="This room ran into a problem"
                                description={room.lastError}
                                action={
                                    <Link to="/rooms/$roomId/status" params={{ roomId }}>
                                        <Button variant="outline" size="sm">
                                            Open status
                                        </Button>
                                    </Link>
                                }
                            />
                        ) : null}
                        {blockingIssues.length > 0 ? (
                            <AttentionBanner
                                tone="attention"
                                title={`Setup needs attention (${blockingIssues.length})`}
                                description={blockingIssues.map((i) => i.message).join(' · ')}
                                action={
                                    <Link to="/settings">
                                        <Button variant="outline" size="sm">
                                            Open settings
                                        </Button>
                                    </Link>
                                }
                            />
                        ) : null}
                    </div>
                ) : null}

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <ActionTile
                        icon={<MessagesSquareIcon className="size-4" />}
                        label="Start session"
                        onClick={() => startSession.mutate()}
                        pending={startSession.isPending}
                    />
                    <ActionTile
                        icon={<CalendarClockIcon className="size-4" />}
                        label="Add job"
                        href={{ to: '/rooms/$roomId/jobs', params: { roomId } }}
                    />
                    <ActionTile
                        icon={<UploadIcon className="size-4" />}
                        label="Upload file"
                        href={{ to: '/rooms/$roomId/files', params: { roomId } }}
                    />
                    <ActionTile
                        icon={<SettingsIcon className="size-4" />}
                        label="Open settings"
                        href={{ to: '/rooms/$roomId/settings', params: { roomId } }}
                    />
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                    <Section
                        title="Sessions"
                        description={`${activeSessions.length} ${pluralize(activeSessions.length, 'in flight')} · ${threads.length} ${pluralize(threads.length, 'total')}`}
                        actions={
                            threads.length > 0 ? (
                                <Link
                                    to="/rooms/$roomId/sessions/$sessionKey"
                                    params={{ roomId, sessionKey: threads[0]!.key }}
                                >
                                    <Button variant="ghost" size="xs">
                                        Open latest
                                    </Button>
                                </Link>
                            ) : null
                        }
                    >
                        {sessionRows.length === 0 ? (
                            threads.length === 0 ? (
                                <EmptyState
                                    icon={MessagesSquareIcon}
                                    title="No sessions yet"
                                    description="Start a conversation with this room."
                                    action={
                                        <Button
                                            size="sm"
                                            onClick={() => startSession.mutate()}
                                            disabled={startSession.isPending}
                                        >
                                            Start session
                                        </Button>
                                    }
                                />
                            ) : (
                                <p className="text-sm text-muted-foreground">
                                    Nothing currently in flight. {threads.length}{' '}
                                    {pluralize(threads.length, 'session')} in total.
                                </p>
                            )
                        ) : (
                            <ul className="divide-y divide-border/60">
                                {sessionRows.map((thread) => {
                                    const state = describeSessionState(thread.status)
                                    return (
                                        <li
                                            key={thread.key}
                                            className="group/session py-2 first:pt-0 last:pb-0"
                                        >
                                            <div className="flex items-center justify-between gap-3 rounded-md px-1 py-1 transition-colors hover:bg-muted/50">
                                                <Link
                                                    to="/rooms/$roomId/sessions/$sessionKey"
                                                    params={{ roomId, sessionKey: thread.key }}
                                                    className="min-w-0 flex-1"
                                                >
                                                    <div className="flex items-center gap-2">
                                                        <span className="truncate text-sm font-medium">
                                                            {thread.title || 'Untitled session'}
                                                        </span>
                                                        {thread.kind === 'subagent' ? (
                                                            <span className="rounded border border-border px-1.5 py-0.5 text-[0.625rem] font-medium uppercase tracking-wide text-muted-foreground">
                                                                Subtask
                                                            </span>
                                                        ) : null}
                                                        <StateBadge
                                                            tone={state.tone}
                                                            label={state.label}
                                                            pulse={state.tone === 'working'}
                                                        />
                                                    </div>
                                                    {thread.lastMessagePreview ? (
                                                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                                            {thread.lastMessagePreview}
                                                        </p>
                                                    ) : null}
                                                </Link>
                                                <div className="hidden shrink-0 flex-col items-end gap-1 text-xs text-muted-foreground group-hover/session:hidden sm:flex">
                                                    <SessionRunStatus thread={thread} compact />
                                                    <span>
                                                        {formatRelativeTime(thread.updatedAt)}
                                                    </span>
                                                </div>
                                                <SessionContextMenu
                                                    roomId={roomId}
                                                    sessionKey={thread.key}
                                                    sessionTitle={
                                                        thread.title || 'Untitled session'
                                                    }
                                                >
                                                    <SessionContextMenuTrigger className="hidden shrink-0 group-hover/session:flex" />
                                                </SessionContextMenu>
                                            </div>
                                        </li>
                                    )
                                })}
                            </ul>
                        )}
                    </Section>

                    <Section
                        title="Upcoming jobs"
                        description={`${jobs.length} ${pluralize(jobs.length, 'job')} configured`}
                        actions={
                            <Link to="/rooms/$roomId/jobs" params={{ roomId }}>
                                <Button variant="ghost" size="xs">
                                    View all
                                </Button>
                            </Link>
                        }
                    >
                        {upcomingJobs.length === 0 ? (
                            <EmptyState
                                icon={CalendarClockIcon}
                                title="No scheduled jobs"
                                description="Schedule something this room should do automatically."
                                action={
                                    <Link to="/rooms/$roomId/jobs" params={{ roomId }}>
                                        <Button size="sm" variant="outline">
                                            <PlusIcon /> Add job
                                        </Button>
                                    </Link>
                                }
                            />
                        ) : (
                            <ul className="divide-y divide-border/60">
                                {upcomingJobs.map((job) => (
                                    <li key={job.id} className="py-2 first:pt-0 last:pb-0">
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate text-sm font-medium">
                                                    {job.name}
                                                </p>
                                                <p className="mt-0.5 text-xs text-muted-foreground">
                                                    {job.scheduleSummary || describeSchedule(null)}
                                                </p>
                                            </div>
                                            <span className="shrink-0 text-xs text-muted-foreground">
                                                {job.nextRunAt
                                                    ? formatRelativeTime(job.nextRunAt)
                                                    : 'Manual'}
                                            </span>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </Section>

                    <Section
                        title="Recent outputs"
                        description={`${files.length} ${pluralize(files.length, 'file')} total`}
                        actions={
                            <Link to="/rooms/$roomId/files" params={{ roomId }}>
                                <Button variant="ghost" size="xs">
                                    View files
                                </Button>
                            </Link>
                        }
                    >
                        {recentFiles.length === 0 ? (
                            <EmptyState
                                icon={FolderIcon}
                                title="Nothing here yet"
                                description="Files this room creates or you upload will show up here."
                            />
                        ) : (
                            <ul className="divide-y divide-border/60">
                                {recentFiles.map((file) => (
                                    <li
                                        key={`${file.surface}:${file.relativePath}`}
                                        className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
                                    >
                                        <div className="flex min-w-0 flex-1 items-center gap-2">
                                            <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
                                            <span className="truncate text-sm">{file.name}</span>
                                            <span className="shrink-0 text-xs text-muted-foreground">
                                                {formatBytes(file.byteLength)}
                                            </span>
                                        </div>
                                        <span className="shrink-0 text-xs text-muted-foreground">
                                            {formatRelativeTime(file.updatedAt)}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </Section>

                    <Section
                        title="About this room"
                        description="Friendly summary"
                        actions={
                            <Link to="/rooms/$roomId/settings" params={{ roomId }}>
                                <Button variant="ghost" size="xs">
                                    Edit
                                </Button>
                            </Link>
                        }
                    >
                        {config?.config?.instructions ? (
                            <p className="line-clamp-6 whitespace-pre-wrap text-sm text-foreground">
                                {config.config.instructions}
                            </p>
                        ) : (
                            <p className="text-sm text-muted-foreground">
                                No instructions yet. Add a short purpose to help this room work
                                better.
                            </p>
                        )}
                        {recentActivity.length > 0 ? (
                            <p className="mt-3 text-xs text-muted-foreground">
                                Last activity {formatRelativeTime(recentActivity[0]!.updatedAt)}
                            </p>
                        ) : null}
                    </Section>
                </div>
            </div>
        </RoomDashboardLayout>
    )
}

function ActionTile({
    icon,
    label,
    onClick,
    pending,
    href,
}: {
    icon: React.ReactNode
    label: string
    onClick?: () => void
    pending?: boolean
    href?: {
        to: '/rooms/$roomId/files' | '/rooms/$roomId/jobs' | '/rooms/$roomId/settings'
        params: { roomId: string }
    }
}) {
    const inner = (
        <div className="flex h-full flex-col items-start gap-2 rounded-lg border border-border/70 bg-card px-3 py-3 text-sm transition-colors hover:bg-accent/40">
            <span className="text-muted-foreground">{icon}</span>
            <span className="font-medium">{label}</span>
        </div>
    )
    if (href) {
        return (
            <Link to={href.to} params={href.params} className="block">
                {inner}
            </Link>
        )
    }
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <button
                    type="button"
                    onClick={onClick}
                    disabled={pending}
                    className="block w-full cursor-pointer text-left disabled:opacity-50"
                >
                    {inner}
                </button>
            </TooltipTrigger>
            <TooltipContent>{pending ? 'Working…' : label}</TooltipContent>
        </Tooltip>
    )
}
