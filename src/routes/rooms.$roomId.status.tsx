import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
    AlertTriangleIcon,
    CalendarClockIcon,
    CheckCircle2Icon,
    ClockIcon,
    FolderIcon,
    KeyRoundIcon,
    LoaderIcon,
    SparklesIcon,
    XCircleIcon,
} from 'lucide-react'
import { useMemo, useState } from 'react'

import { RoomDashboardLayout } from '#/components/room-dashboard'
import {
    AttentionBanner,
    EmptyState,
    LoadingPage,
    Section,
    StateBadge,
    StatusDot,
} from '#/components/agent-room'
import { Button } from '#/components/ui/button'
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from '#/components/ui/sheet'
import { ScrollArea } from '#/components/ui/scroll-area'
import { formatDurationMs, formatRelativeTime } from '#/lib/format'
import { describeJobLastRun, describeSessionState, type Tone } from '#/lib/state'
import {
    getRoomExecutionServer,
    getRoomSetupReadinessServer,
    listCronJobsServer,
    listRoomRunHistoryServer,
} from './-room-runtime-server'
import { getRoomConfigServer } from './-operator-config-server'
import { requireRouteUser } from './-route-auth'
import type {
    RoomCronJob,
    RoomExecutionSnapshot,
    RoomRunHistoryEntry,
} from '#/server/rooms/execution-types'
import type { RoomConfigSnapshot } from '#/server/configuration/operator-configuration'
import type { RoomSetupReadinessSnapshot } from '#/server/rooms/runtime-readiness'

export const Route = createFileRoute('/rooms/$roomId/status')({
    beforeLoad: requireRouteUser,
    component: RoomStatusPage,
})

const ONE_HOUR_MS = 60 * 60 * 1000
type OverallTone = 'ready' | 'working' | 'attention' | 'danger'
type FixTo = '/rooms/$roomId/settings' | '/rooms/$roomId/jobs'

interface OverallStatus {
    tone: OverallTone
    label: string
    description: string
}
interface CheckRow {
    icon: typeof CheckCircle2Icon
    tone: Tone
    label: string
    detail: string
    fixTo?: FixTo
    fixLabel?: string
}

function classifyRun(status: string | null) {
    return describeJobLastRun(status)
}
function isFailed(e: RoomRunHistoryEntry) {
    return classifyRun(e.status).tone === 'danger'
}
function isSucceeded(e: RoomRunHistoryEntry) {
    return classifyRun(e.status).tone === 'ready'
}

function buildOverall(input: {
    execution: RoomExecutionSnapshot | null
    config: RoomConfigSnapshot | null
    readiness: RoomSetupReadinessSnapshot | null
    history: RoomRunHistoryEntry[]
}): OverallStatus {
    const { execution, config, readiness, history } = input
    const room = execution?.room ?? null
    if (room?.status === 'failed' || execution?.executionState === 'error') {
        return {
            tone: 'danger',
            label: 'Failed',
            description:
                room?.lastError ?? execution?.executionMessage ?? 'This room could not start.',
        }
    }
    const blocking = readiness?.issues.find((i) => i.severity === 'blocking') ?? null
    if (blocking)
        return { tone: 'attention', label: 'Needs attention', description: blocking.message }
    const blockedReason = config?.effective.blockedReasons[0] ?? null
    if (blockedReason && !config?.effective.ready) {
        return { tone: 'attention', label: 'Needs attention', description: blockedReason }
    }
    if (room?.desiredState === 'stopped') {
        return {
            tone: 'attention',
            label: 'Paused',
            description:
                'This room is paused. Resume from the room header to run jobs and sessions.',
        }
    }
    if (room?.lastError)
        return { tone: 'attention', label: 'Needs attention', description: room.lastError }
    const recent = history.find((e) => isFailed(e) && Date.now() - e.ts <= ONE_HOUR_MS)
    if (recent) {
        return {
            tone: 'attention',
            label: 'Needs attention',
            description:
                recent.error ??
                recent.summary ??
                `Last run of ${recent.jobName ?? 'a session'} failed.`,
        }
    }
    if (room?.status === 'starting') {
        return {
            tone: 'working',
            label: 'Working on something',
            description: 'The room is starting up.',
        }
    }
    const working = execution?.threads.find(
        (t) => describeSessionState(t.status).tone === 'working',
    )
    if (working) {
        return {
            tone: 'working',
            label: 'Working on something',
            description: working.title
                ? `Active session: ${working.title}`
                : 'A session is running right now.',
        }
    }
    if (room?.status === 'running') {
        return {
            tone: 'ready',
            label: 'Ready',
            description: 'Everything in this room is ready to run.',
        }
    }
    return {
        tone: 'attention',
        label: 'Needs attention',
        description: execution?.executionMessage ?? 'This room is not currently reachable.',
    }
}

