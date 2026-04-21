import { createFileRoute, redirect } from '@tanstack/react-router'
import { AgentRoomMark, AuthenticatedAppShell } from './-app-layout'
import { currentUserServer } from './-auth-server'

export const Route = createFileRoute('/about')({
    beforeLoad: async () => {
        const user = await currentUserServer()
        if (!user) {
            throw redirect({
                to: '/login',
            })
        }
    },
    component: AboutPage,
})

function AboutPage() {
    return (
        <AuthenticatedAppShell activeSection="settings">
            <section className="page-stack">
                <header className="page-header">
                    <div>
                        <p className="section-kicker">Agent Room</p>
                        <h1>Rooms for long-running agents</h1>
                        <p>
                            Each room keeps its own instructions, files, jobs, sessions, tools, and
                            model binding behind one operator-controlled workspace.
                        </p>
                    </div>
                    <AgentRoomMark className="brand-mark" />
                </header>

                <section className="settings-layout">
                    <article className="surface">
                        <div className="surface-heading">
                            <div>
                                <h2>Operating model</h2>
                                <p>
                                    Agent Room is built around durable rooms, not disposable chat
                                    threads. Sessions live inside a room and inherit the room
                                    policy, tool access, model configuration, and file store.
                                </p>
                            </div>
                        </div>
                        <div className="stack-list">
                            <div className="feature-block">
                                <strong>Operator controlled</strong>
                                <p>
                                    App-level providers and shared tools are configured once, then
                                    explicitly attached to rooms.
                                </p>
                            </div>
                            <div className="feature-block">
                                <strong>Room scoped</strong>
                                <p>
                                    Room secrets, instructions, jobs, and files remain bound to the
                                    room that owns them.
                                </p>
                            </div>
                        </div>
                    </article>

                    <aside className="surface">
                        <div className="surface-heading">
                            <div>
                                <h2>Safety rules</h2>
                                <p>
                                    Execution and credentials stay explicit, auditable, and scoped.
                                </p>
                            </div>
                        </div>
                        <div className="stack-list">
                            <div className="plain-row">
                                <span className="status-dot ready" />
                                <span>No shared credentials between rooms unless attached</span>
                            </div>
                            <div className="plain-row">
                                <span className="status-dot ready" />
                                <span>No silent fallback for model connections or secrets</span>
                            </div>
                            <div className="plain-row">
                                <span className="status-dot ready" />
                                <span>No duplicate source of truth for room state</span>
                            </div>
                        </div>
                    </aside>
                </section>
            </section>
        </AuthenticatedAppShell>
    )
}
