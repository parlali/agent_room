import type { ReactNode } from 'react'

type Props = {
    children: ReactNode
    href?: string
    className?: string
    onClick?: () => void
    external?: boolean
    marquee?: boolean
}

export function MarqueeLink({
    children,
    href,
    className,
    onClick,
    external,
    marquee = true,
}: Props) {
    const content = marquee ? (
        <span className="marquee-hover">
            <span className="marquee-stack">
                <span>{children}</span>
                <span>{children}</span>
            </span>
        </span>
    ) : (
        <span>{children}</span>
    )
    if (href) {
        return (
            <a
                href={href}
                onClick={onClick}
                className={className}
                target={external ? '_blank' : undefined}
                rel={external ? 'noreferrer' : undefined}
            >
                {content}
            </a>
        )
    }
    return (
        <button type="button" onClick={onClick} className={className}>
            {content}
        </button>
    )
}
