import { assets } from '~/content/assets'
import { capabilities, featureGroups, roomModel } from '~/content/features'
import { pageCtaBands, seo } from '~/content/site'
import { CtaBand } from '~/components/CtaBand'
import { PageHero } from '~/components/PageHero'
import { PageShell } from '~/components/PageShell'
import { ProductImage } from '~/components/ProductImage'
import { ArrowLink, Section, SectionHeading } from '~/components/primitives'

export function Features() {
    const ctaBand = pageCtaBands.features

    return (
        <PageShell meta={seo['/features']}>
            <PageHero eyebrow="Features">
                <h1 className="type-display rise rise-1 text-balance text-ink">
                    What a room can do.
                </h1>
                <p className="type-body rise rise-2 mt-6 max-w-2xl text-pretty text-ink-soft sm:text-lg">
                    A room is not a chatbot with settings. It is a complete coworker, fenced to one
                    job.
                </p>
            </PageHero>

            <Section>
                <div className="mx-auto max-w-3xl">
                    {featureGroups.map((group) => (
                        <article
                            key={group.id}
                            className="grid gap-3 border-t border-line py-10 first:border-t-0 first:pt-0 sm:grid-cols-[9rem_1fr] sm:gap-10"
                        >
                            <p className="eyebrow pt-2">{group.eyebrow}</p>
                            <div>
                                <h2 className="type-title text-balance text-ink">{group.title}</h2>
                                <p className="mt-3 max-w-xl text-pretty leading-relaxed text-ink-soft">
                                    {group.summary}
                                </p>
                            </div>
                        </article>
                    ))}
                </div>
            </Section>

            <Section className="border-t border-line bg-paper-sunken">
                <SectionHeading
                    eyebrow={roomModel.eyebrow}
                    title={roomModel.title}
                    summary={roomModel.summary}
                />
                <div className="mx-auto mt-12 max-w-4xl">
                    <ProductImage asset={assets.capabilitiesDashboard} className="shadow-panel" />
                </div>
                <div className="mx-auto mt-10 flex max-w-3xl flex-wrap items-center justify-center gap-2">
                    <span className="eyebrow mr-2">Owns</span>
                    {roomModel.facets.map((facet) => (
                        <span key={facet} className="tag">
                            {facet}
                        </span>
                    ))}
                </div>
                <div className="mx-auto mt-4 flex max-w-3xl flex-wrap items-center justify-center gap-2">
                    <span className="eyebrow mr-2">Can be granted</span>
                    {capabilities.map((capability) => (
                        <span key={capability} className="tag">
                            {capability}
                        </span>
                    ))}
                </div>
                <div className="mt-12 flex justify-center">
                    <ArrowLink href="/security">See how the walls are enforced</ArrowLink>
                </div>
            </Section>

            <CtaBand title={ctaBand.title} body={ctaBand.body} primary={ctaBand.primary} />
        </PageShell>
    )
}
