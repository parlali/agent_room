import { useEffect, useState } from 'react'

import { BrandMark } from '@agent-room/brand'

import { navLinks, primaryCta } from '~/content/site'
import { useRouter } from '~/lib/router'
import { CtaButton, Container } from './primitives'
import { Link } from './Link'

const burgerLine = 'absolute h-[1.5px] w-4 rounded-full bg-ink transition-all duration-300'

export function Header() {
    const { path } = useRouter()
    const [open, setOpen] = useState(false)

    useEffect(() => {
        setOpen(false)
    }, [path])

    useEffect(() => {
        document.body.style.overflow = open ? 'hidden' : ''
        return () => {
            document.body.style.overflow = ''
        }
    }, [open])

    return (
        <>
            <header className="sticky top-0 z-50 border-b border-line bg-paper/85 backdrop-blur-md">
                <Container className="flex h-16 items-center justify-between gap-4">
                    <Link
                        href="/"
                        aria-label="Agent Room home"
                        className="flex items-center gap-2 text-ink"
                    >
                        <BrandMark size={24} title="Agent Room" />
                        <span className="text-[0.95rem] font-medium tracking-tight">
                            Agent Room
                        </span>
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
                        className="relative flex h-10 w-10 items-center justify-center rounded-full border border-line-strong bg-panel md:hidden"
                        aria-expanded={open}
                        aria-controls="mobile-nav"
                        aria-label={open ? 'Close menu' : 'Open menu'}
                        onClick={() => setOpen((value) => !value)}
                    >
                        <span
                            aria-hidden
                            className={`${burgerLine} ${open ? 'rotate-45' : '-translate-y-[5px]'}`}
                        />
                        <span aria-hidden className={`${burgerLine} ${open ? 'opacity-0' : ''}`} />
                        <span
                            aria-hidden
                            className={`${burgerLine} ${open ? '-rotate-45' : 'translate-y-[5px]'}`}
                        />
                    </button>
                </Container>
            </header>

            <div
                id="mobile-nav"
                className={`fixed inset-x-0 top-16 bottom-0 z-40 bg-paper transition-all duration-300 ease-out md:hidden ${
                    open ? 'visible translate-y-0 opacity-100' : 'invisible -translate-y-3 opacity-0'
                }`}
            >
                <Container className="flex h-full flex-col overflow-y-auto pt-4 pb-6">
                    <nav aria-label="Mobile" className="flex flex-col">
                        {navLinks.map((link) => {
                            const active = !link.external && link.href === path
                            return (
                                <Link
                                    key={link.label}
                                    href={link.href}
                                    external={link.external}
                                    className={`border-b border-line py-4 text-lg font-medium tracking-tight transition-colors ${
                                        active ? 'text-ink' : 'text-ink-soft hover:text-ink'
                                    }`}
                                >
                                    {link.label}
                                </Link>
                            )
                        })}
                    </nav>
                    <div className="mt-auto flex flex-col gap-5 pt-8">
                        <CtaButton cta={primaryCta} size="lg" className="w-full" />
                        <div className="flex items-center justify-center gap-6 border-t border-line pt-5">
                            <Link
                                href="/terms"
                                className="text-sm text-ink-faint transition-colors hover:text-ink"
                            >
                                Terms
                            </Link>
                            <Link
                                href="/privacy"
                                className="text-sm text-ink-faint transition-colors hover:text-ink"
                            >
                                Privacy
                            </Link>
                        </div>
                    </div>
                </Container>
            </div>
        </>
    )
}
