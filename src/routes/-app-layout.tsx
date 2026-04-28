import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import {
    Activity,
    BriefcaseBusiness,
    ChevronDown,
    ChevronRight,
    FileText,
    Home,
    Landmark,
    ListTodo,
    LogOut,
    Plus,
    Rocket,
    Search,
    Settings,
    Settings2,
    UserRound,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { AuthUserSnapshot } from './-auth-server'
import { currentUserServer, logoutServer } from './-auth-server'
import { getOperatorConfigServer } from './-operator-config-server'
import { getRoomExecutionServer, listRoomsServer } from './-room-runtime-server'
import type { OperatorConfigSnapshot } from '#/server/configuration/operator-configuration'
import type {
    RoomExecutionSnapshot,
    RoomExecutionThread,
    RoomRuntimeOverview,
} from '#/server/rooms/execution-types'

export type AppSection = 'rooms' | 'activity' | 'jobs' | 'files' | 'settings'

export const jobSchedulePresets = [
    {
        value: '1440',
        label: 'Every morning',
        helper: 'Runs once a day',
    },
    {
        value: '10080',
        label: 'Every week',
        helper: 'Runs once a week',
    },
    {
        value: '60',
        label: 'Every hour',
        helper: 'Runs throughout the day',
    },
    {
        value: 'custom',
        label: 'Custom schedule',
        helper: 'Choose an interval',
    },
] as const

export function jobScheduleLabel(value: string | number | null | undefined): string {
    const normalized = value === null || value === undefined ? '' : String(value)
    const preset = jobSchedulePresets.find((entry) => entry.value === normalized)
    if (preset && preset.value !== 'custom') {
        return preset.label
    }
    const minutes = Number(normalized)
    if (!Number.isInteger(minutes) || minutes <= 0) {
        return 'Choose a schedule'
    }
    if (minutes === 1) {
        return 'Every minute'
    }
    if (minutes < 60) {
        return `Every ${minutes} minutes`
    }
    if (minutes % 1440 === 0) {
        const days = minutes / 1440
        return days === 1 ? 'Every day' : `Every ${days} days`
    }
    if (minutes % 60 === 0) {
        const hours = minutes / 60
        return hours === 1 ? 'Every hour' : `Every ${hours} hours`
    }
    return `Every ${minutes} minutes`
}

export interface AppShellProps {
    activeRoomId?: string | null
    activeSessionKey?: string | null
    activeSection?: AppSection
    children: ReactNode
}

export function AgentRoomMark(props: { className?: string }) {
    return (
        <svg className={props.className} viewBox="0 0 1024 1024" aria-hidden="true">
            <path
                d="M315 792V356L512 232L709 356V792H575M575 792H439V479H575"
                fill="none"
                stroke="currentColor"
                strokeWidth="72"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    )
}

export function formatDateTime(value: number | string | null | undefined): string {
    if (value === null || value === undefined) {
        return 'Not yet'
    }

    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
        return 'Not yet'
    }

    return date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    })
}

export function formatRelativeTime(value: number | string | null | undefined): string {
    if (value === null || value === undefined) {
        return 'No activity'
    }

    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
        return 'No activity'
    }

    const diffMs = Date.now() - date.getTime()
    const minute = 60_000
    const hour = 60 * minute
    const day = 24 * hour

    if (diffMs < minute) {
        return 'Just now'
    }
    if (diffMs < hour) {
        return `${Math.max(1, Math.round(diffMs / minute))} min ago`
    }
    if (diffMs < day) {
        return `${Math.round(diffMs / hour)} hours ago`
    }
    if (diffMs < 7 * day) {
        return `${Math.round(diffMs / day)} days ago`
    }
    return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
    })
}

export function formatBytes(value: number | null | undefined): string {
    if (value === null || value === undefined) {
        return ''
    }
    if (value < 1024) {
        return `${value} B`
    }
    if (value < 1024 * 1024) {
        return `${Math.round(value / 1024)} KB`
    }
    return `${Math.round((value / 1024 / 1024) * 10) / 10} MB`
}

