import type { Comparison } from '~/content/types'
import { githubCta, githubUrl, pageCtaBands, primaryCta, seo } from '~/content/site'
import { ComparisonPanel } from '~/components/ComparisonPanel'
import { CtaBand } from '~/components/CtaBand'
import { PageHero } from '~/components/PageHero'
import { PageShell } from '~/components/PageShell'
import { ArrowLink, CtaButton, Section, SectionHeading } from '~/components/primitives'

const resources = [
    {
        id: 'self-hosting',
        label: 'Self-hosting',
        title: 'Run the entire stack yourself, free',
        body: 'Clone the repository and run Agent Room on your own machines. It is the same isolation model and runtime that power the hosted product, at no license cost.',
        href: githubUrl,
        external: true,
        cta: 'Self-host from source',
    },
    {
        id: 'disclosure',
        label: 'Security',
        title: 'Responsible disclosure',
        body: 'Found a vulnerability? Review the security model and the private reporting path so isolation and credential issues reach us before they reach anyone else.',
        href: '/security',
        external: false,
        cta: 'Read the security model',
    },
    {
        id: 'license',
        label: 'License',
        title: 'MIT licensed',
        body: 'Agent Room is released under the MIT License. Use, modify, and distribute the source with attribution and the standard no-warranty terms.',
        href: githubUrl,
        external: true,
        cta: 'Read the LICENSE',
    },
]

const operationsComparison: Comparison = {
    columns: [
        { label: 'Self-hosted', tone: 'amber' },
        { label: 'Hosted Agent Room', tone: 'green' },
    ],
    rows: [
        {
            label: 'Runtime',
            cells: [
                'You provision and maintain the runtime that executes agent work.',
                'We run and scale the orchestration runtime for every room.',
            ],
        },
        {
            label: 'Isolation',
            cells: [
                'You enforce room isolation and filesystem boundaries on your own hosts.',
                'We maintain isolation and runtime boundaries between rooms.',
            ],
        },
        {
            label: 'Credentials',
            cells: [
                'You store and rotate provider credentials and API keys.',
                'We handle credential storage, provider binding, and rotation.',
            ],
        },
        {
            label: 'Updates',
            cells: [
                'You ship updates, patches, and security fixes on your own schedule.',
                'We deliver updates and security fixes continuously.',
            ],
        },
    ],
}

export function Source() {
    const ctaBand = pageCtaBands.source

    return (
        <PageShell meta={seo['/source']}>
            <PageHero eyebrow="Open source">
                <h1 className="type-display rise rise-1 text-balance text-ink">
                    Read the code. Skip the operations.
                </h1>
                <p className="type-body rise rise-2 mt-6 max-w-2xl text-pretty text-ink-soft sm:text-lg">
                    Agent Room is open source on GitHub. Read exactly how the walls are built,
                    self-host the whole stack for free, or let the hosted product run it for you.
                </p>
                <div className="rise rise-3 mt-9 flex flex-wrap justify-center gap-3">
                    <CtaButton cta={githubCta} size="lg" />
                    <CtaButton cta={primaryCta} variant="ghost" size="lg" />
                </div>
            </PageHero>

            <Section>
                <SectionHeading
                    eyebrow="Trust anchor"
                    title="Software that holds your keys should show its code."
                    summary="Read the implementation before you trust it, and keep self-hosting as your exit at all times."
                />
                <div className="mt-12 grid gap-5 md:grid-cols-3">
                    {resources.map((resource) => (
                        <article key={resource.id} className="card card-hover flex flex-col p-7">
                            <p className="eyebrow mb-3">{resource.label}</p>
                            <h3 className="text-base font-medium text-ink">{resource.title}</h3>
                            <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-soft">
                                {resource.body}
                            </p>
                            <ArrowLink
                                href={resource.href}
                                external={resource.external}
                                className="mt-5"
                            >
                                {resource.cta}
                            </ArrowLink>
                        </article>
                    ))}
                </div>
            </Section>

            <Section className="border-t border-line bg-paper-sunken">
                <SectionHeading
                    eyebrow="Hosted vs self-hosted"
                    title="The code is the same. The operations are not."
                    summary="Self-hosting means you operate isolation, runtime, credentials, and updates. Hosted means Agent Room operates them for you."
                />
                <div className="mx-auto mt-12 max-w-5xl">
                    <ComparisonPanel comparison={operationsComparison} />
                </div>
            </Section>

            <CtaBand title={ctaBand.title} body={ctaBand.body} primary={ctaBand.primary} />
        </PageShell>
    )
}
