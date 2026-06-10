import type { LegalDocument, SeoMeta } from '~/content/types'
import { PageShell } from '~/components/PageShell'
import { DocumentWidth, Section } from '~/components/primitives'

export function LegalPage({ meta, document }: { meta: SeoMeta; document: LegalDocument }) {
    return (
        <PageShell meta={meta}>
            <Section size="tight">
                <DocumentWidth>
                    <p className="eyebrow mb-3">Legal</p>
                    <h1 className="type-display text-balance text-ink">{document.title}</h1>
                    <p className="type-body mt-4 text-ink-soft">{document.summary}</p>
                    <p className="mt-3 font-mono text-xs text-ink-faint">
                        Last updated {document.updated}
                    </p>

                    <div className="mt-12 flex flex-col gap-10">
                        {document.sections.map((section) => (
                            <section key={section.heading}>
                                <h2 className="text-lg font-medium tracking-tight text-ink">
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
                </DocumentWidth>
            </Section>
        </PageShell>
    )
}