export function statusTone(
    status: string | null | undefined,
): 'ready' | 'working' | 'attention' | 'muted' {
    if (!status) {
        return 'muted'
    }
    const normalized = status.toLowerCase()
    if (
        normalized.includes('fail') ||
        normalized.includes('error') ||
        normalized.includes('invalid') ||
        normalized.includes('unhealthy') ||
        normalized.includes('attention') ||
        normalized.includes('missing')
    ) {
        return 'attention'
    }
    if (
        normalized.includes('running') ||
        normalized.includes('working') ||
        normalized.includes('starting') ||
        normalized.includes('submitting')
    ) {
        return 'working'
    }
    if (
        normalized.includes('ready') ||
        normalized.includes('healthy') ||
        normalized.includes('connected') ||
        normalized.includes('complete') ||
        normalized.includes('success')
    ) {
        return 'ready'
    }
    return 'muted'
}

export function roomStateLabel(room: RoomRuntimeOverview | null | undefined): string {
    if (!room) {
        return 'Unknown'
    }
    if (room.lastError) {
        return 'Needs attention'
    }
    if (room.desiredState === 'stopped') {
        return 'Paused'
    }
    if (room.status === 'running' && room.healthStatus === 'healthy') {
        return 'Ready'
    }
    if (room.status === 'running') {
        return 'Working'
    }
    if (room.status === 'degraded' || room.status === 'failed') {
        return 'Needs attention'
    }
    return room.status
}

export function roomStateTone(room: RoomRuntimeOverview | null | undefined) {
    if (!room) {
        return 'muted'
    }
    if (room.lastError || room.status === 'failed' || room.status === 'degraded') {
        return 'attention'
    }
    if (room.desiredState === 'stopped') {
        return 'muted'
    }
    if (room.status === 'running' && room.healthStatus === 'healthy') {
        return 'ready'
    }
    if (room.status === 'running' || room.status === 'starting') {
        return 'working'
    }
    return 'muted'
}

export function sessionStateLabel(thread: RoomExecutionThread): string {
    if (!thread.status) {
        return 'Done'
    }
    if (statusTone(thread.status) === 'working') {
        return 'Working'
    }
    if (statusTone(thread.status) === 'attention') {
        return 'Needs attention'
    }
    return 'Done'
}

export function roomIconFor(room: RoomRuntimeOverview | null | undefined) {
    const label = `${room?.displayName ?? ''} ${room?.slug ?? ''}`.toLowerCase()
    if (label.includes('startup') || label.includes('growth')) {
        return Rocket
    }
    if (label.includes('personal')) {
        return UserRound
    }
    if (label.includes('finance') || label.includes('trading')) {
        return Landmark
    }
    if (label.includes('research')) {
        return Search
    }
    if (label.includes('ops')) {
        return Settings2
    }
    return BriefcaseBusiness
}

export function roomInitials(name: string): string {
    const words = name
        .trim()
        .split(/\s+/)
        .filter((word) => word.length > 0)
    if (words.length === 0) {
        return 'AR'
    }
    if (words.length === 1) {
        return words[0]?.slice(0, 2).toUpperCase() ?? 'AR'
    }
    return `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}`.toUpperCase()
}

export function useOperatorConfig() {
    return useQuery<OperatorConfigSnapshot>({
        queryKey: ['operator-config'],
        queryFn: async () => getOperatorConfigServer(),
    })
}

export function useRoomsList() {
    return useQuery<RoomRuntimeOverview[]>({
        queryKey: ['room-runtime-list'],
        queryFn: async () => listRoomsServer(),
    })
}

export function useSidebarRoomSnapshots(rooms: RoomRuntimeOverview[]) {
    return useQueries({
        queries: rooms.map((room) => ({
            queryKey: ['room-runtime-snapshot-sidebar', room.roomId],
            queryFn: async () =>
                getRoomExecutionServer({
                    data: {
                        roomId: room.roomId,
                        selectedThreadKey: null,
                    },
                }),
            staleTime: 15_000,
            enabled: rooms.length > 0,
        })),
    })
}

