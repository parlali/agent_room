import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { CheckCircle2, KeyRound, Rocket, Settings, Sparkles } from 'lucide-react'
import {
    AuthenticatedAppShell,
    roomStateTone,
    useOperatorConfig,
    useRoomsList,
} from './-app-layout'
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
    const readyRoom = rooms.find((room) => roomStateTone(room) === 'ready')
    const blockingIssues =
        readinessQuery.data?.issues.filter((issue) => issue.severity === 'blocking') ?? []

    return (
        <AuthenticatedAppShell activeSection="rooms">
            <section className="page-stack">
                <header className="page-header">
                    <div>
                        <p className="section-kicker">Setup</p>
                        <h1>Set up Agent Room</h1>
                        <p>Add a model connection, create your first room, then start a session.</p>
                    </div>
                    <Link to="/" search={{ skipOnboarding: true }} className="button secondary">
                        <Settings size={17} />
                        Open dashboard
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

                <section className="setup-strip onboarding-steps">
                    <Link to="/settings" className="setup-step complete">
                        <CheckCircle2 size={20} />
                        <span>
                            <strong>Sign in</strong>
                            <small>Portal ready</small>
                        </span>
                    </Link>
                    <Link
                        to="/settings"
                        className={
                            providers.length > 0 ? 'setup-step complete' : 'setup-step active'
                        }
                    >
                        <KeyRound size={20} />
                        <span>
                            <strong>Add model connection</strong>
                            <small>{providers.length > 0 ? 'Connected' : 'Required'}</small>
                        </span>
                    </Link>
                    <Link
                        to="/"
                        hash="create-room"
                        search={{ skipOnboarding: true }}
                        className={rooms.length > 0 ? 'setup-step complete' : 'setup-step'}
                    >
                        <Rocket size={20} />
                        <span>
                            <strong>Create first room</strong>
                            <small>{rooms.length > 0 ? 'Created' : 'Next step'}</small>
                        </span>
                    </Link>
                    <Link
                        to={readyRoom ? '/rooms/$roomId' : '/'}
                        params={readyRoom ? { roomId: readyRoom.roomId } : undefined}
                        search={readyRoom ? undefined : { skipOnboarding: true }}
                        className={readyRoom ? 'setup-step complete' : 'setup-step'}
                    >
                        <Sparkles size={20} />
                        <span>
                            <strong>Start first session</strong>
                            <small>{readyRoom ? 'Ready' : 'After room setup'}</small>
                        </span>
                    </Link>
                </section>

                <section className="surface">
                    <div className="surface-heading">
                        <div>
                            <h2>Recommended path</h2>
                            <p>
                                Open settings first if you want a reusable app connection. Use the
                                dashboard room form if you want a one-off room key instead.
                            </p>
                        </div>
                    </div>
                    <div className="button-row">
                        <Link to="/settings" className="button primary">
                            <KeyRound size={17} />
                            Add model connection
                        </Link>
                        <Link
                            to="/"
                            hash="create-room"
                            search={{ skipOnboarding: true }}
                            className="button secondary"
                        >
                            <Rocket size={17} />
                            Create room
                        </Link>
                    </div>
                </section>
            </section>
        </AuthenticatedAppShell>
    )
}
