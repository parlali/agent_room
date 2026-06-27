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
                                    index === 0 ? 'bg-paper-sunken text-ink' : 'text-ink-faint'
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

const toneTint: Record<Tone, string> = {
    green: 'bg-accent-green/12 text-accent-green',
    amber: 'bg-accent-amber/12 text-accent-amber',
    blue: 'bg-accent-blue/12 text-accent-blue',
    red: 'bg-accent-red/12 text-accent-red',
}

const tonePill: Record<Tone, string> = {
    green: 'bg-accent-green/10 text-accent-green',
    amber: 'bg-accent-amber/10 text-accent-amber',
    blue: 'bg-accent-blue/10 text-accent-blue',
    red: 'bg-accent-red/10 text-accent-red',
}

const phoneRooms: {
    name: string
    initials: string
    tone: Tone
    state: string
    meta: string
    usage?: number
}[] = [
    {
        name: 'Market Research',
        initials: 'MR',
        tone: 'green',
        state: 'Running',
        meta: 'Active 12m',
        usage: 42,
    },
    {
        name: 'Content Calendar',
        initials: 'CC',
        tone: 'amber',
        state: 'Scheduled',
        meta: 'Tomorrow 9:00 AM',
    },
    {
        name: 'Competitor Watch',
        initials: 'CW',
        tone: 'blue',
        state: 'Idle',
        meta: 'Files 6',
    },
]

function RoomsGlyph({ active = false }: { active?: boolean }) {
    return (
        <span className="grid grid-cols-2 gap-[1.5px]" aria-hidden>
            {Array.from({ length: 4 }).map((_, index) => (
                <span
                    key={index}
                    className={`h-1.5 w-1.5 rounded-[1px] ${active ? 'bg-ink' : 'bg-ink-faint'}`}
                />
            ))}
        </span>
    )
}

