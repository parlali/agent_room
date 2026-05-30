import { SectionLabel } from '../components/SectionLabel'
import { TextLink } from '../components/TextLink'

export function Pricing() {
    return (
        <section
            id="pricing"
            className="relative border-t border-[var(--color-rule)] bg-[var(--color-night)] py-24 sm:py-32"
        >
            <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-10">
                <SectionLabel>Pricing and status</SectionLabel>

                <div className="mt-12 grid-12">
                    <div className="col-span-12 lg:col-span-7">
                        <h2 className="text-[38px] font-semibold leading-[1.08] sm:text-[52px] lg:text-[64px]">
                            Free to self-host. Hosted options are still in alpha.
                        </h2>
                        <p className="mt-8 max-w-xl text-[16.5px] leading-[1.6] text-[var(--color-ink-dim)] sm:text-[17.5px]">
                            Agent Room is open source today. Run it on a laptop, local server, or
                            VPS without accounts, telemetry, or per-seat pricing. A managed hosted
                            plan is being designed for teams that want the same architecture without
                            maintaining the infrastructure.
                        </p>
                    </div>
                    <div className="col-span-12 mt-10 lg:col-span-4 lg:col-start-9 lg:mt-0">
                        <div className="border border-[var(--color-rule)] bg-[var(--color-night-elev)] p-5">
                            <div className="label-mono text-[var(--color-ink)]">
                                Current OSS status
                            </div>
                            <div className="mt-4 grid grid-cols-2 gap-2 font-mono text-[11.5px] text-[var(--color-ink)]">
                                <span className="text-[var(--color-ink-dim)]">Build</span>
                                <span className="text-right">0.9 alpha</span>
                                <span className="text-[var(--color-ink-dim)]">License</span>
                                <span className="text-right">MIT</span>
                                <span className="text-[var(--color-ink-dim)]">Self-hosted</span>
                                <span className="text-right">available now</span>
                                <span className="text-[var(--color-ink-dim)]">Hosted</span>
                                <span className="text-right">closed alpha</span>
                                <span className="text-[var(--color-ink-dim)]">Enterprise</span>
                                <span className="text-right">contact</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="mt-16 grid grid-cols-1 gap-px bg-[var(--color-rule)] md:grid-cols-3">
                    <Plan
                        tag="Available today"
                        title="Self-hosted"
                        price="$0"
                        unit="forever"
                        body="The full product runs on your hardware. You own the rooms, files, keys, provider bindings, and audit logs."
                        bullets={[
                            'Unlimited rooms',
                            'All built-in tools',
                            'MCP per room',
                            'Office and PDF workflows',
                            'Scheduled jobs',
                            'Usage and cost ledger',
                        ]}
                        cta={{
                            label: 'Run the stack',
                            href: 'https://github.com/parlali/agent_room',
                            external: true,
                        }}
                        emphasis
                    />
                    <Plan
                        tag="Closed alpha"
                        title="Hosted"
                        price="TBD"
                        unit="invite only"
                        body="Managed Agent Room for teams that want backups, updates, shared workspaces, and SSO without operating the stack."
                        bullets={[
                            'Managed Postgres and SearXNG',
                            'Snapshots and backups',
                            'Multi-operator workspace',
                            'SSO and SCIM',
                            'Support coverage',
                            'Same codebase as OSS',
                        ]}
                        cta={{ label: 'Join the waitlist', href: 'mailto:hello@openagentroom.com' }}
                    />
                    <Plan
                        tag="Private infrastructure"
                        title="Enterprise"
                        price="Custom"
                        unit="VPC or on-prem"
                        body="Single-tenant deployments, custom MCP suites, security review, and dedicated support for teams with stricter controls."
                        bullets={[
                            'Single-tenant VPC',
                            'On-prem option',
                            'Custom MCP bundle',
                            'Security and compliance review',
                            'Dedicated support',
                            'Roadmap input',
                        ]}
                        cta={{
                            label: 'Start a conversation',
                            href: 'mailto:hello@openagentroom.com',
                        }}
                    />
                </div>

                <p className="mt-10 max-w-3xl text-[13px] leading-[1.6] text-[var(--color-ink-dim)]">
                    Hosted pricing is not announced yet. The self-hosted project is the current
                    product surface and will remain available under the MIT license.
                </p>
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
        <div className="relative bg-[var(--color-night-elev)] p-7">
            <div className="flex items-center justify-between gap-4">
                <span className="label-mono">{tag}</span>
                {emphasis ? (
                    <span className="rounded-full border border-[var(--color-rule-bright)] px-2 py-0.5 font-mono text-[9.5px] uppercase text-[var(--color-ink)]">
                        Recommended
                    </span>
                ) : null}
            </div>

            <h3 className="mt-5 text-[30px] font-semibold leading-[1.1] text-[var(--color-ink)]">
                {title}
            </h3>

            <div className="mt-5 flex items-baseline gap-2">
                <span className="text-[42px] font-semibold leading-none text-[var(--color-ink)]">
                    {price}
                </span>
                <span className="font-mono text-[11px] uppercase text-[var(--color-ink-dim)]">
                    {unit}
                </span>
            </div>

            <p className="mt-5 text-[14.5px] leading-[1.55] text-[var(--color-ink-dim)]">{body}</p>

            <ul className="mt-6 space-y-2.5 border-t border-[var(--color-rule)] pt-5">
                {bullets.map((b) => (
                    <li
                        key={b}
                        className="flex items-start gap-2.5 font-mono text-[12px] text-[var(--color-ink)]"
                    >
                        <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 bg-[var(--color-accent)]" />
                        <span>{b}</span>
                    </li>
                ))}
            </ul>

            <div className="mt-8">
                <TextLink
                    href={cta.href}
                    external={cta.external}
                    className={`px-4 py-2.5 text-[13px] font-medium ${
                        emphasis ? 'cta-fill' : 'cta-outline'
                    }`}
                >
                    {cta.label}
                </TextLink>
            </div>
        </div>
    )
}
