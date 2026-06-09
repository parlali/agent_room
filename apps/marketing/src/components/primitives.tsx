import type { ReactNode } from 'react'

import type { Cta } from '~/content/types'
import { Link } from './Link'

export function Container({
    children,
    className = '',
}: {
    children: ReactNode
    className?: string
}) {
    return (
        <div className={`mx-auto w-full max-w-[1180px] px-5 sm:px-8 ${className}`}>{children}</div>
    )
}

export function Section({
    children,
    className = '',
    id,
}: {
    children: ReactNode
    className?: string
    id?: string
}) {
    return (
        <section id={id} className={`border-t border-line ${className}`}>
            <Container className="py-16 sm:py-20 lg:py-24">{children}</Container>
        </section>
    )
}

export function Eyebrow({ children }: { children: ReactNode }) {
    return <p className="eyebrow mb-3">{children}</p>
}

export function SectionHeading({
    eyebrow,
    title,
    summary,
    className = '',
}: {
    eyebrow?: string
    title: string
    summary?: string
    className?: string
}) {
    return (
        <div className={`max-w-2xl ${className}`}>
            {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
            <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
                {title}
            </h2>
            {summary ? (
                <p className="mt-4 text-base leading-relaxed text-ink-soft">{summary}</p>
            ) : null}
        </div>
    )
}

const dotColor: Record<string, string> = {
    green: 'bg-accent-green',
    blue: 'bg-accent-blue',
    amber: 'bg-accent-amber',
    red: 'bg-accent-red',
}

export function StatusDot({ tone = 'green' }: { tone?: 'green' | 'blue' | 'amber' | 'red' }) {
    return (
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${dotColor[tone]}`} aria-hidden />
    )
}

export function CtaButton({
    cta,
    variant = 'primary',
    className = '',
}: {
    cta: Cta
    variant?: 'primary' | 'ghost'
    className?: string
}) {
    return (
        <Link
            href={cta.href}
            external={cta.external}
            className={`btn ${variant === 'primary' ? 'btn-primary' : 'btn-ghost'} ${className}`}
        >
            {cta.label}
        </Link>
    )
}
