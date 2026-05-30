import { SectionLabel } from '../components/SectionLabel'

const parts = [
    {
        id: 'identity',
        title: 'Identity',
        body: 'A name, a system prompt, a mode (coworker or programmer). One coworker per room, not one chat per room.',
    },
    {
        id: 'memory',
        title: 'Memory',
        body: 'A typed JSON document. Responsibilities, standing preferences, decisions, reminders. Rendered into a bounded two-page brief on every turn.',
    },
    {
        id: 'filesystem',
        title: 'Filesystem',
        body: 'A real working directory the agent edits with normal file tools. DOCX, XLSX, PPTX, PDF, code, anything. Survives restarts.',
    },
    {
        id: 'jobs',
        title: 'Jobs',
        body: 'Scheduled autonomous runs. Daily reports, weekly digests, watchers. Idempotent claims, watchdogs, audit, no duplicate fires.',
    },
    {
        id: 'tools',
        title: 'Tools',
        body: 'Web search, URL fetch, document compose, image generate, code execute. MCP servers attached per room, not per user.',
    },
    {
        id: 'provider',
        title: 'Provider',
        body: 'OpenAI Codex OAuth, OpenRouter, Ollama, LM Studio. Bound to the room. Credentials encrypted at rest. Never silently swapped.',
    },
    {
        id: 'runtime',
        title: 'Runtime',
        body: 'A supervised Pi process per room. Single token. Single workspace root. Restart-safe. Streaming events, structured logs.',
    },
    {
        id: 'audit',
        title: 'Audit',
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
                <SectionLabel>How a room works</SectionLabel>

                <div className="mt-12 grid-12">
                    <div className="col-span-12 lg:col-span-5">
                        <h2 className="text-[34px] font-semibold leading-[1.1] sm:text-[46px]">
                            One room contains the identity, memory, tools, runtime, and audit trail.
                        </h2>
                        <p className="mt-8 max-w-md text-[15.5px] leading-[1.6] text-[var(--color-ink-dim)]">
                            Each room is materialized as its own workspace. You can open multiple
                            rooms without sharing files, memory, credentials, jobs, or provider
                            state between them.
                        </p>

                        <RoomDiagram className="mt-12" />
                    </div>

                    <div className="col-span-12 lg:col-span-7">
                        <div className="grid grid-cols-1 gap-px bg-[var(--color-rule)] sm:grid-cols-2">
                            {parts.map((p) => (
                                <PartCell key={p.id} part={p} />
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </section>
    )
}

function PartCell({ part }: { part: { id: string; title: string; body: string } }) {
    return (
        <div className="group relative bg-[var(--color-night)] p-6 transition hover:bg-[var(--color-night-elev)] sm:p-7">
            <h3 className="text-[18px] font-semibold text-[var(--color-ink)]">{part.title}</h3>
            <div className="mt-3 text-[15px] leading-[1.55] text-[var(--color-ink-dim)]">
                {part.body}
            </div>
        </div>
    )
}

function RoomDiagram({ className }: { className?: string }) {
    return (
        <div
            className={`relative border border-[var(--color-rule)] bg-[var(--color-night-elev)] p-5 ${className ?? ''}`}
        >
            <div className="flex items-center justify-between border-b border-[var(--color-rule)] pb-2.5">
                <span className="label-mono text-[var(--color-ink)]">Room boundary</span>
                <span className="label-mono">Per-room isolation</span>
            </div>
            <pre className="mt-3 overflow-x-auto whitespace-pre font-mono text-[10.5px] leading-[1.55] text-[var(--color-ink-dim)]">{`+-- room: studio-3 --------------------------------+
| identity    prompt, mode, model binding          |
| memory      memory.json, bounded turn brief      |
| filesystem  /room/{files,out,scratch,attach}     |
| jobs        cron, one-shot, idempotent claims     |
| tools       web, fetch, docs, images, MCP         |
| runtime     supervised Pi process, scoped token   |
| audit       events, usage, cost, provenance       |
+-- no state crosses the boundary without policy --+`}</pre>
        </div>
    )
}
