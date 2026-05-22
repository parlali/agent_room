import { SectionLabel } from '../components/SectionLabel'

const caps = [
    {
        idx: '03A',
        title: 'A real filesystem',
        body: 'Each room owns /room. Drafts, drafts of drafts, code, datasets, generated DOCX and PDF. Persistent across sessions, restarts, deploys. The agent edits with normal file primitives, no clever in-memory shim.',
        spec: 'POSIX · per-room mount · 256MB default · expandable',
    },
    {
        idx: '03B',
        title: 'Structured memory, not vibes',
        body: 'memory.json is the source of truth: who this agent is, what it owns, standing preferences, durable decisions, reminders. Rendered into a bounded two-page brief on every turn. You can edit it directly.',
        spec: 'typed JSON · two-page render budget · room-local',
    },
    {
        idx: '03C',
        title: 'Single-click sandboxed deployment',
        body: 'Boot the whole stack with one Docker command. App, Postgres, internal SearXNG. The default binds to 127.0.0.1, generates first-boot credentials, encrypts secrets at rest. Put a reverse proxy in front when ready.',
        spec: 'docker compose up · localhost-bound · generated keys',
    },
    {
        idx: '03D',
        title: 'A dedicated programmer mode',
        body: 'Switch a room to programmer mode: project-aware tools, repo-grounded planning, source-of-truth code edits, git-aware verification. Reads CLAUDE.md and AGENTS.md as task context, not as identity.',
        spec: 'mode-aware system prompt · repo tools · verifier loop',
    },
    {
        idx: '03E',
        title: 'Web search, built in',
        body: 'A private SearXNG ships in the compose stack. No third-party search key. Search the web, fetch a known URL, ground answers in evidence. Browser automation and computer use slot in later as a deeper layer.',
        spec: 'SearXNG · URL fetch · safe content extraction',
    },
    {
        idx: '03F',
        title: 'Office documents and PDFs',
        body: 'Native composition of DOCX, XLSX, PPTX and export to PDF. The agent talks in the formats real work happens in. Pandoc, LibreOffice, qpdf, ghostscript, poppler all baked into the runtime image.',
        spec: 'DOCX · XLSX · PPTX · PDF · preview · provenance',
    },
    {
        idx: '03G',
        title: 'MCP, scoped per room',
        body: 'Attach Model Context Protocol servers at the room level, not globally. A finance room sees finance tools, a personal room sees calendar. The room is the trust boundary.',
        spec: 'MCP per room · typed schema · scoped credentials',
    },
    {
        idx: '03H',
        title: 'Scheduled autonomous jobs',
        body: 'Cron- and one-shot jobs run inside the room with the same identity, memory, and tools. Idempotent claims, watchdogs, structured run history. The work that has to happen at 09:00 happens at 09:00.',
        spec: 'cron · once · idempotent · audited',
    },
    {
        idx: '03I',
        title: 'Provider truth',
        body: 'OpenAI Codex OAuth, OpenRouter, Ollama, LM Studio. Bound explicitly to a room. No silent provider swap, no flattening that hides per-provider semantics. Connection tests use the same runtime path as the room.',
        spec: 'codex oauth · openrouter · ollama · lm studio',
    },
    {
        idx: '03J',
        title: 'Usage and cost, honest',
        body: 'Tokens, cost estimates, runtime, tool calls, scheduled run history per room. Unknown stays unknown. No invented numbers when a provider does not expose them.',
        spec: 'per-room ledger · audit-ready · honest unknowns',
    },
]

export function Capabilities() {
    return (
        <section className="relative border-t border-[var(--color-rule)] bg-[var(--color-night)] py-24 sm:py-32">
            <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-10">
                <SectionLabel index="03">CAPABILITY SHEET</SectionLabel>

                <div className="mt-12 grid-12">
                    <div className="col-span-12 lg:col-span-8">
                        <h2
                            className="font-serif text-[44px] leading-[1.04] tracking-[-0.025em] sm:text-[56px] lg:text-[64px]"
                            style={{ fontVariationSettings: "'opsz' 144, 'SOFT' 50" }}
                        >
                            Built for{' '}
                            <em
                                className="font-serif-italic text-[var(--color-quote)]"
                                style={{ fontStyle: 'italic' }}
                            >
                                actual work,
                            </em>
                            <br />
                            not for the demo reel.
                        </h2>
                    </div>
                    <div className="col-span-12 lg:col-span-4 lg:pt-3">
                        <p className="text-[15.5px] leading-[1.6] text-[var(--color-ink-dim)]">
                            The list of what a room can do is short, deliberate, and oriented around the kinds of
                            work an actual coworker takes off your plate. Nothing here is &ldquo;coming soon.&rdquo;
                        </p>
                    </div>
                </div>

                <div className="mt-16 border-t border-[var(--color-rule)]">
                    {caps.map((c) => (
                        <CapRow key={c.idx} {...c} />
                    ))}
                </div>
            </div>
        </section>
    )
}

function CapRow({ idx, title, body, spec }: { idx: string; title: string; body: string; spec: string }) {
    return (
        <article className="group grid grid-cols-12 gap-x-6 border-b border-[var(--color-rule)] py-8 transition lg:gap-x-10 lg:py-10">
            <div className="col-span-12 sm:col-span-2 lg:col-span-1">
                <span className="label-mono text-[var(--color-ink-faint)] transition group-hover:text-[var(--color-accent)]">
                    {idx}
                </span>
            </div>
            <div className="col-span-12 sm:col-span-10 lg:col-span-5">
                <h3
                    className="font-serif text-[28px] leading-[1.1] tracking-[-0.02em] text-[var(--color-ink)] sm:text-[34px] lg:text-[40px]"
                    style={{ fontVariationSettings: "'opsz' 96, 'SOFT' 60" }}
                >
                    {title}
                </h3>
            </div>
            <div className="col-span-12 sm:col-span-8 lg:col-span-4">
                <p className="text-[15px] leading-[1.6] text-[var(--color-ink-dim)] sm:text-[16px]">{body}</p>
            </div>
            <div className="col-span-12 sm:col-span-4 lg:col-span-2">
                <div className="label-mono mt-1.5 text-right text-[var(--color-ink-faint)]">SPEC</div>
                <div className="mt-2 text-right font-mono text-[11px] leading-[1.5] text-[var(--color-ink-dim)]">
                    {spec}
                </div>
            </div>
        </article>
    )
}
