import { useQueries } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Activity, ArrowRight, FileText, Folder, ListTodo } from 'lucide-react'
import {
    AuthenticatedAppShell,
    formatBytes,
    formatDateTime,
    formatRelativeTime,
    roomIconFor,
    statusTone,
    useRoomsList,
} from './-app-layout'
import {
    getRoomExecutionServer,
    listCronJobsServer,
    listRoomFilesServer,
} from './-room-runtime-server'
import type {
    RoomCronJob,
    RoomExecutionSnapshot,
    RoomRuntimeOverview,
} from '#/server/rooms/execution-types'
import type { RoomFileEntry } from '#/server/rooms/file-store'

export function GlobalActivityPage() {
    const roomsQuery = useRoomsList()
    const rooms = roomsQuery.data ?? []
    const snapshotQueries = useRoomExecutionQueries(rooms)

    const activityItems = snapshotQueries
        .flatMap((query, index) => {
            const room = rooms[index]
            const snapshot = query.data as RoomExecutionSnapshot | undefined
            if (!room || !snapshot) {
                return []
            }
            return snapshot.recentActivity.map((item) => ({
                ...item,
                room,
            }))
        })
        .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))

    return (
        <AuthenticatedAppShell activeSection="activity">
            <section className="page-stack">
                <header className="page-header">
                    <div>
                        <p className="section-kicker">Activity</p>
                        <h1>Recent work</h1>
                        <p>Sessions, jobs, and files that changed recently.</p>
                    </div>
                </header>
                <section className="surface">
                    <div className="surface-heading">
                        <div>
                            <h2>What happened</h2>
                            <p>{activityItems.length} recent items</p>
                        </div>
                        <Activity size={19} />
                    </div>
                    <div className="stack-list">
                        {activityItems.length === 0 ? (
                            <p className="muted">No room activity yet.</p>
                        ) : null}
                        {activityItems.map((item) => {
                            const Icon = roomIconFor(item.room)
                            return (
                                <Link
                                    key={`${item.room.roomId}:${item.key}`}
                                    to="/rooms/$roomId/sessions/$sessionKey"
                                    params={{
                                        roomId: item.room.roomId,
                                        sessionKey: item.key,
                                    }}
                                    className="plain-row"
                                >
                                    <span className="row-icon">
                                        <Icon size={18} />
                                    </span>
                                    <span>
                                        <strong>{item.title}</strong>
                                        <small>
                                            {item.room.displayName} ·{' '}
                                            {formatRelativeTime(item.updatedAt)}
                                        </small>
                                    </span>
                                    <span className={`pill ${statusTone(item.status)}`}>
                                        {item.status ?? 'done'}
                                    </span>
                                    <ArrowRight size={16} />
                                </Link>
                            )
                        })}
                    </div>
                </section>
            </section>
        </AuthenticatedAppShell>
    )
}

export function GlobalJobsPage() {
    const roomsQuery = useRoomsList()
    const rooms = roomsQuery.data ?? []
    const jobQueries = useRoomJobQueries(rooms)
    const jobs = jobQueries
        .flatMap((query, index) => {
            const room = rooms[index]
            const entries = (query.data as RoomCronJob[] | undefined) ?? []
            if (!room) {
                return []
            }
            return entries.map((job) => ({
                job,
                room,
            }))
        })
        .sort(
            (left, right) =>
                (left.job.nextRunAt ?? Number.MAX_SAFE_INTEGER) -
                (right.job.nextRunAt ?? Number.MAX_SAFE_INTEGER),
        )

    return (
        <AuthenticatedAppShell activeSection="jobs">
            <section className="page-stack">
                <header className="page-header">
                    <div>
                        <p className="section-kicker">Jobs</p>
                        <h1>Scheduled work</h1>
                        <p>
                            {jobs.length === 0
                                ? 'No jobs yet.'
                                : `${jobs.length} jobs across rooms.`}
                        </p>
                    </div>
                </header>
                <section className="surface table-surface">
                    <div className="surface-heading">
                        <div>
                            <h2>All jobs</h2>
                            <p>Recurring and triggered room work.</p>
                        </div>
                        <ListTodo size={19} />
                    </div>
                    <div className="responsive-table">
                        <div className="table-header">
                            <span>Job</span>
                            <span>Room</span>
                            <span>Next run</span>
                            <span>Last result</span>
                        </div>
                        {jobs.length === 0 ? (
                            <p className="muted table-empty">No jobs found.</p>
                        ) : null}
                        {jobs.map(({ job, room }) => (
                            <Link
                                key={`${room.roomId}:${job.id}`}
                                to="/rooms/$roomId/jobs"
                                params={{ roomId: room.roomId }}
                                className="table-row"
                            >
                                <span>
                                    <strong>{job.name}</strong>
                                    <small>{job.scheduleSummary}</small>
                                </span>
                                <span>{room.displayName}</span>
                                <span>{formatDateTime(job.nextRunAt)}</span>
                                <span className={`pill ${statusTone(job.lastRunStatus)}`}>
                                    {job.lastRunStatus ?? (job.enabled ? 'ready' : 'paused')}
                                </span>
                            </Link>
                        ))}
                    </div>
                </section>
            </section>
        </AuthenticatedAppShell>
    )
}

