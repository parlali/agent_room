import { assets } from '~/content/assets'
import { capabilities, featureGroups, problem, roomModel } from '~/content/features'
import { pricing } from '~/content/pricing'
import { securityPrinciples } from '~/content/security'
import { brand, githubCta, primaryCta, seo } from '~/content/site'
import { CtaBand } from '~/components/CtaBand'
import { Link } from '~/components/Link'
import { PageShell } from '~/components/PageShell'
import { ProductImage } from '~/components/ProductImage'
import { Container, CtaButton, Section, SectionHeading, StatusDot } from '~/components/primitives'

export function Home() {
    return (
        <PageShell meta={seo['/']}>
            <section className="relative overflow-hidden">
                <Container className="pt-14 pb-16 sm:pt-20 lg:pt-24">
                    <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
                        <div>
                            <p className="eyebrow mb-4 flex items-center gap-2">
                                <StatusDot tone="green" />
                                Hosted agent orchestration
                            </p>
                            <h1 className="text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-[3.4rem]">
                                {brand.tagline}
                            </h1>
                            <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-soft sm:text-lg">
                                {brand.description}
                            </p>
                            <div className="mt-8 flex flex-wrap gap-3">
                                <CtaButton cta={primaryCta} />
                                <CtaButton cta={githubCta} variant="ghost" />
                            </div>
                            <div className="mt-9 flex flex-wrap gap-2">
                                {capabilities.slice(0, 6).map((capability) => (
                                    <span key={capability.name} className="tag">
                                        {capability.name}
                                    </span>
                                ))}
                            </div>
                        </div>

                        <ProductImage
                            asset={assets.heroDesktop}
                            mobileAsset={assets.heroMobile}
                            label="agent-room / console"
                            priority
                        />
                    </div>
                </Container>
            </section>

            <Section>
                <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
                    <SectionHeading eyebrow={problem.eyebrow} title={problem.title} />
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="panel p-5">
                            <p className="eyebrow mb-3 flex items-center gap-2">
                                <StatusDot tone="red" />
                                {problem.monolith.label}
                            </p>
                            <ul className="flex flex-col gap-2.5">
                                {problem.monolith.points.map((point) => (
                                    <li
                                        key={point}
                                        className="text-sm leading-relaxed text-ink-soft"
                                    >
                                        {point}
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div className="panel border-line-strong p-5">
                            <p className="eyebrow mb-3 flex items-center gap-2">
                                <StatusDot tone="green" />
                                {problem.rooms.label}
                            </p>
                            <ul className="flex flex-col gap-2.5">
                                {problem.rooms.points.map((point) => (
                                    <li key={point} className="text-sm leading-relaxed text-ink">
                                        {point}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </div>
            </Section>

            <Section className="bg-paper-sunken">
                <SectionHeading
                    eyebrow={roomModel.eyebrow}
                    title={roomModel.title}
                    summary={roomModel.summary}
                />
                <div className="mt-10 grid items-start gap-10 lg:grid-cols-[1.1fr_1fr]">
                    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-line bg-line sm:grid-cols-4 lg:grid-cols-2">
                        {roomModel.facets.map((facet) => (
                            <div key={facet.name} className="bg-panel p-4">
                                <p className="font-mono text-[0.6875rem] uppercase tracking-wide text-ink-faint">
                                    {facet.name}
                                </p>
                                <p className="mt-1.5 text-sm leading-snug text-ink-soft">
                                    {facet.detail}
                                </p>
                            </div>
                        ))}
                    </div>
                    <ProductImage asset={assets.roomIsolation} label="room isolation" />
                </div>
            </Section>

            <Section>
                <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
                    <ProductImage
                        asset={assets.capabilities}
                        label="capabilities / artifacts"
                        className="order-2 lg:order-1"
                    />
                    <div className="order-1 lg:order-2">
                        <SectionHeading
                            eyebrow="Capability tour"
                            title="The tools a real coworker needs."
                            summary="Each room can be given exactly the capabilities its work requires, and nothing more."
                        />
                        <dl className="mt-8 grid gap-x-8 gap-y-5 sm:grid-cols-2">
                            {capabilities.map((capability) => (
                                <div key={capability.name}>
                                    <dt className="text-sm font-medium text-ink">
                                        {capability.name}
                                    </dt>
                                    <dd className="mt-0.5 text-sm leading-snug text-ink-soft">
                                        {capability.detail}
                                    </dd>
                                </div>
                            ))}
                        </dl>
                        <Link
                            href="/features"
                            className="mt-8 inline-flex text-sm font-medium text-accent-blue hover:underline"
                        >
                            Explore all features →
                        </Link>
                    </div>
                </div>
            </Section>

            <Section className="bg-paper-sunken">
                <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
                    <div>
                        <SectionHeading
                            eyebrow="Hosted trust story"
                            title="Source available, hosted operations, security-first."
                            summary="The repository stays open so you can read how isolation works. The hosted product runs the runtime, isolation, and credential handling for you."
                        />
                        <ul className="mt-8 flex flex-col divide-y divide-line border-y border-line">
                            {securityPrinciples.slice(0, 4).map((principle) => (
                                <li key={principle.id} className="py-4">
                                    <p className="text-sm font-medium text-ink">
                                        {principle.title}
                                    </p>
                                    <p className="mt-1 text-sm leading-relaxed text-ink-soft">
                                        {principle.summary}
                                    </p>
                                </li>
                            ))}
                        </ul>
                        <Link
                            href="/security"
                            className="mt-8 inline-flex text-sm font-medium text-accent-blue hover:underline"
                        >
                            Read the security model →
                        </Link>
                    </div>
                    <ProductImage asset={assets.securityRuntime} label="security / audit" />
                </div>
            </Section>

            <Section>
                <SectionHeading
                    eyebrow="Built around isolation"
                    title="Eight feature groups, one boundary."
                    summary="Everything in Agent Room is scoped to the room that owns it."
                />
                <div className="mt-10 grid gap-px overflow-hidden rounded-[10px] border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
                    {featureGroups.map((group) => (
                        <div key={group.id} className="bg-panel p-5">
                            <p className="eyebrow mb-2">{group.eyebrow}</p>
                            <p className="text-sm font-medium text-ink">{group.title}</p>
                            <p className="mt-2 text-sm leading-snug text-ink-soft">
                                {group.summary}
                            </p>
                        </div>
                    ))}
                </div>
            </Section>

            <Section className="bg-paper-sunken">
                <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
                    <div>
                        <SectionHeading
                            eyebrow={pricing.eyebrow}
                            title="Pricing is being finalized."
                            summary={pricing.summary}
                        />
                        <div className="mt-8 flex flex-wrap gap-3">
                            <CtaButton cta={primaryCta} />
                            <Link href="/pricing" className="btn btn-ghost">
                                See pricing direction
                            </Link>
                        </div>
                    </div>
                    <ProductImage asset={assets.pricingWaitlist} label="hosted / waitlist" />
                </div>
            </Section>

            <CtaBand />
        </PageShell>
    )
}
