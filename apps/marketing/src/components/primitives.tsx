import type { ReactNode } from 'react'

import type { Cta } from '~/content/types'
import { Link } from './Link'

export type SectionSize = 'tight' | 'default' | 'loose'

const sectionPadding: Record<SectionSize, string> = {
    tight: 'py-14 sm:py-16',
    default: 'py-20 sm:py-24 lg:py-28',
    loose: 'py-24 sm:py-28 lg:py-32',
}

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

export function DocumentWidth({
    children,
    className = '',
}: {
    children: ReactNode
    className?: string
}) {
    return <div className={`mx-auto w-full max-w-3xl ${className}`}>{children}</div>
}

export function Section({
    children,
    className = '',
    id,
    size = 'default',
}: {
    children: ReactNode
    className?: string
    id?: string
    size?: SectionSize
}) {
    return (
        <section id={id} className={className}>
            <Container className={sectionPadding[size]}>{children}</Container>
        </section>
    )
}

export function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
    return <p className={`eyebrow mb-4 ${className}`}>{children}</p>
}

export function SectionHeading({
    eyebrow,
    title,
    summary,
    align = 'center',
    className = '',
}: {
    eyebrow?: string
    title: string
    summary?: string
    align?: 'center' | 'left'
    className?: string
}) {
    const alignment = align === 'center' ? 'mx-auto text-center' : ''

    return (
        <div className={`max-w-2xl ${alignment} ${className}`}>
            {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
            <h2 className="type-title text-balance text-ink">{title}</h2>
            {summary ? <p className="type-body mt-4 text-pretty text-ink-soft">{summary}</p> : null}
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
    size = 'default',
    className = '',
}: {
    cta: Cta
    variant?: 'primary' | 'ghost'
    size?: 'default' | 'lg'
    className?: string
}) {
    const variantClass = variant === 'primary' ? 'btn-primary' : 'btn-ghost'
    const sizeClass = size === 'lg' ? 'btn-lg' : ''

    return (
        <Link
            href={cta.href}
            external={cta.external}
            className={`btn ${variantClass} ${sizeClass} ${className}`}
        >
            {cta.label}
        </Link>
    )
}

export function ArrowLink({
    href,
    external,
    children,
    className = '',
}: {
    href: string
    external?: boolean
    children: ReactNode
    className?: string
}) {
    return (
        <Link
            href={href}
            external={external}
            className={`group inline-flex items-center gap-1.5 text-sm font-medium text-accent-green ${className}`}
        >
            {children}
            <span
                aria-hidden
                className="transition-transform duration-150 group-hover:translate-x-0.5"
            >
                {'→'}
            </span>
        </Link>
    )
}
