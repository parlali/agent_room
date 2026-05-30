import type { ReactNode } from 'react'

type Props = {
    children: ReactNode
    href?: string
    className?: string
    onClick?: () => void
    external?: boolean
}

export function TextLink({ children, href, className, onClick, external }: Props) {
    const content = <span>{children}</span>

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