export function GlobalFilesPage() {
    const roomsQuery = useRoomsList()
    const rooms = roomsQuery.data ?? []
    const fileQueries = useRoomFileQueries(rooms)
    const files = fileQueries
        .flatMap((query, index) => {
            const room = rooms[index]
            const entries = (query.data as RoomFileEntry[] | undefined) ?? []
            if (!room) {
                return []
            }
            return entries
                .filter((file) => file.kind === 'file')
                .map((file) => ({
                    file,
                    room,
                }))
        })
        .sort(
            (left, right) =>
                new Date(right.file.updatedAt ?? 0).getTime() -
                new Date(left.file.updatedAt ?? 0).getTime(),
        )
        .slice(0, 120)

    return (
        <AuthenticatedAppShell activeSection="files">
            <section className="page-stack">
                <header className="page-header">
                    <div>
                        <p className="section-kicker">Files</p>
                        <h1>Room files</h1>
                        <p>
                            {files.length === 0
                                ? 'No files yet.'
                                : `${files.length} files from your rooms.`}
                        </p>
                    </div>
                </header>
                <section className="surface table-surface">
                    <div className="surface-heading">
                        <div>
                            <h2>Recent files</h2>
                            <p>Files created by sessions and jobs.</p>
                        </div>
                        <Folder size={19} />
                    </div>
                    <div className="file-card-grid">
                        {files.length === 0 ? <p className="muted">No files found.</p> : null}
                        {files.map(({ file, room }) => (
                            <Link
                                key={`${room.roomId}:${file.surface}:${file.relativePath}`}
                                to="/rooms/$roomId/files"
                                params={{ roomId: room.roomId }}
                                className="file-card"
                            >
                                <span className="file-icon">
                                    <FileText size={20} />
                                </span>
                                <span>
                                    <strong>{file.name}</strong>
                                    <small>
                                        {room.displayName} · {formatBytes(file.byteLength)} ·{' '}
                                        {formatRelativeTime(file.updatedAt)}
                                    </small>
                                </span>
                            </Link>
                        ))}
                    </div>
                </section>
            </section>
        </AuthenticatedAppShell>
    )
}

function useRoomExecutionQueries(rooms: RoomRuntimeOverview[]) {
    return useQueries({
        queries: rooms.map((room) => ({
            queryKey: ['room-runtime-snapshot-global', room.roomId],
            queryFn: async () =>
                getRoomExecutionServer({
                    data: {
                        roomId: room.roomId,
                        selectedThreadKey: null,
                    },
                }),
            enabled: rooms.length > 0,
            staleTime: 15_000,
        })),
    })
}

function useRoomJobQueries(rooms: RoomRuntimeOverview[]) {
    return useQueries({
        queries: rooms.map((room) => ({
            queryKey: ['room-runtime-cron-jobs', room.roomId],
            queryFn: async () =>
                listCronJobsServer({
                    data: {
                        roomId: room.roomId,
                    },
                }),
            enabled: rooms.length > 0,
        })),
    })
}

function useRoomFileQueries(rooms: RoomRuntimeOverview[]) {
    return useQueries({
        queries: rooms.map((room) => ({
            queryKey: ['room-files', room.roomId],
            queryFn: async () =>
                listRoomFilesServer({
                    data: {
                        roomId: room.roomId,
                    },
                }),
            enabled: rooms.length > 0,
        })),
    })
}
