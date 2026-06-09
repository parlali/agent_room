import type { LegalDocument, SeoMeta } from '~/content/types'
import { CtaBand } from '~/components/CtaBand'
import { PageShell } from '~/components/PageShell'
import { Container } from '~/components/primitives'

export function LegalPage({ meta, document }: { meta: SeoMeta; document: LegalDocument }) {
    return (
        <PageShell meta={meta}>
            <Container className="py-16 sm:py-20">
                <div className="max-w-3xl">
                    <p className="eyebrow mb-3">Legal</p>
                    <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                        {document.title}
                    </h1>
                    <p className="mt-4 text-base leading-relaxed text-ink-soft">
                        {document.summary}
                    </p>
                    <p className="mt-3 font-mono text-xs text-ink-faint">
                        Last updated {document.updated}
                    </p>

                    <div className="mt-12 flex flex-col gap-10">
                        {document.sections.map((section) => (
                            <section key={section.heading}>
                                <h2 className="text-lg font-semibold tracking-tight text-ink">
                                    {section.heading}
                                </h2>
                                <div className="mt-3 flex flex-col gap-3">
                                    {section.body.map((paragraph, index) => (
                                        <p
                                            key={index}
                                            className="text-sm leading-relaxed text-ink-soft"
                                        >
                                            {paragraph}
                                        </p>
                                    ))}
                                </div>
                            </section>
                        ))}
                    </div>
                </div>
            </Container>
            <CtaBand />
        </PageShell>
    )
}
