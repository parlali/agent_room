import { problem, problemComparison } from '~/content/features'
import {
    homeFounderNote,
    homeHero,
    homeIsolation,
    homeIsolationClaims,
    homeIsolationRooms,
    homeSteps,
} from '~/content/home'
import { pricingCta, primaryCta, readSourceCta, seo } from '~/content/site'
import { ComparisonPanel } from '~/components/ComparisonPanel'
import { CtaBand } from '~/components/CtaBand'
import { PageHero } from '~/components/PageHero'
import { PageShell } from '~/components/PageShell'
import { DesktopMockup, PhoneMockup } from '~/components/ProductMockup'
import { ArrowLink, CtaButton, Section, SectionHeading, StatusDot } from '~/components/primitives'

function IsolationDiagram() {
    return (
        <div className="surface-raised overflow-hidden">
            <div className="flex items-center gap-1.5 border-b border-line px-5 py-3.5">
                <span className="h-2 w-2 rounded-full bg-line-strong" aria-hidden />
                <span className="h-2 w-2 rounded-full bg-line-strong" aria-hidden />
                <span className="h-2 w-2 rounded-full bg-line-strong" aria-hidden />
                <p className="ml-3 font-mono text-[0.625rem] font-medium uppercase tracking-[0.12em] text-ink-faint">
                    Agent Room workspace
                </p>
            </div>
            <div className="grid gap-3 bg-paper-sunken/50 p-4 sm:grid-cols-2 sm:p-5">
                {homeIsolationRooms.map((room) => (
                    <div key={room.name} className="rounded-[10px] border border-line bg-panel p-4">
                        <p className="flex items-center justify-between gap-3">
                            <span className="font-mono text-xs font-medium text-ink">
                                {room.name}
                            </span>
                            <span className="flex items-center gap-1.5 font-mono text-[0.625rem] font-medium uppercase tracking-[0.08em] text-accent-green">
                                <StatusDot tone="green" />
                                running
                            </span>
                        </p>
                        <p className="mt-1 text-xs text-ink-faint">{room.job}</p>
                        <div className="mt-3.5 flex flex-wrap gap-1.5">
                            {room.tools.map((tool) => (
                                <span
                                    key={tool}
                                    className="rounded-md border border-line bg-paper px-2 py-0.5 font-mono text-[0.625rem] text-ink-soft"
                                >
                                    {tool}
                                </span>
                            ))}
                        </div>
                    </div>
                ))}
                <div className="flex min-h-28 flex-col items-center justify-center rounded-[10px] border border-dashed border-line-strong p-4 text-center">
                    <p className="font-mono text-xs font-medium text-ink-soft">+ Open a room</p>
                    <p className="mt-1 text-xs text-ink-faint">New work gets a new boundary.</p>
                </div>
            </div>
            <p className="border-t border-line px-5 py-3 text-center font-mono text-[0.625rem] font-medium uppercase tracking-[0.12em] text-ink-faint">
                No shared memory. No shared files. No shared credentials.
            </p>
        </div>
    )
}

export function Home() {
    return (
        <PageShell meta={seo['/']}>
            <PageHero
                visual={
                    <>
                        <div className="hidden sm:block">
                            <DesktopMockup />
                        </div>
                        <div className="mx-auto max-w-[300px] sm:hidden">
                            <PhoneMockup />
                        </div>
                    </>
                }
            >
                <h1 className="type-display rise rise-1 text-balance text-ink">{homeHero.title}</h1>
                <p className="type-body rise rise-2 mt-6 max-w-2xl text-pretty text-ink-soft sm:text-lg">
                    {homeHero.summary}
                </p>
                <div className="rise rise-3 mt-9 flex flex-wrap items-center justify-center gap-3">
                    <CtaButton cta={primaryCta} size="lg" />
                    <CtaButton cta={pricingCta} variant="ghost" size="lg" />
                </div>
            </PageHero>

            <Section>
                <SectionHeading
                    eyebrow={problem.eyebrow}
                    title={problem.title}
                    summary={problem.summary}
                />
                <div className="mx-auto mt-12 max-w-5xl">
                    <ComparisonPanel comparison={problemComparison} />
                </div>
                <p className="type-title mx-auto mt-14 max-w-2xl text-balance text-center text-ink">
                    {problem.resolution}
                </p>
            </Section>

            <Section className="border-t border-line bg-paper-sunken">
                <SectionHeading
                    eyebrow={homeSteps.eyebrow}
                    title={homeSteps.title}
                    summary={homeSteps.summary}
                />
                <ol className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                    {homeSteps.items.map((step) => (
                        <li key={step.number} className="card card-hover p-6">
                            <p className="step-num">{step.number}</p>
                            <h3 className="mt-3 text-base font-medium text-ink">{step.title}</h3>
                            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                                {step.detail}
                            </p>
                        </li>
                    ))}
                </ol>
                <div className="mt-12 flex justify-center">
                    <ArrowLink href="/features">See everything a room can do</ArrowLink>
                </div>
            </Section>

            <Section className="border-t border-line bg-paper-sunken">
                <div className="grid items-center gap-12 lg:grid-cols-2">
                    <div>
                        <SectionHeading
                            eyebrow={homeIsolation.eyebrow}
                            title={homeIsolation.title}
                            summary={homeIsolation.summary}
                            align="left"
                        />
                        <ul className="mt-8">
                            {homeIsolationClaims.map((claim) => (
                                <li
                                    key={claim}
                                    className="border-t border-line py-4 text-base font-medium text-ink first:border-t-0 first:pt-0"
                                >
                                    {claim}
                                </li>
                            ))}
                        </ul>
                        <ArrowLink href="/security" className="mt-6">
                            See what a room cannot do
                        </ArrowLink>
                    </div>
                    <IsolationDiagram />
                </div>
            </Section>

            <CtaBand
                title="Trust the code, not the marketing."
                body={homeFounderNote.text}
                primary={readSourceCta}
            />
        </PageShell>
    )
}
