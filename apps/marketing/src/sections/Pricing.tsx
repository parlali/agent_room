import { MarqueeLink } from '../components/Marquee'

export function Pricing() {
    return (
        <section
            id="pricing"
            className="relative border-t border-[var(--color-rule)] bg-[var(--color-paper)] text-[var(--color-paper-ink)]"
        >
            <div className="mx-auto max-w-[1440px] px-4 py-24 sm:px-6 sm:py-32 lg:px-10">
                <div className="flex items-center gap-3">
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-paper-dim)]">
                        06 · PRICING
                    </span>
                    <span className="h-px flex-1 bg-[var(--color-paper-rule)]" />
                </div>

                <div className="mt-12 grid-12">
                    <div className="col-span-12 lg:col-span-7">
                        <h2
                            className="font-serif text-[44px] leading-[1.04] tracking-[-0.025em] sm:text-[60px] lg:text-[80px]"
                            style={{ fontVariationSettings: "'opsz' 144, 'SOFT' 30" }}
                        >
                            Free, while we get it{' '}
                            <em
                                className="font-serif-italic text-[var(--color-paper-dim)]"
                                style={{ fontStyle: 'italic' }}
                            >
                                right.
                            </em>
                        </h2>
                        <p className="mt-8 max-w-xl text-[16.5px] leading-[1.6] text-[var(--color-paper-dim)] sm:text-[17.5px]">
                            Agent Room is open source and self-hosted today. Run it on your laptop,
                            your homelab, your VPS. No accounts, no telemetry, no per-seat math. A
                            managed hosted plan is in design for when running your own Postgres
                            stops being your favorite hobby.
                        </p>
                    </div>
                    <div className="col-span-12 lg:col-span-4 lg:col-start-9">
                        <div className="border border-[var(--color-paper-rule)] bg-[var(--color-paper)] p-5">
                            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-paper-dim)]">
                                CURRENT STATUS
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-[11.5px] text-[var(--color-paper-ink)]">
                                <span className="text-[var(--color-paper-dim)]">build</span>
                                <span className="text-right">0.9 · alpha</span>
                                <span className="text-[var(--color-paper-dim)]">license</span>
                                <span className="text-right">MIT</span>
                                <span className="text-[var(--color-paper-dim)]">self-hosted</span>
                                <span className="text-right">available now</span>
                                <span className="text-[var(--color-paper-dim)]">
                                    hosted (cloud)
                                </span>
                                <span className="text-right">closed alpha</span>
                                <span className="text-[var(--color-paper-dim)]">team plan</span>
                                <span className="text-right">in design</span>
                                <span className="text-[var(--color-paper-dim)]">enterprise</span>
                                <span className="text-right">talk to us</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="mt-16 grid grid-cols-1 gap-px bg-[var(--color-paper-rule)] md:grid-cols-3">
                    <Plan
                        tag="AVAILABLE TODAY"
                        title="Self-hosted"
                        price="$0"
                        unit="forever"
                        body="The full product, on your hardware. All rooms, all tools, all integrations. You own the data, the keys, the audit log."
                        bullets={[
                            'Unlimited rooms',
                            'All built-in tools',
                            'MCP per room',
                            'Office + PDF workflows',
                            'Scheduled jobs',
                            'Honest usage telemetry',
                        ]}
                        cta={{
                            label: 'Run the stack',
                            href: 'https://github.com/parlali/agent_room',
                            external: true,
                        }}
                        emphasis
                    />
                    <Plan
                        tag="CLOSED ALPHA"
                        title="Hosted"
                        price="—"
                        unit="invite only"
                        body="The same product, managed for you. Backups, updates, multi-room workspace, SSO. Same architecture, none of the homelab."
                        bullets={[
                            'Managed Postgres & SearXNG',
                            'Snapshots and backups',
                            'Multi-operator workspace',
                            'SSO and SCIM',
                            'On-call support',
                            'Same code as OSS',
                        ]}
                        cta={{ label: 'Join the waitlist', href: 'mailto:hello@openagentroom.com' }}
                    />
                    <Plan
                        tag="WHEN YOU NEED IT"
                        title="Enterprise"
                        price="Custom"
                        unit="VPC or on-prem"
                        body="Single-tenant deploys, custom MCP suite, dedicated support, security review. For teams putting a coworker behind real infrastructure."
                        bullets={[
                            'Single-tenant VPC',
                            'On-prem option',
                            'Custom MCP bundle',
                            'Security & compliance review',
                            'Dedicated support',
                            'Roadmap input',
                        ]}
                        cta={{
                            label: 'Start a conversation',
                            href: 'mailto:hello@openagentroom.com',
                        }}
                    />
                </div>

                <div className="mt-10 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                    <p className="text-[13px] text-[var(--color-paper-dim)]">
                        Honest note: the hosted plan is real future product, not a placeholder.
                        Pricing is unannounced because we want to set it after the OSS surface is
                        solid.
                    </p>
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-paper-dim)]">
                        REVISION · MAY 2026 · SUBJECT TO CHANGE
                    </span>
                </div>
            </div>
        </section>
    )
}

type PlanProps = {
    tag: string
    title: string
    price: string
    unit: string
    body: string
    bullets: string[]
    cta: { label: string; href: string; external?: boolean }
    emphasis?: boolean
}

function Plan({ tag, title, price, unit, body, bullets, cta, emphasis }: PlanProps) {
    return (
        <div className={`relative bg-[var(--color-paper)] p-7 ${emphasis ? '' : ''}`}>
            <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-paper-dim)]">
                    {tag}
                </span>
                {emphasis ? (
                    <span className="rounded-full border border-[var(--color-paper-ink)] px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.18em]">
                        recommended
                    </span>
                ) : null}
            </div>

            <h3
                className="mt-5 font-serif text-[34px] leading-[1.05] tracking-[-0.02em]"
                style={{ fontVariationSettings: "'opsz' 96, 'SOFT' 30" }}
            >
                {title}
            </h3>

            <div className="mt-5 flex items-baseline gap-2">
                <span
                    className="font-serif text-[46px] leading-none tracking-[-0.02em]"
                    style={{ fontVariationSettings: "'opsz' 144, 'SOFT' 30" }}
                >
                    {price}
                </span>
                <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-paper-dim)]">
                    {unit}
                </span>
            </div>

            <p className="mt-5 text-[14.5px] leading-[1.55] text-[var(--color-paper-dim)]">
                {body}
            </p>

            <ul className="mt-6 space-y-2.5 border-t border-[var(--color-paper-rule)] pt-5">
                {bullets.map((b) => (
                    <li
                        key={b}
                        className="flex items-start gap-2.5 font-mono text-[12px] text-[var(--color-paper-ink)]"
                    >
                        <span className="mt-1.5 inline-block h-1 w-3 shrink-0 bg-[var(--color-paper-ink)]" />
                        <span>{b}</span>
                    </li>
                ))}
            </ul>

            <div className="mt-8">
                <MarqueeLink
                    href={cta.href}
                    external={cta.external}
                    className={`inline-flex items-center gap-2 border px-4 py-2.5 text-[13px] font-medium tracking-tight transition ${
                        emphasis
                            ? 'border-[var(--color-paper-ink)] bg-[var(--color-paper-ink)] text-[var(--color-paper)] hover:bg-transparent hover:text-[var(--color-paper-ink)]'
                            : 'border-[var(--color-paper-ink)] text-[var(--color-paper-ink)] hover:bg-[var(--color-paper-ink)] hover:text-[var(--color-paper)]'
                    }`}
                >
                    {cta.label} →
                </MarqueeLink>
            </div>
        </div>
    )
}
