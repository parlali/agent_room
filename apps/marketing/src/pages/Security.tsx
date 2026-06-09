import { assets } from '~/content/assets'
import { securityContact, securityIntro, securityPrinciples } from '~/content/security'
import { githubCta, githubUrl, primaryCta, seo } from '~/content/site'
import { CtaBand } from '~/components/CtaBand'
import { Link } from '~/components/Link'
import { PageShell } from '~/components/PageShell'
import { ProductImage } from '~/components/ProductImage'
import { Container, CtaButton, Section, SectionHeading, StatusDot } from '~/components/primitives'

export function Security() {
    return (
        <PageShell meta={seo['/security']}>
            <section className="relative overflow-hidden">
                <Container className="pt-14 pb-16 sm:pt-20 lg:pt-24">
                    <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
                        <div>
                            <p className="eyebrow mb-4 flex items-center gap-2">
                                <StatusDot tone="blue" />
                                {securityIntro.eyebrow}
                            </p>
                            <h1 className="text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-[3.4rem]">
                                {securityIntro.title}
                            </h1>
                            <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-soft sm:text-lg">
                                {securityIntro.summary}
                            </p>
                            <div className="mt-8 flex flex-wrap gap-3">
                                <CtaButton cta={primaryCta} />
                                <CtaButton cta={githubCta} variant="ghost" />
                            </div>
                        </div>

                        <ProductImage
                            asset={assets.securityRuntime}
                            label="security / audit"
                            priority
                        />
                    </div>
                </Container>
            </section>

            <Section>
                <SectionHeading
                    eyebrow="Designed boundaries"
                    title="Five boundaries every room runs inside."
                    summary="Isolation, credential safety, and auditability are the product surface, not optional add-ons. Each boundary below describes how a room is designed to behave."
                />
                <div className="mt-10 grid gap-px overflow-hidden rounded-[10px] border border-line bg-line lg:grid-cols-2">
                    {securityPrinciples.map((principle, index) => {
                        const lastOdd =
                            index === securityPrinciples.length - 1 &&
                            securityPrinciples.length % 2 === 1
                        return (
                            <div
                                key={principle.id}
                                className={`flex flex-col bg-panel p-6 ${lastOdd ? 'lg:col-span-2' : ''}`}
                            >
                                <p className="eyebrow mb-3 flex items-center gap-2">
                                    <StatusDot tone="green" />
                                    {principle.id}
                                </p>
                                <p className="text-base font-medium text-ink">{principle.title}</p>
                                <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                                    {principle.summary}
                                </p>
                                <ul className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
                                    {principle.points.map((point) => (
                                        <li
                                            key={point}
                                            className="flex items-start gap-2 text-sm leading-snug text-ink-soft"
                                        >
                                            <span
                                                className="mt-1.5 inline-block h-1 w-1 flex-none rounded-full bg-line-strong"
                                                aria-hidden
                                            />
                                            {point}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )
                    })}
                </div>
            </Section>

            <Section className="bg-paper-sunken">
                <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
                    <ProductImage
                        asset={assets.roomIsolation}
                        label="room isolation"
                        className="order-2 lg:order-1"
                    />
                    <div className="order-1 lg:order-2">
                        <SectionHeading
                            eyebrow={securityContact.title}
                            title="How to report a vulnerability."
                            summary={securityContact.body}
                        />
                        <div className="mt-8 flex flex-wrap gap-3">
                            <Link href={githubUrl} external className="btn btn-primary">
                                Open the disclosure process
                            </Link>
                        </div>
                        <p className="mt-8 max-w-xl rounded-[10px] border border-line bg-panel px-4 py-3 text-xs leading-relaxed text-ink-faint">
                            {securityContact.note}
                        </p>
                    </div>
                </div>
            </Section>

            <CtaBand />
        </PageShell>
    )
}