const overallToneClass: Record<OverallTone, string> = {
    ready: 'border-ready/40 bg-ready-soft text-ready-fg',
    working: 'border-working/40 bg-working-soft text-working-fg',
    attention: 'border-attention/40 bg-attention-soft text-attention-fg',
    danger: 'border-danger/40 bg-danger-soft text-danger-fg',
}

function OverallBanner({ status }: { status: OverallStatus }) {
    const Icon =
        status.tone === 'ready'
            ? CheckCircle2Icon
            : status.tone === 'working'
              ? LoaderIcon
              : status.tone === 'danger'
                ? XCircleIcon
                : AlertTriangleIcon
    return (
        <div
            className={`flex items-start gap-3 rounded-xl border px-4 py-4 ${overallToneClass[status.tone]}`}
            role={status.tone === 'danger' ? 'alert' : 'status'}
        >
            <Icon
                className={`size-6 shrink-0 ${status.tone === 'working' ? 'animate-spin' : ''}`}
                aria-hidden
            />
            <div className="min-w-0 flex-1">
                <div className="text-base font-semibold leading-tight">{status.label}</div>
                <p className="mt-1 text-sm leading-relaxed opacity-90">{status.description}</p>
            </div>
        </div>
    )
}

function modelConnectionRow(config: RoomConfigSnapshot | null): CheckRow {
    if (!config)
        return {
            icon: KeyRoundIcon,
            tone: 'muted',
            label: 'Model connection',
            detail: 'Loading model status.',
        }
    if (config.effective.ready) {
        const label = config.effective.providerLabel ?? config.effective.provider ?? 'Default model'
        const model = config.effective.model
        return {
            icon: KeyRoundIcon,
            tone: 'ready',
            label: 'Model connection',
            detail: model ? `Connected to ${label} (${model}).` : `Connected to ${label}.`,
        }
    }
    const reason = config.effective.blockedReasons[0]
    const isMissing = config.effective.providerSource === 'missing'
    return {
        icon: KeyRoundIcon,
        tone: isMissing ? 'danger' : 'attention',
        label: 'Model connection',
        detail:
            reason ??
            (isMissing
                ? 'No model is connected to this room.'
                : 'Model needs a key or finishing setup.'),
        fixTo: '/rooms/$roomId/settings',
        fixLabel: isMissing ? 'Connect' : 'Fix',
    }
}

