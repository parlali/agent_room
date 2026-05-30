import { BrandMark } from '@agent-room/brand'
import { GitHubLink } from './GitHubLink'
import { MarqueeLink } from './Marquee'

const links = [
    { label: 'Anatomy', href: '#anatomy' },
    { label: 'Capabilities', href: '#capabilities' },
    { label: 'Deploy', href: '#deploy' },
    { label: 'Pricing', href: '#pricing' },
]

export function Nav() {
    return (
        <header className="site-header fixed inset-x-0 top-0 z-50 border-b border-[var(--color-rule)] bg-[var(--color-night)]">
            <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between px-4 sm:px-6 lg:px-10">
                <a href="#top" className="group flex items-center gap-2.5 text-[var(--color-ink)]">
                    <BrandMark size={20} />
                    <span className="font-serif text-[17px] tracking-tight">Agent Room</span>
                    <span className="ml-2 hidden border border-[var(--color-rule-bright)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--color-ink-dim)] sm:inline-block">
                        v0.9 · alpha
                    </span>
                </a>
                <nav className="hidden items-center gap-8 md:flex">
                    {links.map((link) => (
                        <MarqueeLink
                            key={link.href}
                            href={link.href}
                            className="text-[13px] tracking-tight text-[var(--color-ink-dim)] transition hover:text-[var(--color-ink)]"
                        >
                            {link.label}
                        </MarqueeLink>
                    ))}
                </nav>
                <GitHubLink />
            </div>
        </header>
    )
}
