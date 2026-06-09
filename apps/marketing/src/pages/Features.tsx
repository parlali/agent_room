import { assets } from '~/content/assets'
import { capabilities, featureGroups, roomModel } from '~/content/features'
import { githubCta, primaryCta, seo } from '~/content/site'
import { CtaBand } from '~/components/CtaBand'
import { Link } from '~/components/Link'
import { PageShell } from '~/components/PageShell'
import { ProductImage } from '~/components/ProductImage'
import { Container, CtaButton, Section, SectionHeading, StatusDot } from '~/components/primitives'

export function Features() {
    return (
        <PageShell meta={seo['/features']}>
            <section className="relative overflow-hidden">
                <Container className="pt-14 pb-16 sm:pt-20 lg:pt-24">
                    <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
                        <div>
                            <p className="eyebrow mb-4 flex items-center gap-2">
                                <StatusDot tone="blue" />
                                Features
                            </p>
                            <h1 className="text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">
                                A detailed map of what each room can do.
                            </h1>
                            <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-soft sm:text-lg">
                                Eight feature groups, every capability, and the room model that
                                keeps them isolated. Each capability is scoped to the room that owns
                                it and nothing else.
                            </p>
                            <div className="mt-8 flex flex-wrap gap-3">
                                <CtaButton cta={primaryCta} />
                                <CtaButton cta={githubCta} variant="ghost" />
                            </div>
                            <div className="mt-9 flex flex-wrap gap-2">
                                {featureGroups.map((group) => (
                                    <span key={group.id} className="tag">
                                        {group.eyebrow}
                                    </span>
                                ))}
                            </div>
                        </div>

                        <ProductImage
                            asset={assets.capabilities}
                            label="capabilities / artifacts"
                            priority
                        />
                    </div>
                </Container>
            </section>

            <Section>
                <SectionHeading
                    eyebrow="Feature groups"
                    title="Eight groups, one isolation boundary."
                    summary="Each group is scoped to the room that owns it. Nothing crosses the boundary unless you wire it on purpose."
                />
                <div className="mt-10 grid gap-px overflow-hidden rounded-[10px] border border-line bg-line sm:grid-cols-2">
                    {featureGroups.map((group) => (
                        <div key={group.id} className="bg-panel p-6">
                            <p className="eyebrow mb-2 flex items-center gap-2">
                                <StatusDot tone="blue" />
                                {group.eyebrow}
                            </p>
                            <p className="text-base font-medium text-ink">{group.title}</p>
                            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                                {group.summary}
                            </p>
                            <ul className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
                                {group.points.map((point) => (
                                    <li
                                        key={point}
                                        className="flex items-start gap-2.5 text-sm leading-snug text-ink-soft"
                                    >
                                        <span
                                            className="mt-1.5 font-mono text-[0.6875rem] text-ink-faint"
                                            aria-hidden
                                        >
                                            —
                                        </span>
                                        <span>{point}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
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
                <SectionHeading
                    eyebrow="Capability reference"
                    title="Every tool a room can be given."
                    summary="Enable only the capabilities a room needs for its line of work, and nothing more."
                />
                <dl className="mt-10 grid gap-x-10 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
                    {capabilities.map((capability) => (
                        <div key={capability.name} className="border-t border-line pt-4">
                            <dt className="text-sm font-medium text-ink">{capability.name}</dt>
                            <dd className="mt-1 text-sm leading-snug text-ink-soft">
                                {capability.detail}
                            </dd>
                        </div>
                    ))}
                </dl>
                <Link
                    href="/security"
                    className="mt-10 inline-flex text-sm font-medium text-accent-blue hover:underline"
                >
                    See how isolation is enforced →
                </Link>
            </Section>

            <CtaBand />
        </PageShell>
    )
}
