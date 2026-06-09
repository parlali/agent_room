import { BrandMark } from '@agent-room/brand'

import { brand, footerGroups } from '~/content/site'
import { Container } from './primitives'
import { Link } from './Link'

export function Footer() {
    return (
        <footer className="border-t border-line bg-paper-sunken">
            <Container className="py-14">
                <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(3,1fr)]">
                    <div className="max-w-xs">
                        <div className="flex items-center gap-2 text-ink">
                            <BrandMark size={22} title="Agent Room" />
                            <span className="text-sm font-semibold tracking-tight">
                                {brand.name}
                            </span>
                        </div>
                        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
                            {brand.tagline}
                        </p>
                    </div>

                    {footerGroups.map((group) => (
                        <div key={group.heading}>
                            <p className="eyebrow mb-3">{group.heading}</p>
                            <ul className="flex flex-col gap-2">
                                {group.links.map((link) => (
                                    <li key={link.label}>
                                        <Link
                                            href={link.href}
                                            external={link.external}
                                            className="text-sm text-ink-soft transition-colors hover:text-ink"
                                        >
                                            {link.label}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>

                <div className="mt-12 flex flex-col gap-3 border-t border-line pt-6 text-xs text-ink-faint sm:flex-row sm:items-center sm:justify-between">
                    <p>
                        {brand.name} - {new Date().getFullYear()}. Source available. Hosted product
                        in early access.
                    </p>
                    <p className="font-mono">Isolated AI coworkers for real work.</p>
                </div>
            </Container>
        </footer>
    )
}
