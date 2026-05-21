import { Link, Outlet, createFileRoute, useRouterState } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
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

import { Button } from '#/components/ui/button'
import { CardButton } from '#/components/ui/card'
import { Badge } from '#/components/ui/badge'
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
    useStartRoomSession,
} from '#/components/agent-room'
import { describeSchedule, describeSessionState } from '#/lib/state'
import { formatBytes, formatRelativeTime, pluralize } from '#/lib/format'
import { roomQueryKey, roomQueryPolicy } from '#/lib/room-query-keys'
import { requireRouteUser } from './-route-auth'
import {
    getRoomSidebarServer,
    getRoomPersonalityServer,
    getRoomSetupReadinessServer,
    listCronJobsServer,
    listRoomFilesServer,
} from './-room-runtime-server'
import { getRoomConfigServer } from './-operator-config-server'
import { SessionRunStatus } from './-session-chat/session-run-status'
import { useRoomEventCacheSync } from './-session-chat/room-event-cache'
import { personalityArchetypeProfiles } from '#/server/rooms/personality/archetypes'
import {
    personalityChallengeStyleProfiles,
    personalityDirectnessProfiles,
    personalityReportStyleProfiles,
    personalityToneProfiles,
    type PersonalityForm,
} from '#/server/rooms/personality/form'

export const Route = createFileRoute('/rooms/$roomId')({
    beforeLoad: requireRouteUser,
    component: RoomHomePage,
})

function RoomHomePage() {
    const { roomId } = Route.useParams()
    const queryClient = useQueryClient()
    const pathname = useRouterState({
        select: (state) => state.location.pathname,
    })
    useRoomEventCacheSync({ roomId, queryClient })

    if (pathname !== `/rooms/${roomId}`) {
        return <Outlet />
    }

    return <RoomHomeContent roomId={roomId} />
}

