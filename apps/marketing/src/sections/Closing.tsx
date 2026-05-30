import { MarqueeLink } from '../components/Marquee'

export function Closing() {
    return (
        <>
            <div className="section-fade-to-night" aria-hidden />
            <section className="relative bg-[var(--color-night)] py-24 sm:py-32 lg:py-40">
            <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-10">
                <div className="grid-12">
                    <div className="col-span-12">
                        <div className="flex items-center gap-3">
                            <span className="label-mono">07 · OUTRO</span>
                            <span className="h-px flex-1 bg-[var(--color-rule)]" />
                            <span className="label-mono text-[var(--color-accent)]">
                                END OF DOCUMENT
                            </span>
                        </div>
                    </div>
                </div>

                <div className="mt-16 grid-12">
                    <div className="col-span-12 lg:col-span-9">
                        <h2
                            className="font-serif text-[56px] leading-[1.02] tracking-[-0.025em] sm:text-[80px] lg:text-[120px]"
                            style={{ fontVariationSettings: "'opsz' 144, 'SOFT' 50" }}
                        >
                            Boot a room.
                            <br />
                            <em
                                className="font-serif-italic text-[var(--color-quote)]"
                                style={{ fontStyle: 'italic' }}
                            >
                                Hire a coworker.
                            </em>
                        </h2>

                        <div className="mt-12 flex flex-wrap items-center gap-x-8 gap-y-5">
                            <MarqueeLink
                                href="https://github.com/parlali/agent_room"
                                external
                                marquee={false}
                                className="cta-fill px-6 py-3.5 text-[14px] font-medium tracking-tight"
                            >
                                Run the stack
                            </MarqueeLink>
                            <MarqueeLink
                                href="#pricing"
                                className="inline-flex items-center gap-3 px-1 text-[14px] tracking-tight text-[var(--color-ink)] underline decoration-[var(--color-ink-faint)] decoration-1 underline-offset-[6px] transition hover:decoration-[var(--color-accent)]"
                            >
                                Read the pricing note
                            </MarqueeLink>
                            <MarqueeLink
                                href="mailto:hello@openagentroom.com"
                                className="inline-flex items-center gap-3 px-1 text-[14px] tracking-tight text-[var(--color-ink-dim)] transition hover:text-[var(--color-ink)]"
                            >
                                hello@openagentroom.com →
                            </MarqueeLink>
                        </div>
                    </div>
                </div>
            </div>
        </section>
        </>
    )
}