export function AuthenticatedAppShell(props: AppShellProps) {
    const queryClient = useQueryClient()
    const navigate = useNavigate()
    const [searchText, setSearchText] = useState('')
    const [expandedRoomIds, setExpandedRoomIds] = useState<Set<string>>(() => new Set())
    const currentUserQuery = useQuery<AuthUserSnapshot | null>({
        queryKey: ['auth-current-user'],
        queryFn: async () => currentUserServer(),
    })
    const roomsQuery = useRoomsList()
    const configQuery = useOperatorConfig()
    const rooms = roomsQuery.data ?? []
    const sidebarSnapshots = useSidebarRoomSnapshots(rooms)

    const logoutMutation = useMutation({
        mutationFn: async () => logoutServer(),
        onSuccess: async () => {
            await queryClient.invalidateQueries()
            await navigate({
                to: '/login',
            })
        },
    })

    useEffect(() => {
        if (!props.activeRoomId) {
            return
        }
        setExpandedRoomIds((current) => {
            const next = new Set(current)
            next.add(props.activeRoomId as string)
            return next
        })
    }, [props.activeRoomId])

    const snapshotsByRoomId = useMemo(() => {
        const entries = new Map<string, RoomExecutionSnapshot>()
        sidebarSnapshots.forEach((query, index) => {
            const room = rooms[index]
            if (room && query.data) {
                entries.set(room.roomId, query.data as RoomExecutionSnapshot)
            }
        })
        return entries
    }, [rooms, sidebarSnapshots])

    const normalizedSearch = searchText.trim().toLowerCase()
    const filteredRooms = useMemo(() => {
        if (!normalizedSearch) {
            return rooms
        }
        return rooms.filter((room) => {
            const snapshot = snapshotsByRoomId.get(room.roomId)
            const sessionMatch =
                snapshot?.threads.some((thread) =>
                    `${thread.title} ${thread.lastMessagePreview ?? ''}`
                        .toLowerCase()
                        .includes(normalizedSearch),
                ) ?? false
            return (
                `${room.displayName} ${room.slug}`.toLowerCase().includes(normalizedSearch) ||
                sessionMatch
            )
        })
    }, [normalizedSearch, rooms, snapshotsByRoomId])

    const currentUser = currentUserQuery.data ?? null
    const initials = currentUser?.email ? currentUser.email.slice(0, 2).toUpperCase() : 'OP'
    const setupNeedsAttention =
        configQuery.data !== undefined &&
        (!configQuery.data.onboarding.hasProvider ||
            !configQuery.data.onboarding.hasDefaultProvider)

    const toggleRoom = (roomId: string) => {
        setExpandedRoomIds((current) => {
            const next = new Set(current)
            if (next.has(roomId)) {
                next.delete(roomId)
            } else {
                next.add(roomId)
            }
            return next
        })
    }

    return (
        <div className="agent-shell">
            <aside className="app-sidebar" aria-label="Primary navigation">
                <div className="sidebar-brand">
                    <AgentRoomMark className="brand-mark" />
                    <span>
                        <strong>Agent Room</strong>
                        <small>Self-hosted</small>
                    </span>
                </div>

                <label className="sidebar-search">
                    <Search size={18} />
                    <input
                        value={searchText}
                        onChange={(event) => setSearchText(event.target.value)}
                        placeholder="Search"
                    />
                </label>

                <nav className="sidebar-nav">
                    <Link
                        to="/activity"
                        className="sidebar-action"
                        activeProps={{ className: 'sidebar-action active' }}
                    >
                        <Activity size={18} />
                        Activity
                    </Link>
                    <Link
                        to="/jobs"
                        className="sidebar-action"
                        activeProps={{ className: 'sidebar-action active' }}
                    >
                        <ListTodo size={18} />
                        Jobs
                    </Link>
                </nav>

                <div className="sidebar-section-title">
                    <span>Rooms</span>
                    <Link to="/" className="icon-button" aria-label="Add room">
                        <Plus size={18} />
                    </Link>
                </div>

                <nav className="room-tree" aria-label="Rooms">
                    {roomsQuery.isLoading ? <p className="sidebar-empty">Loading rooms</p> : null}
                    {!roomsQuery.isLoading && filteredRooms.length === 0 ? (
                        <p className="sidebar-empty">No rooms found</p>
                    ) : null}
                    {filteredRooms.map((room) => (
                        <SidebarRoomGroup
                            key={room.roomId}
                            activeRoomId={props.activeRoomId ?? null}
                            activeSessionKey={props.activeSessionKey ?? null}
                            expanded={expandedRoomIds.has(room.roomId) || Boolean(normalizedSearch)}
                            room={room}
                            snapshot={snapshotsByRoomId.get(room.roomId) ?? null}
                            onToggle={() => toggleRoom(room.roomId)}
                        />
                    ))}
                </nav>

                <div className="sidebar-footer">
                    {setupNeedsAttention ? (
                        <Link to="/settings" className="sidebar-health attention">
                            <span className="status-dot attention" />
                            <span>
                                <strong>Setup needs attention</strong>
                                <small>Add a model connection</small>
                            </span>
                            <ChevronRight size={16} />
                        </Link>
                    ) : (
                        <Link to="/settings" className="sidebar-health">
                            <span className="status-dot ready" />
                            <span>
                                <strong>Portal ready</strong>
                                <small>Self-hosted</small>
                            </span>
                            <ChevronRight size={16} />
                        </Link>
                    )}
                    <Link
                        to="/settings"
                        className={
                            props.activeSection === 'settings'
                                ? 'sidebar-action active'
                                : 'sidebar-action'
                        }
                    >
                        <Settings size={18} />
                        Settings
                    </Link>
                    <div className="operator-card">
                        <span className="operator-avatar">{initials}</span>
                        <span>
                            <strong>Operator</strong>
                            <small>{currentUser?.email ?? 'Signed in'}</small>
                        </span>
                        <button
                            type="button"
                            className="icon-button"
                            onClick={() => logoutMutation.mutate()}
                            aria-label="Sign out"
                            disabled={logoutMutation.isPending}
                        >
                            <LogOut size={17} />
                        </button>
                    </div>
                </div>
            </aside>

            <main className="app-main">{props.children}</main>

            <nav className="mobile-tabbar" aria-label="Mobile navigation">
                <Link
                    to="/"
                    className={props.activeSection === 'rooms' ? 'mobile-tab active' : 'mobile-tab'}
                >
                    <Home size={21} />
                    Rooms
                </Link>
                <Link
                    to="/activity"
                    className={
                        props.activeSection === 'activity' ? 'mobile-tab active' : 'mobile-tab'
                    }
                >
                    <Activity size={21} />
                    Activity
                </Link>
                <Link
                    to="/jobs"
                    className={props.activeSection === 'jobs' ? 'mobile-tab active' : 'mobile-tab'}
                >
                    <ListTodo size={21} />
                    Jobs
                </Link>
                <Link
                    to="/files"
                    className={props.activeSection === 'files' ? 'mobile-tab active' : 'mobile-tab'}
                >
                    <FileText size={21} />
                    Files
                </Link>
                <Link
                    to="/settings"
                    className={
                        props.activeSection === 'settings' ? 'mobile-tab active' : 'mobile-tab'
                    }
                >
                    <Settings size={21} />
                    Settings
                </Link>
            </nav>
        </div>
    )
}