function RoomHomeContent({ roomId }: { roomId: string }) {
    const executionQuery = useQuery({
        queryKey: roomQueryKey.roomSidebar(roomId),
        queryFn: () => getRoomSidebarServer({ data: { roomId } }),
        staleTime: roomQueryPolicy.hotStaleMs,
    })
    const jobsQuery = useQuery({
        queryKey: roomQueryKey.roomCronJobs(roomId),
        queryFn: () => listCronJobsServer({ data: { roomId } }),
        staleTime: roomQueryPolicy.warmStaleMs,
    })
    const filesQuery = useQuery({
        queryKey: roomQueryKey.roomFiles(roomId),
        queryFn: () => listRoomFilesServer({ data: { roomId } }),
        staleTime: roomQueryPolicy.warmStaleMs,
    })
    const configQuery = useQuery({
        queryKey: roomQueryKey.roomConfig(roomId),
        queryFn: () => getRoomConfigServer({ data: { roomId } }),
        staleTime: roomQueryPolicy.coldStaleMs,
    })
    const personalityQuery = useQuery({
        queryKey: roomQueryKey.roomPersonality(roomId),
        queryFn: () => getRoomPersonalityServer({ data: { roomId } }),
        staleTime: roomQueryPolicy.warmStaleMs,
    })
    const readinessQuery = useQuery({
        queryKey: roomQueryKey.setupReadiness,
        queryFn: () => getRoomSetupReadinessServer(),
        staleTime: roomQueryPolicy.coldStaleMs,
    })

    const startSession = useStartRoomSession({ roomId })

    const snapshot = executionQuery.data
    const room = snapshot?.room ?? null
    const threads = snapshot?.threads ?? []
    const recentActivity = snapshot?.recentActivity ?? []
    const jobs = jobsQuery.data ?? []
    const files = filesQuery.data ?? []
    const config = configQuery.data
    const personality = personalityQuery.data?.form ?? null
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
                                    <Link
                                        to="/settings"
                                        search={{
                                            installationId: '',
                                            setupAction: '',
                                            githubState: '',
                                        }}
                                    >
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
                                            <div className="flex min-h-12 items-center justify-between gap-3 rounded-md px-1 py-1 transition-colors hover:bg-muted/50">
                                                <Link
                                                    to="/rooms/$roomId/sessions/$sessionKey"
                                                    params={{ roomId, sessionKey: thread.key }}
                                                    className="min-w-0 flex-1"
                                                >
                                                    <div className="flex items-center gap-2">
                                                        <span className="truncate text-sm font-medium">
                                                            {thread.title || 'Untitled session'}
                                                        </span>
                                                        {thread.kind === 'subagent' ||
                                                        thread.kind === 'deep_work' ? (
                                                            <span className="rounded border border-border px-1.5 py-0.5 text-[0.625rem] font-medium uppercase tracking-wide text-muted-foreground">
                                                                {thread.kind === 'subagent'
                                                                    ? 'Subtask'
                                                                    : 'Deep work'}
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
                                                <span className="flex h-10 w-5 shrink-0 items-center justify-end sm:w-40">
                                                    <span className="hidden flex-col items-end gap-1 text-xs text-muted-foreground group-hover/session:hidden group-focus-within/session:hidden sm:flex">
                                                        <SessionRunStatus thread={thread} compact />
                                                        <span>
                                                            {formatRelativeTime(thread.updatedAt)}
                                                        </span>
                                                    </span>
                                                    <SessionContextMenu
                                                        roomId={roomId}
                                                        sessionKey={thread.key}
                                                        sessionTitle={
                                                            thread.title || 'Untitled session'
                                                        }
                                                    >
                                                        <SessionContextMenuTrigger className="hidden group-hover/session:inline-flex group-focus-within/session:inline-flex data-[state=open]:inline-flex" />
                                                    </SessionContextMenu>
                                                </span>
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
                        title="Agent profile"
                        description={
                            personality
                                ? personalityArchetypeProfiles[personality.archetype].label
                                : 'Purpose and personality'
                        }
                        actions={
                            <Link to="/rooms/$roomId/settings" params={{ roomId }}>
                                <Button variant="ghost" size="xs">
                                    Edit
                                </Button>
                            </Link>
                        }
                    >
                        <AgentProfileSummary
                            personality={personality}
                            instructions={config?.config?.instructions ?? ''}
                            lastActivityAt={recentActivity[0]?.updatedAt ?? null}
                        />
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
        <>
            <span className="text-muted-foreground">{icon}</span>
            <span className="font-medium">{label}</span>
        </>
    )
    if (href) {
        return (
            <CardButton asChild className="h-full flex-col items-start gap-2 px-3 py-3">
                <Link to={href.to} params={href.params}>
                    {inner}
                </Link>
            </CardButton>
        )
    }
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <CardButton
                    onClick={onClick}
                    disabled={pending}
                    className="h-full flex-col items-start gap-2 px-3 py-3 disabled:opacity-50"
                >
                    {inner}
                </CardButton>
            </TooltipTrigger>
            <TooltipContent>{pending ? 'Working…' : label}</TooltipContent>
        </Tooltip>
    )
}

function AgentProfileSummary({
    personality,
    instructions,
    lastActivityAt,
}: {
    personality: PersonalityForm | null
    instructions: string
    lastActivityAt: number | string | null
}) {
    if (!personality) {
        return (
            <p className="text-sm text-muted-foreground">
                Personality is loading. The room keeps using its saved defaults while this view
                catches up.
            </p>
        )
    }

    const profile = personalityArchetypeProfiles[personality.archetype]
    return (
        <div className="space-y-3">
            <div>
                <p className="text-sm font-medium text-foreground">{profile.summary}</p>
                <p className="mt-1 text-sm text-muted-foreground">{profile.description}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline" className="rounded-md bg-card">
                    {personalityToneProfiles[personality.tone].label}
                </Badge>
                <Badge variant="outline" className="rounded-md bg-card">
                    {personalityDirectnessProfiles[personality.directness].label}
                </Badge>
                <Badge variant="outline" className="rounded-md bg-card">
                    {personalityReportStyleProfiles[personality.reportStyle].label}
                </Badge>
                <Badge variant="outline" className="rounded-md bg-card">
                    {personalityChallengeStyleProfiles[personality.challengeStyle].label}
                </Badge>
            </div>
            {instructions ? (
                <p className="line-clamp-4 whitespace-pre-wrap border-t border-border/60 pt-3 text-sm text-foreground">
                    {instructions}
                </p>
            ) : (
                <p className="border-t border-border/60 pt-3 text-sm text-muted-foreground">
                    No room purpose yet. Add one in settings so the agent can anchor its work.
                </p>
            )}
            {lastActivityAt ? (
                <p className="text-xs text-muted-foreground">
                    Last activity {formatRelativeTime(lastActivityAt)}
                </p>
            ) : null}
        </div>
    )
}
