import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import {
    ArrowRight,
    CheckCircle2,
    Activity,
    ChevronDown,
    FileText,
    ListTodo,
    Plus,
    Rocket,
    Search,
    Settings,
    Sparkles,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { RoomCreateForm } from './-room-create-form'
import type { ProviderApi, ProviderMode } from './-room-create-form'
import {
    AgentRoomMark,
    AuthenticatedAppShell,
    formatRelativeTime,
    jobScheduleLabel,
    roomIconFor,
    roomStateLabel,
    roomStateTone,
    useOperatorConfig,
    useRoomsList,
    useSidebarRoomSnapshots,
} from './-app-layout'
import { requireRouteUser } from './-route-auth'
import { createRoomServer, getRoomSetupReadinessServer } from './-room-runtime-server'
import type { RoomSetupReadinessSnapshot } from '#/server/rooms/runtime-readiness'
import type { RoomExecutionSnapshot } from '#/server/rooms/execution-types'

export const Route = createFileRoute('/')({
    beforeLoad: requireRouteUser,
    component: RoomsHomePage,
})

function RoomsHomePage() {
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const roomsQuery = useRoomsList()
    const configQuery = useOperatorConfig()
    const readinessQuery = useQuery<RoomSetupReadinessSnapshot>({
        queryKey: ['room-setup-readiness'],
        queryFn: async () => getRoomSetupReadinessServer(),
    })

    const rooms = roomsQuery.data ?? []
    const sidebarSnapshots = useSidebarRoomSnapshots(rooms)
    const config = configQuery.data
    const providers = config?.providers ?? []
    const mcpConnections = config?.mcpConnections ?? []
    const defaultProvider = providers.find(
        (provider) => provider.id === config?.settings.defaultProviderConnectionId,
    )
    const blockingReadiness = readinessQuery.data?.issues.filter(
        (issue) => issue.severity === 'blocking',
    )

    const [displayName, setDisplayName] = useState('')
    const [slug, setSlug] = useState('')
    const [instructions, setInstructions] = useState('')
    const [providerMode, setProviderMode] = useState<ProviderMode>('app_default')
    const [providerConnectionId, setProviderConnectionId] = useState('')
    const [provider, setProvider] = useState('openrouter')
    const [providerApi, setProviderApi] = useState<ProviderApi>('openai-completions')
    const [providerBaseUrl, setProviderBaseUrl] = useState('')
    const [providerModel, setProviderModel] = useState('openrouter/auto')
    const [providerApiKey, setProviderApiKey] = useState('')
    const [toolsProfile, setToolsProfile] = useState('coding')
    const [cronTimezone, setCronTimezone] = useState('UTC')
    const [selectedMcpIds, setSelectedMcpIds] = useState<string[]>([])
    const [startImmediately, setStartImmediately] = useState(true)
    const [initialJobEnabled, setInitialJobEnabled] = useState(false)
    const [initialJobName, setInitialJobName] = useState('')
    const [initialJobMessage, setInitialJobMessage] = useState('')
    const [initialJobEveryMinutes, setInitialJobEveryMinutes] = useState('1440')
    const [notice, setNotice] = useState<string | null>(null)

    const selectedProvider = useMemo(() => {
        if (providerMode === 'app_default') {
            return defaultProvider ?? null
        }
        if (providerMode === 'app_connection') {
            return providers.find((entry) => entry.id === providerConnectionId) ?? null
        }
        return null
    }, [defaultProvider, providerConnectionId, providerMode, providers])

    const selectedProviderUsesOAuth = selectedProvider?.authMode === 'oauth'

    useEffect(() => {
        if (selectedProviderUsesOAuth) {
            setStartImmediately(false)
        }
    }, [selectedProviderUsesOAuth])

    useEffect(() => {
        if (!defaultProvider || providerConnectionId) {
            return
        }
        setProviderConnectionId(defaultProvider.id)
    }, [defaultProvider, providerConnectionId])

    const providerReady = useMemo(() => {
        if (providerMode === 'app_default') {
            return Boolean(defaultProvider)
        }
        if (providerMode === 'app_connection') {
            return Boolean(selectedProvider)
        }
        return Boolean(provider.trim() && providerApi && providerModel.trim() && providerApiKey)
    }, [
        defaultProvider,
        provider,
        providerApi,
        providerApiKey,
        providerMode,
        providerModel,
        selectedProvider,
    ])

    const createRoomMutation = useMutation({
        mutationFn: async () => {
            const everyMinutes = Number(initialJobEveryMinutes)
            return createRoomServer({
                data: {
                    displayName,
                    slug: slug || null,
                    startImmediately,
                    instructions,
                    providerMode,
                    providerConnectionId:
                        providerMode === 'app_connection' ? providerConnectionId : null,
                    provider: providerMode === 'room_secret' ? provider : null,
                    providerApi: providerMode === 'room_secret' ? providerApi : null,
                    providerBaseUrl:
                        providerMode === 'room_secret' ? providerBaseUrl || null : null,
                    providerModel: providerMode === 'room_secret' ? providerModel : null,
                    providerApiKey: providerMode === 'room_secret' ? providerApiKey : undefined,
                    toolsProfile,
                    cronTimezone,
                    mcpConnectionIds: selectedMcpIds,
                    initialCron:
                        initialJobEnabled && initialJobName.trim() && initialJobMessage.trim()
                            ? {
                                  name: initialJobName,
                                  message: initialJobMessage,
                                  everyMinutes,
                              }
                            : null,
                },
            })
        },
        onSuccess: async (room) => {
            setNotice(null)
            await queryClient.invalidateQueries({
                queryKey: ['room-runtime-list'],
                exact: false,
            })
            await queryClient.invalidateQueries({
                queryKey: ['room-runtime-snapshot-sidebar'],
                exact: false,
            })
            await navigate({
                to: '/rooms/$roomId',
                params: {
                    roomId: room.id,
                },
            })
        },
        onError: (error) => {
            setNotice(error instanceof Error ? error.message : 'Room creation failed')
        },
    })

    const toggleMcp = (id: string) => {
        setSelectedMcpIds((current) =>
            current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
        )
    }

    const onCreateRoom = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (!displayName.trim()) {
            setNotice('Room name is required')
            return
        }
        if ((blockingReadiness?.length ?? 0) > 0) {
            setNotice(blockingReadiness?.[0]?.message ?? 'Portal setup is not ready')
            return
        }
        if (startImmediately && !providerReady) {
            setNotice('Choose a connected model before starting the room')
            return
        }
        if (initialJobEnabled) {
            const everyMinutes = Number(initialJobEveryMinutes)
            if (!Number.isInteger(everyMinutes) || everyMinutes <= 0) {
                setNotice('Job interval must be a positive whole number')
                return
            }
            if (!initialJobName.trim() || !initialJobMessage.trim()) {
                setNotice('Add a job name and task')
                return
            }
        }
        createRoomMutation.mutate()
    }

    const snapshotsByRoomId = useMemo(() => {
        const entries = new Map<string, RoomExecutionSnapshot>()
        sidebarSnapshots.forEach((query, index) => {
            const room = rooms[index]
            if (room && query.data) {
                entries.set(room.roomId, query.data)
            }
        })
        return entries
    }, [rooms, sidebarSnapshots])
    const readyRooms = rooms.filter((room) => roomStateTone(room) === 'ready').length
    const workingRooms = rooms.filter((room) => roomStateTone(room) === 'working').length
    const onboardingComplete =
        Boolean(config?.onboarding.completed) && rooms.length > 0 && providers.length > 0

    useEffect(() => {
        const search = typeof window === 'undefined' ? '' : window.location.search
        const skipOnboardingValue = new URLSearchParams(search).get('skipOnboarding')
        if (
            skipOnboardingValue === '1' ||
            skipOnboardingValue === 'true' ||
            skipOnboardingValue === '"1"'
        ) {
            return
        }
        if (roomsQuery.isLoading || configQuery.isLoading || !config) {
            return
        }
        if (!onboardingComplete && (rooms.length === 0 || providers.length === 0)) {
            void navigate({
                to: '/onboarding',
            })
        }
    }, [
        config,
        configQuery.isLoading,
        navigate,
        onboardingComplete,
        providers.length,
        rooms.length,
        roomsQuery.isLoading,
    ])

    return (
        <AuthenticatedAppShell activeSection="rooms">
            <section className="page-stack">
                <header className="mobile-room-brand">
                    <AgentRoomMark className="brand-mark" />
                    <span>
                        <strong>Agent Room</strong>
                        <small>Self-hosted</small>
                    </span>
                </header>

                <section className="mobile-action-grid">
                    <Link to="/activity" className="quick-card">
                        <Search size={24} />
                        <span>Search</span>
                    </Link>
                    <Link to="/activity" className="quick-card">
                        <Activity size={24} />
                        <span>Activity</span>
                    </Link>
                    <Link to="/jobs" className="quick-card">
                        <ListTodo size={24} />
                        <span>Jobs</span>
                    </Link>
                </section>

                <header className="page-header">
                    <div>
                        <p className="section-kicker">Rooms</p>
                        <h1>Rooms</h1>
                        <p>
                            {rooms.length === 0
                                ? 'Create a room to start working.'
                                : `${rooms.length} rooms, ${readyRooms} ready, ${workingRooms} working.`}
                        </p>
                    </div>
                    <div className="header-actions">
                        <Link to="/settings" className="button secondary">
                            <Settings size={17} />
                            Settings
                        </Link>
                        <a href="#create-room" className="button primary">
                            <Plus size={17} />
                            Add room
                        </a>
                    </div>
                </header>

                {!onboardingComplete ? (
                    <section className="setup-strip">
                        <div className="setup-step complete">
                            <CheckCircle2 size={20} />
                            <span>
                                <strong>Portal ready</strong>
                                <small>Signed in</small>
                            </span>
                        </div>
                        <Link
                            to="/settings"
                            className={
                                providers.length > 0 ? 'setup-step complete' : 'setup-step active'
                            }
                        >
                            <Sparkles size={20} />
                            <span>
                                <strong>Model connection</strong>
                                <small>{providers.length > 0 ? 'Connected' : 'Add provider'}</small>
                            </span>
                        </Link>
                        <a
                            href="#create-room"
                            className={rooms.length > 0 ? 'setup-step complete' : 'setup-step'}
                        >
                            <Rocket size={20} />
                            <span>
                                <strong>First room</strong>
                                <small>{rooms.length > 0 ? 'Created' : 'Not created yet'}</small>
                            </span>
                        </a>
                    </section>
                ) : null}

                <section className="room-overview-grid">
                    <div className="room-card-grid">
                        {roomsQuery.isLoading ? (
                            <p className="surface muted">Loading rooms</p>
                        ) : null}
                        {!roomsQuery.isLoading && rooms.length === 0 ? (
                            <article className="empty-panel">
                                <Rocket size={24} />
                                <h2>No rooms yet</h2>
                                <p>Add a model connection, then create your first room.</p>
                                <Link to="/settings" className="button secondary">
                                    Add model connection
                                </Link>
                            </article>
                        ) : null}
                        {rooms.map((room) => {
                            const Icon = roomIconFor(room)
                            const tone = roomStateTone(room)
                            const sessions =
                                snapshotsByRoomId.get(room.roomId)?.threads.slice(0, 3) ?? []
                            return (
                                <Link
                                    key={room.roomId}
                                    to="/rooms/$roomId"
                                    params={{ roomId: room.roomId }}
                                    className="room-overview-card expanded"
                                >
                                    <span className={`room-avatar ${tone}`}>
                                        <Icon size={22} />
                                    </span>
                                    <span className="room-overview-copy">
                                        <strong>{room.displayName}</strong>
                                        <small>
                                            <span className={`status-dot ${tone}`} />
                                            {roomStateLabel(room)}
                                        </small>
                                    </span>
                                    <span className="room-overview-meta">
                                        {formatRelativeTime(room.lastHealthAt)}
                                    </span>
                                    <ChevronDown size={17} />
                                    <span className="room-overview-sessions">
                                        {sessions.length === 0 ? (
                                            <span className="room-overview-session">
                                                <span className="status-dot muted" />
                                                <span>
                                                    <strong>No sessions yet</strong>
                                                    <small>Start a session from the room</small>
                                                </span>
                                                <ArrowRight size={16} />
                                            </span>
                                        ) : null}
                                        {sessions.map((thread) => (
                                            <span
                                                key={thread.key}
                                                className="room-overview-session"
                                            >
                                                <span className="status-dot ready" />
                                                <span>
                                                    <strong>{thread.title}</strong>
                                                    <small>
                                                        Updated{' '}
                                                        {formatRelativeTime(thread.updatedAt)}
                                                    </small>
                                                </span>
                                                <ArrowRight size={16} />
                                            </span>
                                        ))}
                                    </span>
                                    <ArrowRight size={17} />
                                </Link>
                            )
                        })}
                    </div>

                    <details className="room-create-drawer">
                        <summary className="button secondary">
                            <Plus size={17} />
                            Create room
                        </summary>
                        <RoomCreateForm
                            blockingIssues={blockingReadiness ?? []}
                            createPending={createRoomMutation.isPending}
                            defaultProvider={defaultProvider}
                            displayName={displayName}
                            initialJobEnabled={initialJobEnabled}
                            initialJobEveryMinutes={initialJobEveryMinutes}
                            initialJobMessage={initialJobMessage}
                            initialJobName={initialJobName}
                            instructions={instructions}
                            mcpConnections={mcpConnections}
                            notice={notice}
                            onSubmit={onCreateRoom}
                            onToggleMcp={toggleMcp}
                            provider={provider}
                            providerApi={providerApi}
                            providerApiKey={providerApiKey}
                            providerBaseUrl={providerBaseUrl}
                            providerConnectionId={providerConnectionId}
                            providerMode={providerMode}
                            providerModel={providerModel}
                            providers={providers}
                            selectedMcpIds={selectedMcpIds}
                            selectedProviderUsesOAuth={selectedProviderUsesOAuth}
                            setCronTimezone={setCronTimezone}
                            setDisplayName={setDisplayName}
                            setInitialJobEnabled={setInitialJobEnabled}
                            setInitialJobEveryMinutes={setInitialJobEveryMinutes}
                            setInitialJobMessage={setInitialJobMessage}
                            setInitialJobName={setInitialJobName}
                            setInstructions={setInstructions}
                            setProvider={setProvider}
                            setProviderApi={setProviderApi}
                            setProviderApiKey={setProviderApiKey}
                            setProviderBaseUrl={setProviderBaseUrl}
                            setProviderConnectionId={setProviderConnectionId}
                            setProviderMode={setProviderMode}
                            setProviderModel={setProviderModel}
                            setSlug={setSlug}
                            setStartImmediately={setStartImmediately}
                            setToolsProfile={setToolsProfile}
                            slug={slug}
                            startImmediately={startImmediately}
                            toolsProfile={toolsProfile}
                            cronTimezone={cronTimezone}
                        />
                    </details>
                </section>

                <section className="quick-grid">
                    <Link to="/jobs" className="quick-card">
                        <ListTodo size={20} />
                        <span>
                            <strong>Jobs</strong>
                            <small>
                                {jobScheduleLabel(initialJobEveryMinutes)} when you add one
                            </small>
                        </span>
                    </Link>
                    <Link to="/files" className="quick-card">
                        <FileText size={20} />
                        <span>
                            <strong>Files</strong>
                            <small>Review room outputs</small>
                        </span>
                    </Link>
                    <Link to="/activity" className="quick-card">
                        <Activity size={20} />
                        <span>
                            <strong>Activity</strong>
                            <small>See recent work</small>
                        </span>
                    </Link>
                </section>
            </section>
        </AuthenticatedAppShell>
    )
}
