import { assets } from '~/content/assets'
import { githubCta, githubUrl, primaryCta, seo } from '~/content/site'
import { CtaBand } from '~/components/CtaBand'
import { Link } from '~/components/Link'
import { PageShell } from '~/components/PageShell'
import { ProductImage } from '~/components/ProductImage'
import { CtaButton, Section, SectionHeading, StatusDot } from '~/components/primitives'

const resources = [
    {
        id: 'repository',
        eyebrow: 'Repository',
        title: 'Read the full source on GitHub',
        body: 'The orchestration runtime, room isolation, and credential handling are all in the open so you can review exactly how Agent Room works before you trust it.',
        href: githubUrl,
        external: true,
        cta: 'View GitHub',
    },
    {
        id: 'self-hosting',
        eyebrow: 'Self-hosting',
        title: 'Run the entire stack yourself, free',
        body: 'Clone the repository and operate Agent Room on your own infrastructure. The same isolation model and runtime that power the hosted product are available to you at no license cost.',
        href: githubUrl,
        external: true,
        cta: 'Self-host from source',
    },
    {
        id: 'disclosure',
        eyebrow: 'Security',
        title: 'Responsible disclosure',
        body: 'Found a vulnerability? Review the security model and reporting path before you dig into the code, so isolation and credential issues reach us responsibly.',
        href: '/security',
        external: false,
        cta: 'Read the security model',
    },
    {
        id: 'license',
        eyebrow: 'License',
        title: 'MIT licensed',
        body: 'Agent Room is released under the MIT License. Use, modify, and distribute the source with attribution and the standard no-warranty terms.',
        href: githubUrl,
        external: true,
        cta: 'Read the LICENSE',
    },
]

const operations = [
    {
        label: 'Self-hosted',
        tone: 'amber' as const,
        summary: 'You own every operational concern.',
        points: [
            'You provision and maintain the runtime that executes agent work.',
            'You enforce room isolation and filesystem boundaries on your own hosts.',
            'You store and rotate provider credentials and API keys.',
            'You ship updates, patches, and security fixes on your own schedule.',
        ],
    },
    {
        label: 'Hosted Agent Room',
        tone: 'green' as const,
        summary: 'We operate the platform so you do not have to.',
        points: [
            'We run and scale the orchestration runtime for every room.',
            'We maintain isolation and runtime boundaries between rooms.',
            'We handle credential storage, provider binding, and rotation.',
            'We deliver updates and security fixes continuously.',
        ],
    },
]

export function Source() {
    return (
        <PageShell meta={seo['/source']}>
            <Section>
                <SectionHeading
                    eyebrow="Source"
                    title="Open source you can read, hosted so you do not have to run it."
                    summary="Agent Room is source available on GitHub. Read how isolation, runtime, and credential handling actually work, and self-host the stack if you want to. For most teams the hosted product is the recommended path: it removes the operational work of running an orchestration platform safely."
                />
                <div className="mt-8 flex flex-wrap gap-3">
                    <CtaButton cta={primaryCta} />
                    <CtaButton cta={githubCta} variant="ghost" />
                </div>
            </Section>

            <Section className="bg-paper-sunken">
                <SectionHeading
                    eyebrow="What is open"
                    title="A trust anchor, not a do-it-yourself mandate."
                    summary="The code being open is a reason to trust the hosted product, not a requirement to operate it yourself."
                />
                <div className="mt-10 grid gap-px overflow-hidden rounded-[10px] border border-line bg-line sm:grid-cols-2">
                    {resources.map((resource) => (
                        <div key={resource.id} className="flex flex-col bg-panel p-5">
                            <p className="eyebrow mb-2">{resource.eyebrow}</p>
                            <p className="text-sm font-medium text-ink">{resource.title}</p>
                            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                                {resource.body}
                            </p>
                            <Link
                                href={resource.href}
                                external={resource.external}
                                className="mt-4 inline-flex text-sm font-medium text-accent-blue hover:underline"
                            >
                                {resource.cta} →
                            </Link>
                        </div>
                    ))}
                </div>
            </Section>

            <Section>
                <div className="grid items-start gap-10 lg:grid-cols-2 lg:gap-16">
                    <div>
                        <SectionHeading
                            eyebrow="Hosted vs self-hosted"
                            title="The code is the same. The operations are not."
                            summary="Self-hosting means you operate isolation, runtime, credentials, and updates. Hosted means Agent Room operates them for you, with the same source running underneath."
                        />
                        <div className="mt-8 grid gap-4 sm:grid-cols-2">
                            {operations.map((operation) => (
                                <div
                                    key={operation.label}
                                    className={`panel p-5 ${
                                        operation.tone === 'green' ? 'border-line-strong' : ''
                                    }`}
                                >
                                    <p className="eyebrow mb-2 flex items-center gap-2">
                                        <StatusDot tone={operation.tone} />
                                        {operation.label}
                                    </p>
                                    <p className="mb-3 text-sm font-medium text-ink">
                                        {operation.summary}
                                    </p>
                                    <ul className="flex flex-col gap-2.5">
                                        {operation.points.map((point) => (
                                            <li
                                                key={point}
                                                className="text-sm leading-relaxed text-ink-soft"
                                            >
                                                {point}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            ))}
                        </div>
                    </div>
                    <ProductImage asset={assets.roomIsolation} label="room isolation" />
                </div>
            </Section>

            <CtaBand />
        </PageShell>
    )
}