export function PhoneMockup() {
    return (
        <figure
            className="mx-auto w-[272px] max-w-full overflow-hidden rounded-[var(--radius-media)] border border-line bg-panel shadow-float"
            aria-label="Agent Room on mobile: the rooms list with each coworker's status."
        >
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
                <div className="flex items-center gap-2">
                    <Glyph initials="AR" className="h-5 w-5" />
                    <span className="text-xs font-semibold text-ink">Agent Room</span>
                </div>
                <span className="relative" aria-hidden>
                    <Glyph initials="RO" className="h-6 w-6 rounded-full" />
                    <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full border border-panel bg-accent-blue" />
                </span>
            </div>
            <div className="bg-paper-sunken/40">
                <div className="flex items-center justify-between px-4 pt-3 pb-2">
                    <span className="text-base font-semibold text-ink">Rooms</span>
                    <span
                        className="flex h-6 w-6 items-center justify-center rounded-md bg-ink text-sm leading-none text-paper"
                        aria-hidden
                    >
                        +
                    </span>
                </div>
                <div className="space-y-2 px-3 pb-3">
                    {phoneRooms.map((room) => (
                        <div key={room.name} className="rounded-xl border border-line bg-panel p-3 shadow-panel">
                            <div className="flex items-center gap-2.5">
                                <span
                                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg font-mono text-[0.5625rem] font-semibold ${toneTint[room.tone]}`}
                                    aria-hidden
                                >
                                    {room.initials}
                                </span>
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-xs font-semibold text-ink">
                                        {room.name}
                                    </p>
                                    <p className="font-mono text-[0.5625rem] text-ink-faint">
                                        {room.meta}
                                    </p>
                                </div>
                                <span
                                    className={`shrink-0 rounded-full px-1.5 py-0.5 text-[0.5625rem] font-medium ${tonePill[room.tone]}`}
                                >
                                    {room.state}
                                </span>
                            </div>
                            {room.usage !== undefined ? (
                                <div className="mt-2.5 flex items-center gap-2">
                                    <span className="h-1 flex-1 overflow-hidden rounded-full bg-paper-sunken">
                                        <span
                                            className="block h-full rounded-full bg-accent-green"
                                            style={{ width: `${room.usage}%` }}
                                        />
                                    </span>
                                    <span className="font-mono text-[0.5625rem] text-ink-faint">
                                        {room.usage}%
                                    </span>
                                </div>
                            ) : null}
                        </div>
                    ))}
                </div>
            </div>
            <div className="flex items-center justify-around border-t border-line bg-panel px-2 py-2">
                <span className="flex flex-1 flex-col items-center gap-1 text-[0.5625rem] font-medium text-ink">
                    <span className="flex h-4 items-center">
                        <RoomsGlyph active />
                    </span>
                    Rooms
                </span>
                <span className="flex flex-1 flex-col items-center gap-1 text-[0.5625rem] font-medium text-ink-faint">
                    <span className="flex h-4 items-center">
                        <Glyph initials="RO" className="h-4 w-4 rounded-full" />
                    </span>
                    Account
                </span>
            </div>
        </figure>
    )
}

const anatomy = {
    files: [
        { name: 'Market Overview.pdf', kind: 'PDF', size: '1.2 MB' },
        { name: 'Q3 Forecast.xlsx', kind: 'XLS', size: '88 KB' },
        { name: 'Launch Brief.docx', kind: 'DOC', size: '42 KB' },
    ],
    tools: ['Web access', 'Documents', 'Spreadsheets', 'Images', 'Connected tools'],
}

export function RoomAnatomyMockup() {
    return (
        <figure
            className="surface-raised overflow-hidden"
            aria-label="One Agent Room coworker and everything it owns: brief, files, schedule, tools, and an isolated runtime."
        >
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
            <div className="grid gap-3 bg-paper-sunken/40 p-4 sm:grid-cols-2">
                <div className="rounded-[10px] border border-line bg-panel p-3.5">
                    <p className="font-mono text-[0.5625rem] font-medium uppercase tracking-[0.12em] text-ink-faint">
                        Identity &amp; memory
                    </p>
                    <p className="mt-2 text-xs leading-relaxed text-ink-soft">
                        Watches competitor releases, summarizes weekly, and keeps a running list of
                        positioning gaps.
                    </p>
                </div>
                <div className="rounded-[10px] border border-line bg-panel p-3.5">
                    <p className="font-mono text-[0.5625rem] font-medium uppercase tracking-[0.12em] text-ink-faint">
                        Files
                    </p>
                    <div className="mt-2 space-y-1.5">
                        {anatomy.files.map((file) => (
                            <div key={file.name} className="flex items-center gap-2">
                                <Glyph initials={file.kind} className="h-4 w-6 text-[0.4375rem]" />
                                <span className="min-w-0 flex-1 truncate text-[0.6875rem] text-ink">
                                    {file.name}
                                </span>
                                <span className="font-mono text-[0.5625rem] text-ink-faint">
                                    {file.size}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="rounded-[10px] border border-line bg-panel p-3.5">
                    <p className="font-mono text-[0.5625rem] font-medium uppercase tracking-[0.12em] text-ink-faint">
                        Scheduled tasks
                    </p>
                    <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-xs text-ink">
                            <StatusDot tone="amber" />
                            Weekly digest
                        </span>
                        <span className="font-mono text-[0.5625rem] text-ink-faint">
                            Mon 9:00 AM
                        </span>
                    </div>
                    <p className="mt-2 font-mono text-[0.5625rem] text-ink-faint">
                        Next run in 2 days
                    </p>
                </div>
                <div className="rounded-[10px] border border-line bg-panel p-3.5">
                    <p className="font-mono text-[0.5625rem] font-medium uppercase tracking-[0.12em] text-ink-faint">
                        Tools
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                        {anatomy.tools.map((tool) => (
                            <span
                                key={tool}
                                className="rounded-md border border-line bg-paper px-1.5 py-0.5 text-[0.5625rem] text-ink-soft"
                            >
                                {tool}
                            </span>
                        ))}
                    </div>
                </div>
            </div>
            <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-t border-line px-5 py-3 text-center font-mono text-[0.5625rem] font-medium uppercase tracking-[0.12em] text-ink-faint">
                <span>Isolated runtime</span>
                <span aria-hidden>·</span>
                <span>Its own credentials</span>
                <span aria-hidden>·</span>
                <span>Full audit trail</span>
            </p>
        </figure>
    )
}
