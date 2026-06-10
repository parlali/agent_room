import type { ReactNode } from 'react'

import { Container } from './primitives'

export function PageHero({
    eyebrow,
    children,
    visual,
    className = '',
}: {
    eyebrow?: string
    children: ReactNode
    visual?: ReactNode
    className?: string
}) {
    return (
        <section className={`relative overflow-hidden border-b border-line ${className}`}>
            <Container
                className={visual ? 'pt-20 pb-16 sm:pt-24 lg:pt-28' : 'py-20 sm:py-24 lg:py-28'}
            >
                <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
                    {eyebrow ? (
                        <p className="badge-pill rise mb-6">
                            <span
                                className="inline-block h-1.5 w-1.5 rounded-full bg-accent-green"
                                aria-hidden
                            />
                            {eyebrow}
                        </p>
                    ) : null}
                    {children}
                </div>
                {visual ? (
                    <div className="rise rise-4 mx-auto mt-16 max-w-5xl sm:mt-20">{visual}</div>
                ) : null}
            </Container>
        </section>
    )
}
