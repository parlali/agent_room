import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from 'react'

import { useRouter } from '~/lib/router'

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string
    external?: boolean
    children: ReactNode
}

export function Link({ href, external, children, onClick, ...rest }: LinkProps) {
    const { navigate } = useRouter()

    const isExternal = external || href.startsWith('http') || href.startsWith('mailto:')

    if (isExternal) {
        return (
            <a
                href={href}
                target={href.startsWith('mailto:') ? undefined : '_blank'}
                rel="noreferrer noopener"
                onClick={onClick}
                {...rest}
            >
                {children}
            </a>
        )
    }

    const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
            return
        }
        event.preventDefault()
        onClick?.(event)
        navigate(href)
    }

    return (
        <a href={href} onClick={handleClick} {...rest}>
            {children}
        </a>
    )
}
