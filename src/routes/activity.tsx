import { createFileRoute, Link } from '@tanstack/react-router'
import { useQueries, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { ActivityIcon, CalendarClockIcon, FileTextIcon, MessagesSquareIcon } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { AppShell } from '#/components/app-shell'
import {
    EmptyState,
    LoadingRows,
    PageHeader,
    RoomGlyph,
    Section,
    StateBadge,
} from '#/components/agent-room'
import { formatRelativeTime } from '#/lib/format'
import { describeJobLastRun, describeSessionState } from '#/lib/state'
import {
    getRoomExecutionServer,
    listCronJobsServer,
    listRoomFilesServer,
    listRoomsServer,
} from './-room-runtime-server'
import { requireRouteUser } from './-route-auth'
import type {
    RoomCronJob,
    RoomExecutionSnapshot,
    RoomRuntimeOverview,
} from '#/server/rooms/execution-types'

type RoomFileEntry = {
    name: string
    relativePath: string
    surface: 'workspace' | 'store'
    kind: 'file' | 'directory'
    byteLength: number | null
    updatedAt: string | null
}

export const Route = createFileRoute('/activity')({
    beforeLoad: requireRouteUser,
    component: ActivityPage,
})

type ActivityKind = 'session' | 'job' | 'file'

interface ActivityRow {
    id: string
    kind: ActivityKind
    icon: LucideIcon
    title: string
    description: string
    statusLabel: string | null
    tone: 'ready' | 'working' | 'attention' | 'danger' | 'muted' | 'info'
    timestamp: number
    href:
        | {
              to: '/rooms/$roomId/sessions/$sessionKey'
              params: { roomId: string; sessionKey: string }
          }
        | { to: '/rooms/$roomId/jobs'; params: { roomId: string } }
        | { to: '/rooms/$roomId/files'; params: { roomId: string } }
    room: RoomRuntimeOverview
}

function ActivityPage() {
    const roomsQuery = useQuery({
        queryKey: ['rooms-list'],
        queryFn: () => listRoomsServer(),
        staleTime: 30_000,
    })
    const rooms = roomsQuery.data ?? []

    const executionQueries = useQueries({
        queries: rooms.map((room) => ({
            queryKey: ['activity-room-execution', room.roomId],
            queryFn: () =>
                getRoomExecutionServer({
                    data: { roomId: room.roomId, selectedThreadKey: null },
                }),
            staleTime: 30_000,
        })),
    })

    const jobQueries = useQueries({
        queries: rooms.map((room) => ({
            queryKey: ['activity-room-jobs', room.roomId],
            queryFn: () => listCronJobsServer({ data: { roomId: room.roomId } }),
            staleTime: 30_000,
        })),
    })

    const fileQueries = useQueries({
        queries: rooms.map((room) => ({
            queryKey: ['activity-room-files', room.roomId],
            queryFn: () => listRoomFilesServer({ data: { roomId: room.roomId } }),
            staleTime: 30_000,
        })),
    })

    const rows = useMemo(() => {
        return buildActivityRows({
            rooms,
            executions: executionQueries.map((q) => q.data as RoomExecutionSnapshot | undefined),
            jobs: jobQueries.map((q) => q.data as RoomCronJob[] | undefined),
            files: fileQueries.map((q) => q.data as RoomFileEntry[] | undefined),
        })
    }, [rooms, executionQueries, jobQueries, fileQueries])

    const isLoading =
        roomsQuery.isLoading ||
        executionQueries.some((q) => q.isLoading) ||
        jobQueries.some((q) => q.isLoading) ||
        fileQueries.some((q) => q.isLoading)

    return (
        <AppShell>
            <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
                <PageHeader
                    title="Activity"
                    subtitle="Sessions, jobs, and files across every room."
                />

                <div className="mt-6">
                    <Section
                        title="Recent"
                        description={
                            rows.length > 0
                                ? `Latest ${Math.min(rows.length, 80)} events.`
                                : 'Nothing yet.'
                        }
                        bodyClassName={isLoading || rows.length === 0 ? 'p-4' : 'p-0'}
                    >
                        {isLoading && rows.length === 0 ? (
                            <LoadingRows count={5} />
                        ) : rows.length === 0 ? (
                            <EmptyState
                                icon={ActivityIcon}
                                title="Nothing yet"
                                description="Start a session in any room to see it appear here."
                            />
                        ) : (
                            <ul className="divide-y divide-border/60">
                                {rows.slice(0, 80).map((row) => (
                                    <ActivityListItem key={row.id} row={row} />
                                ))}
                            </ul>
                        )}
                    </Section>
                </div>
            </div>
        </AppShell>
    )
}

function ActivityListItem({ row }: { row: ActivityRow }) {
    const Icon = row.icon
    return (
        <li>
            <Link
                {...row.href}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/40"
            >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <Icon className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <RoomGlyph name={row.room.displayName} seed={row.room.roomId} size="xs" />
                        <p className="truncate text-sm text-foreground">
                            <span className="font-medium">{row.room.displayName}</span>
                            <span className="text-muted-foreground"> · {row.title}</span>
                        </p>
                    </div>
                    {row.description ? (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {row.description}
                        </p>
                    ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                    {row.statusLabel ? (
                        <StateBadge tone={row.tone} label={row.statusLabel} />
                    ) : null}
                    <span className="hidden text-xs text-muted-foreground sm:inline">
                        {formatRelativeTime(row.timestamp)}
                    </span>
                </div>
            </Link>
        </li>
    )
}

function buildActivityRows(input: {
    rooms: RoomRuntimeOverview[]
    executions: Array<RoomExecutionSnapshot | undefined>
    jobs: Array<RoomCronJob[] | undefined>
    files: Array<RoomFileEntry[] | undefined>
}): ActivityRow[] {
    const rows: ActivityRow[] = []

    input.rooms.forEach((room, index) => {
        const snapshot = input.executions[index]
        if (snapshot) {
            const seenKeys = new Set<string>()
            for (const item of snapshot.recentActivity) {
                if (item.updatedAt === null) continue
                seenKeys.add(item.key)
                const state = describeSessionState(item.status)
                rows.push({
                    id: `session:${room.roomId}:${item.key}:${item.updatedAt}`,
                    kind: 'session',
                    icon: ActivityIcon,
                    title: `${item.title || 'Session'} ${activityVerb(item.status)}`,
                    description: '',
                    statusLabel: state.label,
                    tone: state.tone,
                    timestamp: item.updatedAt,
                    href: {
                        to: '/rooms/$roomId/sessions/$sessionKey',
                        params: { roomId: room.roomId, sessionKey: item.key },
                    },
                    room,
                })
            }
            for (const thread of snapshot.threads) {
                if (thread.updatedAt === null) continue
                if (seenKeys.has(thread.key)) continue
                const state = describeSessionState(thread.status)
                rows.push({
                    id: `thread:${room.roomId}:${thread.key}:${thread.updatedAt}`,
                    kind: 'session',
                    icon: MessagesSquareIcon,
                    title: `${thread.title || 'Session'} updated`,
                    description: thread.lastMessagePreview ?? '',
                    statusLabel: state.label,
                    tone: state.tone,
                    timestamp: thread.updatedAt,
                    href: {
                        to: '/rooms/$roomId/sessions/$sessionKey',
                        params: { roomId: room.roomId, sessionKey: thread.key },
                    },
                    room,
                })
            }
        }

        const jobs = input.jobs[index]
        if (jobs) {
            for (const job of jobs) {
                if (job.lastRunAt === null) continue
                const last = describeJobLastRun(job.lastRunStatus)
                rows.push({
                    id: `job:${room.roomId}:${job.id}:${job.lastRunAt}`,
                    kind: 'job',
                    icon: CalendarClockIcon,
                    title: `${job.name} ${jobVerb(job.lastRunStatus)}`,
                    description: job.lastError ?? job.payloadSummary ?? '',
                    statusLabel: last.label,
                    tone: last.tone,
                    timestamp: job.lastRunAt,
                    href: { to: '/rooms/$roomId/jobs', params: { roomId: room.roomId } },
                    room,
                })
            }
        }

        const files = input.files[index]
        if (files) {
            for (const file of files) {
                if (file.kind !== 'file') continue
                if (!file.updatedAt) continue
                const ts = Date.parse(file.updatedAt)
                if (!Number.isFinite(ts)) continue
                rows.push({
                    id: `file:${room.roomId}:${file.surface}:${file.relativePath}:${ts}`,
                    kind: 'file',
                    icon: FileTextIcon,
                    title: `${file.name} saved`,
                    description: file.surface === 'workspace' ? 'Created by room' : 'Uploaded',
                    statusLabel: null,
                    tone: 'muted',
                    timestamp: ts,
                    href: { to: '/rooms/$roomId/files', params: { roomId: room.roomId } },
                    room,
                })
            }
        }
    })

    rows.sort((left, right) => right.timestamp - left.timestamp)
    return rows
}

function activityVerb(status: string | null | undefined): string {
    if (!status) return 'updated'
    const lower = status.toLowerCase()
    if (lower.includes('error') || lower.includes('fail')) return 'errored'
    if (
        lower.includes('working') ||
        lower.includes('running') ||
        lower.includes('streaming') ||
        lower.includes('thinking')
    ) {
        return 'started'
    }
    if (lower.includes('done') || lower.includes('complete')) return 'finished'
    if (lower.includes('wait') || lower.includes('pending') || lower.includes('approval')) {
        return 'waiting'
    }
    return 'updated'
}

function jobVerb(status: string | null | undefined): string {
    if (!status) return 'ran'
    const lower = status.toLowerCase()
    if (lower.includes('success') || lower.includes('ok')) return 'succeeded'
    if (lower.includes('fail') || lower.includes('error')) return 'failed'
    if (lower.includes('skip')) return 'skipped'
    if (lower.includes('running') || lower.includes('start')) return 'started'
    return 'ran'
}