function jobsRow(jobs: RoomCronJob[], history: RoomRunHistoryEntry[]): CheckRow {
    const enabled = jobs.filter((j) => j.enabled)
    const lastJobRun = history.find((e) => e.jobId)
    if (jobs.length === 0)
        return {
            icon: CalendarClockIcon,
            tone: 'muted',
            label: 'Jobs',
            detail: 'No scheduled jobs yet.',
        }
    if (enabled.length === 0) {
        return {
            icon: CalendarClockIcon,
            tone: 'muted',
            label: 'Jobs',
            detail: 'All jobs are paused.',
            fixTo: '/rooms/$roomId/jobs',
            fixLabel: 'Open jobs',
        }
    }
    if (lastJobRun && isFailed(lastJobRun)) {
        return {
            icon: CalendarClockIcon,
            tone: 'attention',
            label: 'Jobs',
            detail:
                lastJobRun.error ??
                lastJobRun.summary ??
                `Last run of ${lastJobRun.jobName ?? 'a job'} failed.`,
            fixTo: '/rooms/$roomId/jobs',
        }
    }
    return {
        icon: CalendarClockIcon,
        tone: 'ready',
        label: 'Jobs',
        detail: `${enabled.length} ${enabled.length === 1 ? 'job is' : 'jobs are'} scheduled and running normally.`,
    }
}

function setupRow(readiness: RoomSetupReadinessSnapshot | null): CheckRow {
    if (!readiness)
        return {
            icon: SparklesIcon,
            tone: 'muted',
            label: 'Room setup',
            detail: 'Loading setup status.',
        }
    if (!readiness.hasBlockingIssues) {
        return {
            icon: SparklesIcon,
            tone: 'ready',
            label: 'Room setup',
            detail: 'All setup checks pass.',
        }
    }
    const blocking = readiness.issues.filter((i) => i.severity === 'blocking')
    return {
        icon: SparklesIcon,
        tone: 'attention',
        label: 'Room setup',
        detail:
            blocking.length === 1
                ? blocking[0]!.message
                : `${blocking.length} setup issues need attention. First: ${blocking[0]!.message}`,
        fixTo: '/rooms/$roomId/settings',
    }
}

function CheckCard({ roomId, row }: { roomId: string; row: CheckRow }) {
    const Icon = row.icon
    return (
        <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-card px-4 py-3">
            <span className="mt-0.5">
                <StatusDot tone={row.tone} />
            </span>
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="text-sm font-medium text-foreground">{row.label}</div>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{row.detail}</p>
            </div>
            {row.fixTo ? (
                <Button asChild variant="outline" size="sm">
                    <Link to={row.fixTo} params={{ roomId }}>
                        {row.fixLabel ?? 'Fix'}
                    </Link>
                </Button>
            ) : null}
        </div>
    )
}

function lastWorkLink(roomId: string, entry: RoomRunHistoryEntry, label: string) {
    const cls = 'font-medium text-foreground underline-offset-4 hover:underline'
    if (entry.sessionKey) {
        return (
            <Link
                to="/rooms/$roomId/sessions/$sessionKey"
                params={{ roomId, sessionKey: entry.sessionKey }}
                className={cls}
            >
                {label}
            </Link>
        )
    }
    if (entry.jobId) {
        return (
            <Link to="/rooms/$roomId/jobs" params={{ roomId }} className={cls}>
                {label}
            </Link>
        )
    }
    return <span className={cls}>{label}</span>
}

function LastWorkRow({
    title,
    icon: Icon,
    entry,
    roomId,
    emptyText,
}: {
    title: string
    icon: typeof CheckCircle2Icon
    entry: RoomRunHistoryEntry | null
    roomId: string
    emptyText: string
}) {
    return (
        <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-card px-4 py-3">
            <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">{title}</div>
                {entry ? (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {formatRelativeTime(entry.ts)}
                        {' · '}
                        {lastWorkLink(roomId, entry, entry.jobName ?? 'Session message')}
                    </p>
                ) : (
                    <p className="mt-0.5 text-xs text-muted-foreground">{emptyText}</p>
                )}
            </div>
        </div>
    )
}

