import { useEffect, useState } from 'react'

import { BrandMark } from '@agent-room/brand'

import { navLinks, primaryCta } from '~/content/site'
import { useRouter } from '~/lib/router'
import { CtaButton, Container } from './primitives'
import { Link } from './Link'

export function Header() {
    const { path } = useRouter()
    const [open, setOpen] = useState(false)

    useEffect(() => {
        setOpen(false)
    }, [path])

    return (
        <header className="sticky top-0 z-50 border-b border-line bg-paper/85 backdrop-blur-md">
            <Container className="flex h-16 items-center justify-between gap-4">
                <Link
                    href="/"
                    aria-label="Agent Room home"
                    className="flex items-center gap-2 text-ink"
                >
                    <BrandMark size={24} title="Agent Room" />
                    <span className="text-[0.95rem] font-semibold tracking-tight">Agent Room</span>
                </Link>

                <nav className="hidden items-center gap-1 md:flex">
                    {navLinks.map((link) => {
                        const active = !link.external && link.href === path
                        return (
                            <Link
                                key={link.label}
                                href={link.href}
                                external={link.external}
                                className={`rounded-md px-3 py-2 text-sm transition-colors ${
                                    active ? 'text-ink' : 'text-ink-soft hover:text-ink'
                                }`}
                            >
                                {link.label}
                            </Link>
                        )
                    })}
                </nav>

                <div className="hidden md:block">
                    <CtaButton cta={primaryCta} />
                </div>

                <button
                    type="button"
                    className="btn btn-ghost h-9 px-3 md:hidden"
                    aria-expanded={open}
                    aria-controls="mobile-nav"
                    onClick={() => setOpen((value) => !value)}
                >
                    {open ? 'Close' : 'Menu'}
                </button>
            </Container>

            {open ? (
                <div id="mobile-nav" className="border-t border-line bg-paper md:hidden">
                    <Container className="flex flex-col gap-1 py-4">
                        {navLinks.map((link) => (
                            <Link
                                key={link.label}
                                href={link.href}
                                external={link.external}
                                className="rounded-md px-3 py-2.5 text-sm text-ink-soft hover:bg-paper-sunken hover:text-ink"
                            >
                                {link.label}
                            </Link>
                        ))}
                        <CtaButton cta={primaryCta} className="mt-2 w-full" />
                    </Container>
                </div>
            ) : null}
        </header>
    )
}
