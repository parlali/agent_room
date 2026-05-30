import { RoomConsole } from '../components/RoomConsole'
import { TextLink } from '../components/TextLink'

export function Hero() {
    return (
        <section className="relative pt-10 pb-24 sm:pt-14 sm:pb-32 lg:pt-20 lg:pb-40">
            <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-10">
                <div className="grid-12">
                    <div className="col-span-12 lg:col-span-7">
                        <div className="label-mono text-[var(--color-accent)]">
                            Self-hosted agent orchestration
                        </div>

                        <h1 className="mt-8 max-w-[760px] text-[44px] font-semibold leading-[1.05] text-[var(--color-ink)] sm:text-[62px] lg:text-[76px]">
                            <span
                                className="block opacity-0"
                                style={{
                                    animation:
                                        'reveal-up 1.1s cubic-bezier(0.22, 1, 0.36, 1) 0.05s forwards',
                                }}
                            >
                                Self-hosted
                            </span>
                            <span
                                className="block opacity-0 text-[var(--color-ink)]"
                                style={{
                                    animation:
                                        'reveal-up 1.1s cubic-bezier(0.22, 1, 0.36, 1) 0.18s forwards',
                                }}
                            >
                                rooms for persistent
                            </span>
                            <span
                                className="block opacity-0"
                                style={{
                                    animation:
                                        'reveal-up 1.1s cubic-bezier(0.22, 1, 0.36, 1) 0.32s forwards',
                                }}
                            >
                                AI coworkers.
                            </span>
                        </h1>

                        <p
                            className="mt-10 max-w-[34rem] text-[16.5px] leading-[1.6] text-[var(--color-ink-dim)] opacity-0 sm:text-[17.5px]"
                            style={{
                                animation:
                                    'reveal-up 1.1s cubic-bezier(0.22, 1, 0.36, 1) 0.55s forwards',
                            }}
                        >
                            Agent Room gives each AI coworker its own workspace, memory, scheduled
                            jobs, tools, provider binding, and audit trail.
                            <br />
                            <br />
                            Run the full stack on your own machine with Docker Compose. Files,
                            credentials, runtime state, and room history stay inside your instance.
                        </p>

                        <div
                            className="mt-12 flex flex-wrap items-center gap-x-8 gap-y-5 opacity-0"
                            style={{
                                animation:
                                    'reveal-up 1.1s cubic-bezier(0.22, 1, 0.36, 1) 0.7s forwards',
                            }}
                        >
                            <TextLink
                                href="https://github.com/parlali/agent_room"
                                external
                                className="cta-fill px-5 py-3 text-[13.5px] font-medium"
                            >
                                Run the stack
                            </TextLink>
                            <TextLink
                                href="#anatomy"
                                className="inline-flex items-center gap-3 px-1 text-[13.5px] text-[var(--color-ink)] underline decoration-[var(--color-ink-faint)] decoration-1 underline-offset-[6px] transition hover:decoration-[var(--color-accent)]"
                            >
                                See how rooms work
                            </TextLink>
                            <span className="label-mono">$ docker compose up -d --build</span>
                        </div>
                    </div>

                    <div className="col-span-12 mt-16 lg:col-span-5 lg:mt-0">
                        <div className="lg:sticky lg:top-[calc(var(--header-height)+1.5rem)]">
                            <div
                                className="opacity-0"
                                style={{
                                    animation:
                                        'reveal-up 1.2s cubic-bezier(0.22, 1, 0.36, 1) 0.45s forwards',
                                }}
                            >
                                <div className="mb-3 flex items-center justify-between">
                                    <span className="label-mono">Live room preview</span>
                                    <span className="label-mono">Local instance</span>
                                </div>
                                <RoomConsole />
                                <div className="mt-3 flex items-center justify-between">
                                    <span className="label-mono">
                                        Runtime, memory, jobs, provider, and audit state in one room
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    )
}