function RecentRunsSection({
    history,
    onSelect,
}: {
    history: RoomRunHistoryEntry[]
    onSelect: (entry: RoomRunHistoryEntry) => void
}) {
    const visible = history.slice(0, 8)
    if (visible.length === 0) {
        return (
            <Section title="Recent runs" description="Most recent first.">
                <EmptyState
                    icon={ClockIcon}
                    title="No runs yet"
                    description="Sessions and job runs will show here once they happen."
                />
            </Section>
        )
    }
    return (
        <Section
            title="Recent runs"
            description="Most recent first. Click a run to see the reason."
            bodyClassName="p-0"
        >
            <ul className="divide-y divide-border/60">
                {visible.map((entry) => {
                    const outcome = classifyRun(entry.status)
                    const subtitle = entry.summary ?? entry.error ?? null
                    return (
                        <li key={entry.id}>
                            <button
                                type="button"
                                onClick={() => onSelect(entry)}
                                className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
                            >
                                <span className="mt-1.5">
                                    <StatusDot tone={outcome.tone} />
                                </span>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="truncate text-sm font-medium text-foreground">
                                            {entry.jobName ?? 'Session message'}
                                        </span>
                                        <StateBadge tone={outcome.tone} label={outcome.label} />
                                    </div>
                                    {subtitle ? (
                                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                            {subtitle}
                                        </p>
                                    ) : null}
                                </div>
                                <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                                    {formatRelativeTime(entry.ts)}
                                </span>
                            </button>
                        </li>
                    )
                })}
            </ul>
        </Section>
    )
}

function RunDetailSheet({
    entry,
    open,
    onOpenChange,
    roomId,
}: {
    entry: RoomRunHistoryEntry | null
    open: boolean
    onOpenChange: (next: boolean) => void
    roomId: string
}) {
    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="flex flex-col gap-0">
                <SheetHeader className="border-b border-border/60">
                    <SheetTitle>{entry?.jobName ?? 'Session message'}</SheetTitle>
                    <SheetDescription>
                        {entry ? formatRelativeTime(entry.ts) : 'Run details'}
                    </SheetDescription>
                </SheetHeader>
                <ScrollArea className="flex-1">
                    {entry ? (
                        <div className="space-y-4 p-4">
                            <div className="flex items-center gap-2">
                                <StateBadge
                                    tone={classifyRun(entry.status).tone}
                                    label={classifyRun(entry.status).label}
                                />
                                {entry.durationMs !== null ? (
                                    <span className="text-xs text-muted-foreground">
                                        Took {formatDurationMs(entry.durationMs)}
                                    </span>
                                ) : null}
                            </div>
                            {entry.summary ? (
                                <DetailBlock title="What happened" body={entry.summary} />
                            ) : null}
                            {entry.error ? (
                                <DetailBlock title="Reason" body={entry.error} danger />
                            ) : null}
                            <div className="flex flex-wrap gap-2 pt-2">
                                {entry.sessionKey ? (
                                    <Button asChild variant="outline" size="sm">
                                        <Link
                                            to="/rooms/$roomId/sessions/$sessionKey"
                                            params={{ roomId, sessionKey: entry.sessionKey }}
                                        >
                                            Open session
                                        </Link>
                                    </Button>
                                ) : null}
                                {entry.jobId ? (
                                    <Button asChild variant="outline" size="sm">
                                        <Link to="/rooms/$roomId/jobs" params={{ roomId }}>
                                            Open jobs
                                        </Link>
                                    </Button>
                                ) : null}
                            </div>
                        </div>
                    ) : null}
                </ScrollArea>
            </SheetContent>
        </Sheet>
    )
}

function DetailBlock({ title, body, danger }: { title: string; body: string; danger?: boolean }) {
    return (
        <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {title}
            </div>
            <p
                className={`mt-1 whitespace-pre-wrap text-sm leading-relaxed ${danger ? 'text-danger-fg' : 'text-foreground'}`}
            >
                {body}
            </p>
        </div>
    )
}

