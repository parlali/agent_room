import { assets } from '~/content/assets'
import {
    securityContact,
    securityHosted,
    securityIntro,
    securityLog,
    securityWalls,
} from '~/content/security'
import { disclosureCta, pageCtaBands, seo } from '~/content/site'
import { CtaBand } from '~/components/CtaBand'
import { PageHero } from '~/components/PageHero'
import { PageShell } from '~/components/PageShell'
import { ProductImage } from '~/components/ProductImage'
import { CtaButton, Section, SectionHeading, StatusDot } from '~/components/primitives'

function AccessLog() {
    return (
        <div className="surface-raised overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
                <p className="font-mono text-[0.625rem] font-medium uppercase tracking-[0.12em] text-ink-faint">
                    Access log
                </p>
                <span className="flex items-center gap-1.5 font-mono text-[0.625rem] font-medium uppercase tracking-[0.08em] text-accent-green">
                    <StatusDot tone="green" />
                    live
                </span>
            </div>
            <div className="flex flex-col gap-0.5 bg-paper-sunken/50 p-2.5">
                {securityLog.map((entry) => (
                    <div
                        key={`${entry.room}-${entry.action}-${entry.target}`}
                        className="flex items-center gap-3 rounded-md bg-panel px-3.5 py-2.5 font-mono text-xs"
                    >
                        <StatusDot tone={entry.allowed ? 'green' : 'red'} />
                        <span className="text-ink">{entry.room}</span>
                        <span className="text-ink-faint">{entry.action}</span>
                        <span className="flex-1 truncate text-ink-soft">{entry.target}</span>
                        <span
                            className={`font-medium uppercase tracking-[0.08em] ${
                                entry.allowed ? 'text-accent-green' : 'text-accent-red'
                            }`}
                        >
                            {entry.allowed ? 'ok' : 'denied'}
                        </span>
                    </div>
                ))}
            </div>
            <p className="border-t border-line px-5 py-3 text-center font-mono text-[0.625rem] font-medium uppercase tracking-[0.12em] text-ink-faint">
                Cross-room access fails closed
            </p>
        </div>
    )
}

export function Security() {
    const ctaBand = pageCtaBands.security

    return (
        <PageShell meta={seo['/security']}>
            <PageHero eyebrow={securityIntro.eyebrow}>
                <h1 className="type-display rise rise-1 text-balance text-ink">
                    {securityIntro.title}
                </h1>
                <p className="type-body rise rise-2 mt-6 max-w-2xl text-pretty text-ink-soft sm:text-lg">
                    {securityIntro.summary}
                </p>
            </PageHero>

            <Section>
                <div className="grid items-center gap-12 lg:grid-cols-2">
                    <div>
                        <SectionHeading
                            eyebrow="The walls"
                            title="The walls are the product."
                            summary="Three boundaries decide what a room can reach. Everything else follows from them."
                            align="left"
                        />
                        <ol className="mt-10 flex flex-col gap-8">
                            {securityWalls.map((wall, index) => (
                                <li key={wall.id}>
                                    <p className="step-num">
                                        {String(index + 1).padStart(2, '0')}
                                    </p>
                                    <h3 className="mt-2 text-base font-medium text-ink">
                                        {wall.title}
                                    </h3>
                                    <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
                                        {wall.summary}
                                    </p>
                                </li>
                            ))}
                        </ol>
                    </div>
                    <AccessLog />
                </div>
            </Section>

            <Section className="border-t border-line bg-paper-sunken">
                <SectionHeading
                    eyebrow="Audit"
                    title="Every room keeps receipts."
                    summary="Tool calls, runs, and spend are recorded per room. What it did while you were gone always has an exact answer."
                />
                <div className="mx-auto mt-12 max-w-4xl">
                    <ProductImage asset={assets.securityAudit} className="shadow-panel" />
                </div>
            </Section>

            <Section className="border-t border-line">
                <div className="mx-auto grid max-w-4xl gap-12 md:grid-cols-2">
                    <div>
                        <p className="eyebrow mb-3">Hosted</p>
                        <h2 className="text-lg font-medium tracking-tight text-ink">
                            {securityHosted.title}
                        </h2>
                        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                            {securityHosted.body}
                        </p>
                    </div>
                    <div>
                        <p className="eyebrow mb-3">Disclosure</p>
                        <h2 className="text-lg font-medium tracking-tight text-ink">
                            {securityContact.title}
                        </h2>
                        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                            {securityContact.body}
                        </p>
                        <CtaButton cta={disclosureCta} className="mt-6" />
                    </div>
                </div>
                <p className="mx-auto mt-14 max-w-2xl text-center text-xs leading-relaxed text-ink-faint">
                    {securityContact.note}
                </p>
            </Section>

            <CtaBand title={ctaBand.title} body={ctaBand.body} primary={ctaBand.primary} />
        </PageShell>
    )
}
