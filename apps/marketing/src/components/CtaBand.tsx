import { githubCta, primaryCta } from '~/content/site'
import { Container } from './primitives'
import { Link } from './Link'

export function CtaBand({
    title = 'Give a room to the next line of work.',
    body = 'Join the waitlist for hosted Agent Room and we will reach out as early access opens.',
}: {
    title?: string
    body?: string
}) {
    return (
        <section className="border-t border-line bg-night text-paper">
            <Container className="py-16 sm:py-20">
                <div className="flex flex-col items-start gap-6 lg:flex-row lg:items-center lg:justify-between">
                    <div className="max-w-xl">
                        <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
                            {title}
                        </h2>
                        <p className="mt-3 text-base leading-relaxed text-paper/70">{body}</p>
                    </div>
                    <div className="flex flex-wrap gap-3">
                        <Link
                            href={primaryCta.href}
                            external={primaryCta.external}
                            className="btn border-transparent bg-paper text-ink hover:bg-white"
                        >
                            {primaryCta.label}
                        </Link>
                        <Link
                            href={githubCta.href}
                            external={githubCta.external}
                            className="btn border-paper/25 bg-transparent text-paper hover:bg-paper/10"
                        >
                            {githubCta.label}
                        </Link>
                    </div>
                </div>
            </Container>
        </section>
    )
}
