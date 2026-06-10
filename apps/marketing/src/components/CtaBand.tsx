import type { Cta } from '~/content/types'
import { primaryCta } from '~/content/site'
import { Container } from './primitives'
import { Link } from './Link'

export function CtaBand({
    title = 'Give a room to the next line of work.',
    body = 'Join the waitlist for hosted Agent Room and we will reach out as early access opens.',
    primary = primaryCta,
    secondary,
}: {
    title?: string
    body?: string
    primary?: Cta
    secondary?: Cta
}) {
    return (
        <section className="bg-night text-paper">
            <Container className="py-20 sm:py-24 lg:py-28">
                <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
                    <h2 className="type-title text-balance text-paper sm:text-4xl">{title}</h2>
                    <p className="mt-5 max-w-xl text-pretty text-base leading-relaxed text-paper/70">
                        {body}
                    </p>
                    <div className="mt-9 flex flex-wrap justify-center gap-3">
                        <Link
                            href={primary.href}
                            external={primary.external}
                            className="btn btn-lg border-transparent bg-paper text-ink hover:-translate-y-px hover:bg-white"
                        >
                            {primary.label}
                        </Link>
                        {secondary ? (
                            <Link
                                href={secondary.href}
                                external={secondary.external}
                                className="btn btn-lg border-paper/25 bg-transparent text-paper hover:-translate-y-px hover:bg-paper/10"
                            >
                                {secondary.label}
                            </Link>
                        ) : null}
                    </div>
                </div>
            </Container>
        </section>
    )
}
