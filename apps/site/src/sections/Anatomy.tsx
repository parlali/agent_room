import { SectionLabel } from '../components/SectionLabel'

const parts = [
    {
        id: 'identity',
        title: 'IDENTITY',
        body: 'A name, a system prompt, a mode (coworker or programmer). One coworker per room, not one chat per room.',
    },
    {
        id: 'memory',
        title: 'MEMORY',
        body: 'A typed JSON document. Responsibilities, standing preferences, decisions, reminders. Rendered into a bounded two-page brief on every turn.',
    },
    {
        id: 'filesystem',
        title: 'FILESYSTEM',
        body: 'A real working directory the agent edits with normal file tools. DOCX, XLSX, PPTX, PDF, code, anything. Survives restarts.',
    },
    {
        id: 'jobs',
        title: 'JOBS',
        body: 'Scheduled autonomous runs. Daily reports, weekly digests, watchers. Idempotent claims, watchdogs, audit, no duplicate fires.',
    },
    {
        id: 'tools',
        title: 'TOOLS',
        body: 'Web search, URL fetch, document compose, image generate, code execute. MCP servers attached per room, not per user.',
    },
    {
        id: 'provider',
        title: 'PROVIDER',
        body: 'OpenAI Codex OAuth, OpenRouter, Ollama, LM Studio. Bound to the room. Credentials encrypted at rest. Never silently swapped.',
    },
    {
        id: 'runtime',
        title: 'RUNTIME',
        body: 'A supervised Pi process per room. Single token. Single workspace root. Restart-safe. Streaming events, structured logs.',
    },
    {
        id: 'audit',
        title: 'AUDIT',
        body: 'Every tool call, every file write, every memory change, every job fire is recorded with provenance. Usage and cost included.',
    },
]

export function Anatomy() {
    return (
        <section
            id="anatomy"
            className="relative border-t border-[var(--color-rule)] bg-[var(--color-night)] py-24 sm:py-32"
        >
            <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-10">
                <SectionLabel index="02">ANATOMY OF A ROOM</SectionLabel>

                <div className="mt-12 grid-12">
                    <div className="col-span-12 lg:col-span-5">
                        <h2
                            className="font-serif text-[40px] leading-[1.04] tracking-[-0.025em] sm:text-[52px]"
                            style={{ fontVariationSettings: "'opsz' 144, 'SOFT' 50" }}
                        >
                            Eight parts.{' '}
                            <em
                                className="font-serif-italic text-[var(--color-quote)]"
                                style={{ fontStyle: 'italic' }}
                            >
                                One boundary.
                            </em>{' '}
                            One coworker.
                        </h2>
                        <p className="mt-8 max-w-md text-[15.5px] leading-[1.6] text-[var(--color-ink-dim)]">
                            A room is not a chat window with extras bolted on. Every part is isolated to its room and
                            survives restarts. You can open ten rooms; they will share nothing.
                        </p>

                        <RoomDiagram className="mt-12" />
                    </div>

                    <div className="col-span-12 lg:col-span-7">
                        <div className="grid grid-cols-1 gap-px bg-[var(--color-rule)] sm:grid-cols-2">
                            {parts.map((p, i) => (
                                <PartCell key={p.id} index={String(i + 1).padStart(2, '0')} part={p} />
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </section>
    )
}

function PartCell({
    index,
    part,
}: {
    index: string
    part: { id: string; title: string; body: string }
}) {
    return (
        <div className="group relative bg-[var(--color-night)] p-6 transition hover:bg-[var(--color-night-elev)] sm:p-7">
            <div className="flex items-start justify-between">
                <span className="label-mono text-[var(--color-ink-faint)]">{index}</span>
                <span className="label-mono opacity-0 transition group-hover:opacity-100">→</span>
            </div>
            <div className="mt-5 font-mono text-[11px] tracking-[0.18em] text-[var(--color-accent)]">{part.title}</div>
            <div
                className="mt-3 font-serif text-[20px] leading-[1.35] text-[var(--color-ink)] sm:text-[22px]"
                style={{ fontVariationSettings: "'opsz' 60, 'SOFT' 80" }}
            >
                {part.body}
            </div>
        </div>
    )
}

function RoomDiagram({ className }: { className?: string }) {
    return (
        <div className={`relative border border-[var(--color-rule)] bg-[var(--color-night-elev)] p-5 ${className ?? ''}`}>
            <div className="flex items-center justify-between border-b border-[var(--color-rule)] pb-2.5">
                <span className="label-mono text-[var(--color-ink)]">ROOM BOUNDARY · schematic</span>
                <span className="label-mono">FIG 02-A</span>
            </div>
            <pre className="mt-3 overflow-x-auto whitespace-pre font-mono text-[10.5px] leading-[1.55] text-[var(--color-ink-dim)]">{`  ┌──────────────────────── ROOM · studio-3 ────────────────────────┐
  │                                                                 │
  │   IDENTITY ──── prompt · mode · model binding                   │
  │       │                                                         │
  │   MEMORY ───── memory.json ──── render brief (bounded)          │
  │       │                                                         │
  │   FILESYSTEM ─ /room/{files, out, scratch, attach}              │
  │       │                                                         │
  │   JOBS ─────── cron · once · idempotent claim                   │
  │       │                                                         │
  │   TOOLS ────── web · fetch · docs · images · MCP·               │
  │       │                                                         │
  │   RUNTIME ──── pi · supervised · token-scoped                   │
  │       │                                                         │
  │   AUDIT ───── events · usage · cost · provenance                │
  │                                                                 │
  └─────────── nothing crosses this line without policy ────────────┘`}</pre>
        </div>
    )
}
