import { BrandMark } from '@agent-room/brand'

import { brand, footerLegalLinks, footerNavLinks } from '~/content/site'
import { Container, StatusDot } from './primitives'
import { Link } from './Link'

export function Footer() {
    return (
        <footer className="border-t border-line bg-paper-sunken">
            <Container className="py-10">
                <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
                    <div className="flex items-center gap-2.5 text-ink">
                        <BrandMark size={22} title="Agent Room" />
                        <span className="text-sm font-medium tracking-tight">{brand.name}</span>
                        <span className="hidden border-l border-line pl-2.5 text-sm text-ink-faint md:inline">
                            {brand.tagline}
                        </span>
                    </div>

                    <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
                        {footerNavLinks.map((link) => (
                            <Link
                                key={link.label}
                                href={link.href}
                                external={link.external}
                                className="text-sm text-ink-soft transition-colors hover:text-ink"
                            >
                                {link.label}
                            </Link>
                        ))}
                    </nav>
                </div>

                <div className="mt-8 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-line pt-5 font-mono text-[0.625rem] font-medium uppercase tracking-[0.12em] text-ink-faint">
                    <span className="flex items-center gap-1.5">
                        <StatusDot tone="green" />
                        All walls holding
                    </span>
                    <span className="flex items-center gap-5">
                        <span>
                            {brand.name} {new Date().getFullYear()}
                        </span>
                        {footerLegalLinks.map((link) => (
                            <Link
                                key={link.label}
                                href={link.href}
                                className="transition-colors hover:text-ink"
                            >
                                {link.label}
                            </Link>
                        ))}
                    </span>
                </div>
            </Container>
        </footer>
    )
}
