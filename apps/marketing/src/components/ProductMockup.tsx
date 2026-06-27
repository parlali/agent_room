import { StatusDot } from './primitives'

type Tone = 'green' | 'blue' | 'amber' | 'red'

const railRooms: { name: string; tone: Tone; state: string; active?: boolean }[] = [
    { name: 'Market Research', tone: 'green', state: 'Running', active: true },
    { name: 'Content Calendar', tone: 'amber', state: 'Scheduled' },
    { name: 'Competitor Watch', tone: 'blue', state: 'Idle' },
    { name: 'Product Launch', tone: 'red', state: 'Needs setup' },
]

const roomTabs = ['Chat', 'Files', 'Tasks', 'Memory', 'Settings']

function WindowDots() {
    return (
        <span className="flex items-center gap-1.5" aria-hidden>
            <span className="h-2 w-2 rounded-full bg-line-strong" />
            <span className="h-2 w-2 rounded-full bg-line-strong" />
            <span className="h-2 w-2 rounded-full bg-line-strong" />
        </span>
    )
}

function Glyph({ initials, className = '' }: { initials: string; className?: string }) {
    return (
        <span
            className={`flex items-center justify-center rounded-md bg-ink font-mono text-[0.625rem] font-semibold text-paper ${className}`}
            aria-hidden
        >
            {initials}
        </span>
    )
}

