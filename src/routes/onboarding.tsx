import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import {
    CheckCircle2,
    FileText,
    KeyRound,
    ListTodo,
    Rocket,
    Settings,
    Sparkles,
} from 'lucide-react'
import { AgentRoomMark, roomStateTone, useOperatorConfig, useRoomsList } from './-app-layout'
import { requireRouteUser } from './-route-auth'
import { getRoomSetupReadinessServer } from './-room-runtime-server'
import type { RoomSetupReadinessSnapshot } from '#/server/rooms/runtime-readiness'

export const Route = createFileRoute('/onboarding')({
    beforeLoad: requireRouteUser,
    component: OnboardingPage,
})

function OnboardingPage() {
    const roomsQuery = useRoomsList()
    const configQuery = useOperatorConfig()
    const readinessQuery = useQuery<RoomSetupReadinessSnapshot>({
        queryKey: ['room-setup-readiness'],
        queryFn: async () => getRoomSetupReadinessServer(),
    })

    const rooms = roomsQuery.data ?? []
    const config = configQuery.data
    const providers = config?.providers ?? []
    const catalog = config?.providerCatalog ?? []
    const readyRoom = rooms.find((room) => roomStateTone(room) === 'ready')
    const firstRoom = rooms[0] ?? null
    const blockingIssues =
        readinessQuery.data?.issues.filter((issue) => issue.severity === 'blocking') ?? []

    const steps = [
        {
            label: 'Sign in',
            detail: 'Portal ready',
            complete: true,
            icon: CheckCircle2,
            to: '/onboarding',
        },
        {
            label: 'Connect model',
            detail: providers.length > 0 ? 'Connected' : 'Required',
            complete: providers.length > 0,
            icon: KeyRound,
            to: '/settings',
        },
        {
            label: 'Create first room',
            detail: rooms.length > 0 ? 'Created' : 'Choose a purpose',
            complete: rooms.length > 0,
            icon: Rocket,
            to: '/',
        },
        {
            label: 'Start first session',
            detail: readyRoom ? 'Ready' : 'After room setup',
            complete: Boolean(readyRoom),
            icon: Sparkles,
            to: readyRoom ? '/rooms/$roomId' : '/',
        },
        {
            label: 'Optional first job',
            detail: 'Add later or now',
            complete: false,
            icon: ListTodo,
            to: readyRoom ? '/rooms/$roomId/jobs' : '/jobs',
        },
    ] as const

    return (
        <main className="onboarding-shell">
            <section className="onboarding-layout">
                <aside className="onboarding-panel">
                    <div className="sidebar-brand">
                        <AgentRoomMark className="brand-mark" />
                        <span>
                            <strong>Agent Room</strong>
                            <small>Self-hosted</small>
                        </span>
                    </div>
                    <div className="stack-list">
                        {steps.map((step) => {
                            const Icon = step.icon
                            const params =
                                step.to.includes('$roomId') && readyRoom
                                    ? { roomId: readyRoom.roomId }
                                    : undefined
                            return (
                                <Link
                                    key={step.label}
                                    to={step.to}
                                    params={params}
                                    search={
                                        step.to === '/'
                                            ? {
                                                  skipOnboarding: true,
                                              }
                                            : undefined
                                    }
                                    className={step.complete ? 'setup-step complete' : 'setup-step'}
                                >
                                    <Icon size={20} />
                                    <span>
                                        <strong>{step.label}</strong>
                                        <small>{step.detail}</small>
                                    </span>
                                </Link>
                            )
                        })}
                    </div>
                </aside>

                <section className="onboarding-main">
                    <header className="page-header">
                        <div>
                            <p className="section-kicker">Setup</p>
                            <h1>Set up Agent Room</h1>
                            <p>
                                Connect a model, create a room, start a session, then add a job when
                                you are ready.
                            </p>
                        </div>
                        <Link to="/" search={{ skipOnboarding: true }} className="button secondary">
                            <Settings size={17} />
                            Open rooms
                        </Link>
                    </header>

                    {blockingIssues.length > 0 ? (
                        <section className="surface">
                            <div className="surface-heading">
                                <div>
                                    <h2>Portal needs attention</h2>
                                    <p>Fix these before creating a working room.</p>
                                </div>
                            </div>
                            <div className="stack-list">
                                {blockingIssues.map((issue) => (
                                    <article key={issue.code} className="plain-row">
                                        <span className="status-dot attention" />
                                        <span>{issue.message}</span>
                                    </article>
                                ))}
                            </div>
                        </section>
                    ) : null}

                    <section className="surface">
                        <div className="surface-heading">
                            <div>
                                <h2>Connect a model</h2>
                                <p>
                                    Choose the provider path rooms will use for sessions and jobs.
                                </p>
                            </div>
                            <KeyRound size={19} />
                        </div>
                        <div className="provider-card-grid">
                            {catalog.slice(0, 4).map((entry) => {
                                const saved = providers.find(
                                    (provider) => provider.provider === entry.provider,
                                )
                                return (
                                    <Link
                                        key={entry.provider}
                                        to="/settings"
                                        className="plain-row interactive"
                                    >
                                        <span className="row-icon">
                                            <KeyRound size={18} />
                                        </span>
                                        <span>
                                            <strong>{entry.label}</strong>
                                            <small>
                                                {saved
                                                    ? 'Connected'
                                                    : `Default model ${entry.model}`}
                                            </small>
                                        </span>
                                        <span className={`pill ${saved ? 'ready' : 'muted'}`}>
                                            {saved ? 'Connected' : 'Set up'}
                                        </span>
                                    </Link>
                                )
                            })}
                        </div>
                        <div className="button-row">
                            <Link to="/settings" className="button primary">
                                <KeyRound size={17} />
                                Add model connection
                            </Link>
                            <Link to="/settings" hash="tools" className="button secondary">
                                <FileText size={17} />
                                Add optional tool
                            </Link>
                        </div>
                    </section>

                    <section className="surface">
                        <div className="surface-heading">
                            <div>
                                <h2>Create a first room</h2>
                                <p>Name the room, describe what it is for, and choose its model.</p>
                            </div>
                            <Rocket size={19} />
                        </div>
                        <div className="button-row">
                            <Link
                                to="/"
                                hash="create-room"
                                search={{ skipOnboarding: true }}
                                className="button primary"
                            >
                                <Rocket size={17} />
                                Create room
                            </Link>
                            {firstRoom ? (
                                <Link
                                    to="/rooms/$roomId"
                                    params={{ roomId: firstRoom.roomId }}
                                    className="button secondary"
                                >
                                    Open {firstRoom.displayName}
                                </Link>
                            ) : null}
                        </div>
                    </section>
                </section>

                <aside className="onboarding-panel">
                    <div className="surface-heading">
                        <div>
                            <h2>Progress</h2>
                            <p>Human checks only.</p>
                        </div>
                    </div>
                    <div className="stack-list">
                        <div className="plain-row">
                            <span className="status-dot ready" />
                            <span>
                                <strong>Portal ready</strong>
                                <small>Signed in</small>
                            </span>
                        </div>
                        <div className="plain-row">
                            <span
                                className={`status-dot ${providers.length > 0 ? 'ready' : 'attention'}`}
                            />
                            <span>
                                <strong>Model connected</strong>
                                <small>
                                    {providers.length > 0 ? 'Ready' : 'Not connected yet'}
                                </small>
                            </span>
                        </div>
                        <div className="plain-row">
                            <span className={`status-dot ${readyRoom ? 'ready' : 'muted'}`} />
                            <span>
                                <strong>Room ready</strong>
                                <small>{readyRoom ? readyRoom.displayName : 'Create a room'}</small>
                            </span>
                        </div>
                        <div className="plain-row">
                            <span className={`status-dot ${readyRoom ? 'ready' : 'muted'}`} />
                            <span>
                                <strong>First session ready</strong>
                                <small>{readyRoom ? 'Start from the room' : 'After setup'}</small>
                            </span>
                        </div>
                    </div>
                </aside>
            </section>
        </main>
    )
}
