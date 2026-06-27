import {
    pricing,
    pricingFaq,
    pricingFeatureRows,
    pricingPlans,
    pricingTopup,
} from '~/content/pricing'
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
            <PageHero
                eyebrow={pricing.eyebrow}
                visual={
                    <div className="grid gap-4 lg:grid-cols-3">
                        {pricingPlans.map((plan) => (
                            <article
                                key={plan.key}
                                className={`card p-6 text-left ${plan.key === 'standard' ? 'border-accent-blue shadow-panel' : ''}`}
                            >
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <h2 className="text-xl font-semibold text-ink">
                                            {plan.name}
                                        </h2>
                                        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                                            {plan.summary}
                                        </p>
                                    </div>
                                    {plan.key === 'standard' ? (
                                        <span className="badge-pill shrink-0">Popular</span>
                                    ) : null}
                                </div>
                                <p className="mt-6 text-4xl font-semibold text-ink">
                                    {plan.monthly}
                                    <span className="ml-1 text-sm font-medium text-ink-faint">
                                        / month
                                    </span>
                                </p>
                                <p className="mt-2 text-sm font-medium text-ink-soft">
                                    {plan.includedUsage}
                                </p>
                                <ul className="mt-6 space-y-3 text-sm text-ink-soft">
                                    {plan.features.map((feature) => (
                                        <li key={feature} className="flex gap-3">
                                            <span
                                                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-green"
                                                aria-hidden
                                            />
                                            <span>{feature}</span>
                                        </li>
                                    ))}
                                </ul>
                            </article>
                        ))}
                    </div>
                }
            >
                <h1 className="type-display rise rise-1 text-balance text-ink">{pricing.title}</h1>
                <p className="type-body rise rise-2 mt-6 max-w-2xl text-pretty text-ink-soft sm:text-lg">
                    {pricing.summary}
                </p>
            </PageHero>

            <Section>
                <SectionHeading
                    eyebrow="Credits"
                    title="Usage draws from your included amount first."
                    summary="Managed usage is tracked per room. Purchased credits persist and are spent after your included monthly usage is used."
                />
                <div className="surface-raised mx-auto mt-12 grid max-w-3xl gap-5 p-6 sm:grid-cols-[1fr_auto] sm:items-center">
                    <div>
                        <p className="text-lg font-semibold text-ink">{pricingTopup.label}</p>
                        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                            {pricingTopup.credit} for managed AI, web search, page reading, and
                            live browsing.
                        </p>
                    </div>
                    <p className="text-3xl font-semibold text-ink">{pricingTopup.price}</p>
                </div>
            </Section>

            <Section className="border-t border-line bg-paper-sunken">
                <SectionHeading
                    eyebrow="Feature table"
                    title="Live web browsing is a Pro feature."
                    summary="Every plan lets you bring your own keys. Managed usage runs on Agent Room credits and keeps platform credentials out of your rooms."
                />
                <div className="mt-12 space-y-4 md:hidden">
                    {pricingFeatureRows.map((row) => (
                        <article key={row.label} className="surface-raised p-5 text-left">
                            <h3 className="text-sm font-semibold text-ink">{row.label}</h3>
                            <dl className="mt-4 grid gap-3 text-sm">
                                {pricingPlans.map((plan) => (
                                    <div
                                        key={plan.key}
                                        className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-3 border-t border-line pt-3 first:border-t-0 first:pt-0"
                                    >
                                        <dt className="font-medium text-ink-soft">{plan.name}</dt>
                                        <dd className="text-ink">{row.values[plan.key]}</dd>
                                    </div>
                                ))}
                            </dl>
                        </article>
                    ))}
                </div>
                <div className="mt-12 hidden overflow-x-auto md:block">
                    <table className="w-full min-w-[760px] border-separate border-spacing-0 overflow-hidden rounded-panel border border-line bg-panel text-left text-sm shadow-panel">
                        <thead>
                            <tr>
                                <th
                                    scope="col"
                                    className="border-b border-line bg-paper-sunken px-5 py-4 font-medium text-ink-soft"
                                >
                                    Feature
                                </th>
                                {pricingPlans.map((plan) => (
                                    <th
                                        key={plan.key}
                                        scope="col"
                                        className="border-b border-line bg-paper-sunken px-5 py-4 font-semibold text-ink"
                                    >
                                        {plan.name}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {pricingFeatureRows.map((row) => (
                                <tr key={row.label}>
                                    <th
                                        scope="row"
                                        className="border-b border-line px-5 py-4 text-left font-medium text-ink"
                                    >
                                        {row.label}
                                    </th>
                                    {pricingPlans.map((plan) => (
                                        <td
                                            key={plan.key}
                                            className="border-b border-line px-5 py-4 text-ink-soft"
                                        >
                                            {row.values[plan.key]}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Section>

            <Section className="border-t border-line">
                <SectionHeading
                    eyebrow="Access"
                    title="Need hosted access?"
                    summary="Tell us what you plan to run and whether you expect to use managed provider credits or your own keys."
                />
                <div className="rise rise-3 mx-auto mt-12 w-full max-w-lg text-left">
                    <WaitlistForm />
                </div>
            </Section>

            <Section className="border-t border-line">
                <SectionHeading
                    eyebrow="FAQ"
                    title="Pricing and hosting questions."
                    summary="Plan behavior, managed usage, and self-hosted differences."
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