export function DesktopMockup() {
    return (
        <figure
            className="relative overflow-hidden rounded-[var(--radius-media)] border border-line bg-panel shadow-float"
            aria-label="Agent Room desktop: a Market Research room with its conversation, web activity, and a generated file."
        >
            <div className="flex items-center gap-3 border-b border-line px-4 py-3">
                <WindowDots />
                <p className="font-mono text-[0.625rem] font-medium uppercase tracking-[0.12em] text-ink-faint">
                    Agent Room
                </p>
            </div>
            <div className="grid grid-cols-[150px_1fr] sm:grid-cols-[190px_1fr]">
                <aside className="hidden flex-col border-r border-line bg-paper-sunken/60 p-3 sm:flex">
                    <div className="flex items-center gap-2 px-1 pb-3">
                        <Glyph initials="AR" className="h-5 w-5" />
                        <span className="text-xs font-semibold text-ink">Agent Room</span>
                    </div>
                    <p className="px-1 pb-1.5 font-mono text-[0.5625rem] font-medium uppercase tracking-[0.12em] text-ink-faint">
                        Rooms
                    </p>
                    <div className="flex flex-col gap-0.5">
                        {railRooms.map((room) => (
                            <div
                                key={room.name}
                                className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 ${
                                    room.active ? 'bg-panel shadow-panel' : ''
                                }`}
                            >
                                <span className="truncate text-xs text-ink-soft">{room.name}</span>
                                <StatusDot tone={room.tone} />
                            </div>
                        ))}
                    </div>
                    <div className="mt-auto flex items-center gap-2 border-t border-line px-1 pt-3">
                        <Glyph initials="RO" className="h-5 w-5" />
                        <span className="truncate text-[0.625rem] text-ink-faint">
                            you@team.com
                        </span>
                    </div>
                </aside>
                <div className="flex min-h-[360px] flex-col sm:min-h-[440px]">
                    <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
                        <Glyph initials="MR" className="h-7 w-7" />
                        <span className="text-sm font-semibold text-ink">Market Research</span>
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-green/10 px-2 py-0.5 text-[0.625rem] font-medium text-accent-green">
                            <StatusDot tone="green" />
                            Running
                        </span>
                        <span className="rounded-md border border-line px-1.5 py-0.5 text-[0.625rem] font-medium text-ink-faint">
                            Coworker
                        </span>
                    </div>
                    <div className="flex items-center gap-1 border-b border-line px-3 py-2">
                        {roomTabs.map((tab, index) => (
                            <span
                                key={tab}
                                className={`rounded-md px-2 py-1 text-xs font-medium ${
                                    index === 0
                                        ? 'bg-paper-sunken text-ink'
                                        : 'text-ink-faint'
                                }`}
                            >
                                {tab}
                            </span>
                        ))}
                    </div>
                    <div className="flex-1 space-y-3 overflow-hidden bg-paper-sunken/40 p-4">
                        <div className="ml-auto max-w-[78%] rounded-2xl rounded-br-md bg-ink px-3.5 py-2 text-xs leading-relaxed text-paper">
                            Summarize this week&apos;s competitor launches and draft a one-page
                            brief.
                        </div>
                        <div className="max-w-[88%] space-y-2">
                            <div className="surface-raised p-3">
                                <div className="flex items-center gap-2 pb-2 text-[0.6875rem] font-medium text-ink">
                                    <span className="text-accent-green" aria-hidden>
                                        {'◉'}
                                    </span>
                                    Searched the web
                                    <span className="font-mono text-[0.5625rem] uppercase tracking-[0.08em] text-ink-faint">
                                        Web access
                                    </span>
                                </div>
                                <p className="text-[0.6875rem] text-ink-soft">
                                    &ldquo;competitor product launches this week&rdquo;
                                </p>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {['techcrunch.com', 'theverge.com', 'producthunt.com'].map(
                                        (source) => (
                                            <span
                                                key={source}
                                                className="rounded-md border border-line bg-panel px-1.5 py-0.5 font-mono text-[0.5625rem] text-ink-soft"
                                            >
                                                {source}
                                            </span>
                                        ),
                                    )}
                                </div>
                            </div>
                            <p className="text-xs leading-relaxed text-ink-soft">
                                Three notable launches this week. I drafted the brief with the
                                positioning gaps and a recommended response.
                            </p>
                            <div className="inline-flex items-center gap-2 rounded-lg border border-line bg-panel px-2.5 py-1.5">
                                <Glyph initials="PDF" className="h-5 w-7 text-[0.5rem]" />
                                <span className="text-[0.6875rem] font-medium text-ink">
                                    Market Overview.pdf
                                </span>
                                <span className="font-mono text-[0.5625rem] text-ink-faint">
                                    1.2 MB
                                </span>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 border-t border-line bg-panel px-4 py-2.5">
                        <div className="flex-1 rounded-lg border border-line px-3 py-1.5 text-xs text-ink-faint">
                            Message Market Research
                        </div>
                        <span
                            className="flex h-7 w-7 items-center justify-center rounded-lg bg-ink text-paper"
                            aria-hidden
                        >
                            {'↑'}
                        </span>
                    </div>
                </div>
            </div>
        </figure>
    )
}

export function PhoneMockup() {
    return (
        <div
            className="mx-auto w-[270px] max-w-full rounded-[2.75rem] border border-line bg-night p-2.5 shadow-float"
            aria-label="Agent Room on mobile: the rooms list with each coworker's status."
        >
            <div className="overflow-hidden rounded-[2.25rem] bg-paper">
                <div className="flex items-center justify-between px-4 pb-2 pt-4">
                    <div className="flex items-center gap-2">
                        <Glyph initials="AR" className="h-5 w-5" />
                        <span className="text-xs font-semibold text-ink">Agent Room</span>
                    </div>
                    <Glyph initials="RO" className="h-6 w-6 rounded-full" />
                </div>
                <div className="flex items-center justify-between px-4 pb-2">
                    <span className="text-base font-semibold text-ink">Rooms</span>
                    <span
                        className="flex h-6 w-6 items-center justify-center rounded-md bg-ink text-sm text-paper"
                        aria-hidden
                    >
                        +
                    </span>
                </div>
                <div className="space-y-2 px-3 pb-3">
                    {railRooms.slice(0, 3).map((room) => (
                        <div key={room.name} className="rounded-xl border border-line bg-panel p-3">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-semibold text-ink">{room.name}</span>
                                <span className="inline-flex items-center gap-1 text-[0.625rem] font-medium text-ink-faint">
                                    <StatusDot tone={room.tone} />
                                    {room.state}
                                </span>
                            </div>
                            <div className="mt-2 flex items-center gap-3 font-mono text-[0.5625rem] text-ink-faint">
                                <span>Files 4</span>
                                <span>Next run 48m</span>
                            </div>
                        </div>
                    ))}
                </div>
                <div className="flex items-center justify-around border-t border-line px-2 py-2">
                    <span className="flex flex-col items-center gap-0.5 text-[0.5625rem] font-medium text-ink">
                        <span className="text-sm" aria-hidden>
                            {'▦'}
                        </span>
                        Rooms
                    </span>
                    <span className="flex flex-col items-center gap-0.5 text-[0.5625rem] font-medium text-ink-faint">
                        <Glyph initials="RO" className="h-4 w-4 rounded-full" />
                        Account
                    </span>
                </div>
            </div>
        </div>
    )
}