function RoomStatusPage() {
    const { roomId } = Route.useParams()
    const executionQuery = useQuery({
        queryKey: ['room-execution', roomId],
        queryFn: () => getRoomExecutionServer({ data: { roomId } }),
        staleTime: 5_000,
    })
    const configQuery = useQuery({
        queryKey: ['room-config', roomId],
        queryFn: () => getRoomConfigServer({ data: { roomId } }),
        staleTime: 30_000,
    })
    const readinessQuery = useQuery({
        queryKey: ['room-setup-readiness'],
        queryFn: () => getRoomSetupReadinessServer(),
        staleTime: 10_000,
    })
    const historyQuery = useQuery({
        queryKey: ['room-run-history', roomId],
        queryFn: () => listRoomRunHistoryServer({ data: { roomId, limit: 20 } }),
        staleTime: 5_000,
    })
    const jobsQuery = useQuery({
        queryKey: ['room-cron-jobs', roomId],
        queryFn: () => listCronJobsServer({ data: { roomId } }),
        staleTime: 5_000,
    })

    const [selectedRun, setSelectedRun] = useState<RoomRunHistoryEntry | null>(null)

    const initialLoading =
        executionQuery.isLoading ||
        configQuery.isLoading ||
        readinessQuery.isLoading ||
        historyQuery.isLoading ||
        jobsQuery.isLoading

    const execution = executionQuery.data ?? null
    const config = configQuery.data ?? null
    const readiness = readinessQuery.data ?? null
    const history = historyQuery.data?.entries ?? []
    const jobs = jobsQuery.data ?? []

    const overall = useMemo(
        () => buildOverall({ execution, config, readiness, history }),
        [execution, config, readiness, history],
    )
    const checks: CheckRow[] = useMemo(
        () => [
            modelConnectionRow(config),
            jobsRow(jobs, history),
            {
                icon: FolderIcon,
                tone: 'ready',
                label: 'Files',
                detail: 'File workspace is available.',
            },
            setupRow(readiness),
        ],
        [config, jobs, history, readiness],
    )
    const lastSuccess = useMemo(() => history.find((e) => isSucceeded(e)) ?? null, [history])
    const lastFailure = useMemo(() => history.find((e) => isFailed(e)) ?? null, [history])
    const mismatchCount = historyQuery.data?.mismatchCount ?? 0

    if (initialLoading) {
        return (
            <RoomDashboardLayout roomId={roomId} activeTab="status">
                <LoadingPage />
            </RoomDashboardLayout>
        )
    }

    return (
        <RoomDashboardLayout roomId={roomId} activeTab="status">
            <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
                <OverallBanner status={overall} />
                {mismatchCount > 0 ? (
                    <AttentionBanner
                        tone="attention"
                        title="Some past runs do not match this room"
                        description={`${mismatchCount} ${mismatchCount === 1 ? 'run is' : 'runs are'} hidden because they belong to another room agent.`}
                    />
                ) : null}
                <Section title="Checks" description="What is working in this room right now.">
                    <div className="grid gap-2 sm:grid-cols-2">
                        {checks.map((row) => (
                            <CheckCard key={row.label} roomId={roomId} row={row} />
                        ))}
                    </div>
                </Section>
                <RecentRunsSection history={history} onSelect={setSelectedRun} />
                <div className="grid gap-3 sm:grid-cols-2">
                    <LastWorkRow
                        title="Last successful work"
                        icon={CheckCircle2Icon}
                        entry={lastSuccess}
                        roomId={roomId}
                        emptyText="Nothing has finished yet."
                    />
                    <LastWorkRow
                        title="Last failed work"
                        icon={AlertTriangleIcon}
                        entry={lastFailure}
                        roomId={roomId}
                        emptyText="No failures recorded."
                    />
                </div>
            </div>
            <RunDetailSheet
                entry={selectedRun}
                open={selectedRun !== null}
                onOpenChange={(next) => {
                    if (!next) setSelectedRun(null)
                }}
                roomId={roomId}
            />
        </RoomDashboardLayout>
    )
}
