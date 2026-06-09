import { pricing, pricingFaq } from '~/content/pricing'
import { githubUrl, seo } from '~/content/site'
import { CtaBand } from '~/components/CtaBand'
import { Faq } from '~/components/Faq'
import { Link } from '~/components/Link'
import { PageShell } from '~/components/PageShell'
import { WaitlistForm } from '~/components/WaitlistForm'
import { Container, Section, SectionHeading, StatusDot } from '~/components/primitives'

export function Pricing() {
    return (
        <PageShell meta={seo['/pricing']}>
            <section className="relative overflow-hidden">
                <Container className="pt-14 pb-16 sm:pt-20 lg:pt-24">
                    <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
                        <div>
                            <p className="eyebrow mb-4 flex items-center gap-2">
                                <StatusDot tone="amber" />
                                {pricing.eyebrow}
                            </p>
                            <h1 className="text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-[3.4rem]">
                                {pricing.title}
                            </h1>
                            <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-soft sm:text-lg">
                                {pricing.summary}
                            </p>
                        </div>

                        <WaitlistForm />
                    </div>
                </Container>
            </section>

            <Section className="bg-paper-sunken">
                <SectionHeading eyebrow="Direction" title={pricing.philosophy.title} />
                <ul className="mt-8 flex flex-col divide-y divide-line border-y border-line">
                    {pricing.philosophy.points.map((point) => (
                        <li
                            key={point}
                            className="flex items-start gap-3 py-4 text-sm leading-relaxed text-ink-soft"
                        >
                            <span className="mt-2">
                                <StatusDot tone="blue" />
                            </span>
                            {point}
                        </li>
                    ))}
                </ul>
                <p className="mt-6 max-w-2xl text-xs leading-relaxed text-ink-faint">
                    {pricing.philosophy.note}
                </p>
            </Section>

            <Section>
                <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
                    <SectionHeading
                        eyebrow="Self-hosted"
                        title={pricing.sourceNote.title}
                        summary={pricing.sourceNote.body}
                    />
                    <div className="flex items-start">
                        <Link href={githubUrl} external className="btn btn-ghost">
                            View source on GitHub →
                        </Link>
                    </div>
                </div>
            </Section>

            <Section className="bg-paper-sunken">
                <SectionHeading
                    eyebrow="Questions"
                    title="Pricing and hosting questions."
                    summary="What we can answer today, and what the waitlist helps us decide."
                />
                <div className="mt-10">
                    <Faq items={pricingFaq} />
                </div>
            </Section>

            <CtaBand
                title="Join the hosted waitlist."
                body="Pricing is being finalized. Add your details and we will reach out as hosted spots open."
            />
        </PageShell>
    )
}
