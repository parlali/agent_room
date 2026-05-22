import { RoomConsole } from '../components/RoomConsole'
import { MarqueeLink } from '../components/Marquee'

export function Hero() {
    return (
        <section className="relative pt-10 pb-24 sm:pt-14 sm:pb-32 lg:pt-20 lg:pb-40">
            <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-10">
                <div className="grid-12">
                    <div className="col-span-12 lg:col-span-7">
                        <div className="flex items-center gap-2.5">
                            <span className="label-mono">000 · INDEX</span>
                            <span className="h-px w-10 bg-[var(--color-rule-bright)]" />
                            <span className="label-mono text-[var(--color-accent)]">
                                FILE 01 OF 07
                            </span>
                        </div>

                        <h1
                            className="mt-10 font-serif text-[52px] leading-[1.02] tracking-[-0.025em] text-[var(--color-ink)] sm:text-[68px] lg:text-[88px]"
                            style={{ fontVariationSettings: "'opsz' 144, 'SOFT' 50" }}
                        >
                            <span
                                className="block opacity-0"
                                style={{
                                    animation:
                                        'reveal-up 1s cubic-bezier(0.16, 1, 0.3, 1) 0.05s forwards',
                                }}
                            >
                                Self-hosted
                            </span>
                            <span
                                className="block opacity-0"
                                style={{
                                    animation:
                                        'reveal-up 1s cubic-bezier(0.16, 1, 0.3, 1) 0.18s forwards',
                                }}
                            >
                                rooms for{' '}
                                <em
                                    className="font-serif-italic text-[var(--color-quote)]"
                                    style={{ fontStyle: 'italic' }}
                                >
                                    persistent
                                </em>
                            </span>
                            <span
                                className="block opacity-0"
                                style={{
                                    animation:
                                        'reveal-up 1s cubic-bezier(0.16, 1, 0.3, 1) 0.32s forwards',
                                }}
                            >
                                AI{' '}
                                <em
                                    className="font-serif-italic text-[var(--color-quote)]"
                                    style={{ fontStyle: 'italic' }}
                                >
                                    coworkers.
                                </em>
                            </span>
                        </h1>

                        <p
                            className="mt-10 max-w-[34rem] text-[16.5px] leading-[1.6] text-[var(--color-ink-dim)] opacity-0 sm:text-[17.5px]"
                            style={{
                                animation:
                                    'reveal-up 1s cubic-bezier(0.16, 1, 0.3, 1) 0.55s forwards',
                            }}
                        >
                            Every other agent forgets you the second the chat closes. A room
                            remembers.
                            <br />
                            <br />
                            Each room is one standalone coworker with its own filesystem, structured
                            memory, scheduled jobs, tools, MCP bindings, provider identity, and
                            audit trail. Boot the whole thing with one Docker command on your own
                            machine.
                        </p>

                        <div
                            className="mt-12 flex flex-wrap items-center gap-x-8 gap-y-5 opacity-0"
                            style={{
                                animation:
                                    'reveal-up 1s cubic-bezier(0.16, 1, 0.3, 1) 0.7s forwards',
                            }}
                        >
                            <MarqueeLink
                                href="https://github.com/parlali/agent_room"
                                external
                                className="group inline-flex items-center gap-3 border border-[var(--color-ink)] bg-[var(--color-ink)] px-5 py-3 text-[13.5px] font-medium tracking-tight text-[var(--color-night)] transition hover:bg-transparent hover:text-[var(--color-ink)]"
                            >
                                Run the stack
                            </MarqueeLink>
                            <MarqueeLink
                                href="#anatomy"
                                className="inline-flex items-center gap-3 px-1 text-[13.5px] tracking-tight text-[var(--color-ink)] underline decoration-[var(--color-ink-faint)] decoration-1 underline-offset-[6px] transition hover:decoration-[var(--color-accent)]"
                            >
                                Walk through a room
                            </MarqueeLink>
                            <span className="label-mono">$ docker compose up -d --build</span>
                        </div>
                    </div>

                    <div className="col-span-12 mt-16 lg:col-span-5 lg:mt-0">
                        <div className="lg:sticky lg:top-24">
                            <div
                                className="opacity-0"
                                style={{
                                    animation:
                                        'reveal-up 1.2s cubic-bezier(0.16, 1, 0.3, 1) 0.45s forwards',
                                }}
                            >
                                <div className="mb-3 flex items-center justify-between">
                                    <span className="label-mono">
                                        LIVE ROOM · SAMPLE TRANSCRIPT
                                    </span>
                                    <span className="label-mono">RENDERED LOCALLY</span>
                                </div>
                                <RoomConsole />
                                <div className="mt-3 flex items-center justify-between">
                                    <span className="label-mono">
                                        IDENTICAL TO WHAT YOU SEE INSIDE A SELF-HOSTED INSTANCE
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
