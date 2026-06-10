import { pricing, pricingFaq } from '~/content/pricing'
import { seo } from '~/content/site'
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from '~/components/ui/accordion'
import { PageHero } from '~/components/PageHero'
import { PageShell } from '~/components/PageShell'
import { WaitlistForm } from '~/components/WaitlistForm'
import { Section, SectionHeading } from '~/components/primitives'

export function Pricing() {
    return (
        <PageShell meta={seo['/pricing']}>
            <PageHero eyebrow={pricing.eyebrow}>
                <h1 className="type-display rise rise-1 text-balance text-ink">{pricing.title}</h1>
                <p className="type-body rise rise-2 mt-6 max-w-2xl text-pretty text-ink-soft sm:text-lg">
                    {pricing.summary}
                </p>
                <div className="rise rise-3 mt-12 w-full max-w-lg text-left">
                    <WaitlistForm />
                </div>
            </PageHero>

            <Section>
                <SectionHeading
                    eyebrow="Billing direction"
                    title={pricing.philosophy.title}
                    summary={pricing.philosophy.note}
                />
                <div className="mx-auto mt-12 grid max-w-4xl gap-5 sm:grid-cols-2">
                    {pricing.philosophy.points.map((point, index) => (
                        <div key={point} className="card card-hover p-6">
                            <p className="step-num">{String(index + 1).padStart(2, '0')}</p>
                            <p className="mt-3 text-sm leading-relaxed text-ink-soft">{point}</p>
                        </div>
                    ))}
                </div>
            </Section>

            <Section className="border-t border-line">
                <SectionHeading
                    eyebrow="FAQ"
                    title="Pricing and hosting questions."
                    summary="What we can answer today, and what the waitlist helps us decide."
                />
                <div className="mx-auto mt-12 max-w-2xl">
                    <div className="surface-raised overflow-hidden">
                        <Accordion type="single" collapsible>
                            {pricingFaq.map((item) => (
                                <AccordionItem key={item.question} value={item.question}>
                                    <AccordionTrigger>{item.question}</AccordionTrigger>
                                    <AccordionContent>{item.answer}</AccordionContent>
                                </AccordionItem>
                            ))}
                        </Accordion>
                    </div>
                </div>
            </Section>
        </PageShell>
    )
}
