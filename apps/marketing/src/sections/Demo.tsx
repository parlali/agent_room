import { SectionLabel } from '../components/SectionLabel'
import { BrandMark } from '@agent-room/brand'

const sidebar = ['studio-3', 'pricing-watch', 'monday-planner', 'codex-room', 'support-triage']

const events = [
    { who: 'OPERATOR', text: 'Pull the may pricing report and email a summary.' },
    { who: 'STUDIO-3', text: 'memory.read - "report style: short prose + 2 tables"', mono: true },
    { who: 'STUDIO-3', text: 'web.search - "lithium spot may 2026"', mono: true },
    { who: 'STUDIO-3', text: 'web.fetch - reuters.com - 38KB', mono: true },
    { who: 'STUDIO-3', text: 'docx.compose - briefing.docx - 12 pages', mono: true },
    {
        who: 'STUDIO-3',
        text: 'Wrote /out/may-2026-pricing.docx (81KB). Summary: prices held flat against April, vendor X has best Q3 terms, I kept the recommendation we agreed on last week.',
    },
]

export function Demo() {
    return (
        <section className="relative border-t border-[var(--color-rule)] bg-[var(--color-night)] py-24 sm:py-32">
            <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-10">
                <SectionLabel>Dashboard</SectionLabel>

                <div className="mt-12 grid-12">
                    <div className="col-span-12 lg:col-span-5">
                        <h2 className="text-[34px] font-semibold leading-[1.1] sm:text-[44px] lg:text-[52px]">
                            Manage rooms, sessions, files, jobs, memory, and usage from one place.
                        </h2>
                        <p className="mt-8 max-w-md text-[15.5px] leading-[1.6] text-[var(--color-ink-dim)]">
                            The dashboard keeps the chat surface close to the operational state.
                            Room files, memory, scheduled jobs, provider identity, usage, and event
                            history are visible without leaving the room.
                        </p>
                        <ul className="mt-10 space-y-3.5 font-mono text-[12px] text-[var(--color-ink-dim)]">
                            <DemoBullet>
                                tabbed surfaces for chat, files, memory, jobs, usage
                            </DemoBullet>
                            <DemoBullet>per-room sidebar tree</DemoBullet>
                            <DemoBullet>file preview for DOCX, XLSX, PPTX, PDF, image</DemoBullet>
                            <DemoBullet>live event stream, audit-grade timeline</DemoBullet>
                            <DemoBullet>dark and light themes</DemoBullet>
                        </ul>
                    </div>

                    <div className="col-span-12 mt-16 lg:col-span-7 lg:mt-0">
                        <div className="relative border border-[var(--color-rule)] bg-[var(--color-night-elev)] shadow-[0_40px_80px_-30px_rgba(0,0,0,0.6)]">
                            <div className="flex items-center justify-between border-b border-[var(--color-rule)] px-3 py-2">
                                <div className="flex items-center gap-2">
                                    <span className="block h-2.5 w-2.5 rounded-full bg-[var(--color-rule-bright)]" />
                                    <span className="block h-2.5 w-2.5 rounded-full bg-[var(--color-rule-bright)]" />
                                    <span className="block h-2.5 w-2.5 rounded-full bg-[var(--color-rule-bright)]" />
                                </div>
                                <span className="label-mono">
                                    localhost:3000 / rooms / studio-3
                                </span>
                                <BrandMark size={14} className="text-[var(--color-ink-dim)]" />
                            </div>
                            <div className="grid min-h-[460px] grid-cols-1 sm:grid-cols-[160px_1fr]">
                                <aside className="border-r border-[var(--color-rule)] p-3">
                                    <div className="label-mono mb-3 px-1">ROOMS</div>
                                    <ul className="space-y-1">
                                        {sidebar.map((s, i) => (
                                            <li
                                                key={s}
                                                className={`group flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-[12px] ${
                                                    i === 0
                                                        ? 'bg-[var(--color-accent-faint)] text-[var(--color-ink)]'
                                                        : 'text-[var(--color-ink-dim)]'
                                                }`}
                                            >
                                                <span
                                                    className={`block h-1 w-1 rounded-full ${
                                                        i === 0
                                                            ? 'bg-[var(--color-accent)]'
                                                            : 'bg-[var(--color-rule-bright)]'
                                                    }`}
                                                />
                                                <span className="font-mono">{s}</span>
                                            </li>
                                        ))}
                                    </ul>
                                    <div className="label-mono mt-7 mb-3 px-1">SURFACES</div>
                                    <ul className="space-y-1 font-mono text-[11px] text-[var(--color-ink-faint)]">
                                        <li className="px-2 text-[var(--color-ink)]">chat</li>
                                        <li className="px-2">files</li>
                                        <li className="px-2">memory</li>
                                        <li className="px-2">jobs</li>
                                        <li className="px-2">usage</li>
                                        <li className="px-2">status</li>
                                        <li className="px-2">settings</li>
                                    </ul>
                                </aside>
                                <div className="p-5">
                                    <div className="flex items-center justify-between border-b border-[var(--color-rule)] pb-3">
                                        <div>
                                            <div className="label-mono">Session 14:02</div>
                                            <h3 className="mt-1 text-[22px] font-semibold text-[var(--color-ink)]">
                                                studio-3 - coworker mode
                                            </h3>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <span className="relative inline-flex h-1.5 w-1.5">
                                                <span className="absolute inset-0 rounded-full bg-[var(--color-accent)] animate-pulse-soft" />
                                            </span>
                                            <span className="label-mono">RUNNING</span>
                                        </div>
                                    </div>

                                    <div className="mt-5 space-y-3.5">
                                        {events.map((e, i) => (
                                            <div
                                                key={i}
                                                className="grid grid-cols-[80px_1fr] gap-4"
                                            >
                                                <div
                                                    className={`label-mono pt-1 ${
                                                        e.who === 'OPERATOR'
                                                            ? 'text-[var(--color-ink)]'
                                                            : 'text-[var(--color-accent)]'
                                                    }`}
                                                >
                                                    {e.who}
                                                </div>
                                                <div
                                                    className={`text-[13px] leading-[1.55] ${
                                                        e.mono
                                                            ? 'font-mono text-[12px] text-[var(--color-ink-dim)]'
                                                            : 'text-[var(--color-ink)]'
                                                    }`}
                                                >
                                                    {e.text}
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    <div className="mt-6 flex items-center gap-2 border-t border-[var(--color-rule)] pt-4">
                                        <span className="font-mono text-[12px] text-[var(--color-ink-faint)]">
                                            $
                                        </span>
                                        <span className="cursor-blink font-mono text-[12px] text-[var(--color-ink-dim)]">
                                            Pin this report style for monthly use
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center justify-between gap-4 border-t border-[var(--color-rule)] px-3 py-2 font-mono text-[10.5px] text-[var(--color-ink-faint)]">
                                <span>events, streaming, 42,318 tok today, $0.47</span>
                                <span>provider: codex/oai, model: gpt-5, auth: oauth</span>
                            </div>
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-4">
                            <span className="label-mono">Dashboard preview</span>
                            <span className="label-mono">CSV, JSON, and provenance exports</span>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    )
}

function DemoBullet({ children }: { children: React.ReactNode }) {
    return (
        <li className="flex gap-3">
            <span className="mt-1.5 inline-block h-[2px] w-3 shrink-0 bg-[var(--color-accent)]" />
            <span>{children}</span>
        </li>
    )
}
