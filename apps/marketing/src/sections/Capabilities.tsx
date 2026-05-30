import { SectionLabel } from '../components/SectionLabel'

const caps = [
    {
        title: 'A real filesystem',
        body: 'Each room owns /room. Drafts, code, datasets, generated DOCX and PDF outputs persist across sessions, restarts, and deploys.',
        spec: 'POSIX, per-room mount, expandable storage',
    },
    {
        title: 'Structured memory',
        body: 'memory.json is the source of truth: who this agent is, what it owns, standing preferences, durable decisions, reminders. Rendered into a bounded two-page brief on every turn. You can edit it directly.',
        spec: 'typed JSON, room-local, bounded render budget',
    },
    {
        title: 'Compose deployment',
        body: 'Boot the whole stack with one Docker command. App, Postgres, internal SearXNG. The default binds to 127.0.0.1, generates first-boot credentials, encrypts secrets at rest. Put a reverse proxy in front when ready.',
        spec: 'Docker Compose, localhost-bound, generated keys',
    },
    {
        title: 'A dedicated programmer mode',
        body: 'Switch a room to programmer mode: project-aware tools, repo-grounded planning, source-of-truth code edits, git-aware verification. Reads CLAUDE.md and AGENTS.md as task context, not as identity.',
        spec: 'mode-aware prompt, repo tools, verifier loop',
    },
    {
        title: 'Web search, built in',
        body: 'A private SearXNG ships in the compose stack. No third-party search key. Search the web, fetch a known URL, ground answers in evidence. Browser automation and computer use slot in later as a deeper layer.',
        spec: 'SearXNG, URL fetch, safe content extraction',
    },
    {
        title: 'Office documents and PDFs',
        body: 'Native composition of DOCX, XLSX, PPTX and export to PDF. The agent talks in the formats real work happens in. Pandoc, LibreOffice, qpdf, ghostscript, poppler all baked into the runtime image.',
        spec: 'DOCX, XLSX, PPTX, PDF, preview, provenance',
    },
    {
        title: 'MCP, scoped per room',
        body: 'Attach Model Context Protocol servers at the room level, not globally. A finance room sees finance tools, a personal room sees calendar. The room is the trust boundary.',
        spec: 'MCP per room, typed schema, scoped credentials',
    },
    {
        title: 'Scheduled autonomous jobs',
        body: 'Cron- and one-shot jobs run inside the room with the same identity, memory, and tools. Idempotent claims, watchdogs, structured run history. The work that has to happen at 09:00 happens at 09:00.',
        spec: 'cron, one-shot, idempotent, audited',
    },
    {
        title: 'Provider truth',
        body: 'OpenAI Codex OAuth, OpenRouter, Ollama, LM Studio. Bound explicitly to a room. No silent provider swap, no flattening that hides per-provider semantics. Connection tests use the same runtime path as the room.',
        spec: 'Codex OAuth, OpenRouter, Ollama, LM Studio',
    },
    {
        title: 'Usage and cost, honest',
        body: 'Tokens, cost estimates, runtime, tool calls, scheduled run history per room. Unknown stays unknown. No invented numbers when a provider does not expose them.',
        spec: 'per-room ledger, audit-ready, honest unknowns',
    },
]

export function Capabilities() {
    return (
        <section className="relative border-t border-[var(--color-rule)] bg-[var(--color-night)] py-24 sm:py-32">
            <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-10">
                <SectionLabel>Capabilities</SectionLabel>

                <div className="mt-12 grid-12">
                    <div className="col-span-12 lg:col-span-8">
                        <h2 className="text-[38px] font-semibold leading-[1.08] sm:text-[50px] lg:text-[58px]">
                            Built for persistent work, scheduled work, and file-backed outputs.
                        </h2>
                    </div>
                    <div className="col-span-12 lg:col-span-4 lg:pt-3">
                        <p className="text-[15.5px] leading-[1.6] text-[var(--color-ink-dim)]">
                            The core surface is deliberately small: durable workspace state,
                            provider binding, document generation, web access, MCP, scheduling, and
                            auditability.
                        </p>
                    </div>
                </div>

                <div className="mt-16 border-t border-[var(--color-rule)]">
                    {caps.map((c) => (
                        <CapRow key={c.title} {...c} />
                    ))}
                </div>
            </div>
        </section>
    )
}

function CapRow({ title, body, spec }: { title: string; body: string; spec: string }) {
    return (
        <article className="group grid grid-cols-12 gap-x-6 border-b border-[var(--color-rule)] py-8 transition lg:gap-x-10 lg:py-10">
            <div className="col-span-12 lg:col-span-4">
                <h3 className="text-[26px] font-semibold leading-[1.15] text-[var(--color-ink)] sm:text-[30px]">
                    {title}
                </h3>
            </div>
            <div className="col-span-12 lg:col-span-5">
                <p className="text-[15px] leading-[1.6] text-[var(--color-ink-dim)] sm:text-[16px]">
                    {body}
                </p>
            </div>
            <div className="col-span-12 lg:col-span-3">
                <div className="label-mono mt-1.5 text-[var(--color-ink-faint)]">Detail</div>
                <div className="mt-2 font-mono text-[11px] leading-[1.5] text-[var(--color-ink-dim)]">
                    {spec}
                </div>
            </div>
        </article>
    )
}