function SidebarRoomGroup(props: {
    room: RoomRuntimeOverview
    snapshot: RoomExecutionSnapshot | null
    activeRoomId: string | null
    activeSessionKey: string | null
    expanded: boolean
    onToggle: () => void
}) {
    const Icon = roomIconFor(props.room)
    const tone = roomStateTone(props.room)
    const sessions = props.snapshot?.threads.slice(0, 5) ?? []

    return (
        <div className="room-group">
            <div
                className={
                    props.activeRoomId === props.room.roomId ? 'room-row active' : 'room-row'
                }
            >
                <Link
                    to="/rooms/$roomId"
                    params={{ roomId: props.room.roomId }}
                    className="room-row-link"
                >
                    <Icon size={18} />
                    <span>{props.room.displayName}</span>
                </Link>
                <span className={`status-dot ${tone}`} />
                <button
                    type="button"
                    className="room-expand-button"
                    onClick={props.onToggle}
                    aria-label={props.expanded ? 'Collapse room' : 'Expand room'}
                >
                    {props.expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
            </div>
            {props.expanded ? (
                <div className="session-list">
                    {sessions.length === 0 ? (
                        <Link
                            to="/rooms/$roomId"
                            params={{ roomId: props.room.roomId }}
                            className="session-row muted"
                        >
                            <span className="session-branch" />
                            <span>No sessions yet</span>
                        </Link>
                    ) : null}
                    {sessions.map((thread) => (
                        <Link
                            key={thread.key}
                            to="/rooms/$roomId/sessions/$sessionKey"
                            params={{
                                roomId: props.room.roomId,
                                sessionKey: thread.key,
                            }}
                            className={
                                props.activeSessionKey === thread.key
                                    ? 'session-row active'
                                    : 'session-row'
                            }
                        >
                            <span className={`status-dot ${statusTone(thread.status)}`} />
                            <span>
                                <strong>{thread.title}</strong>
                                <small>{formatRelativeTime(thread.updatedAt)}</small>
                            </span>
                        </Link>
                    ))}
                </div>
            ) : null}
        </div>
    )
}
