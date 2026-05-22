import { BrandMark } from './BrandMark'
import { MarqueeLink } from './Marquee'

const links = [
    { label: 'Anatomy', href: '#anatomy' },
    { label: 'Capabilities', href: '#capabilities' },
    { label: 'Deploy', href: '#deploy' },
    { label: 'Pricing', href: '#pricing' },
]

export function Nav() {
    return (
        <header className="sticky top-0 z-30 border-b border-[var(--color-rule)] bg-[var(--color-night)]/85 backdrop-blur-md">
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
                <div className="flex items-center gap-5">
                    <MarqueeLink
                        href="https://github.com/parlali/agent_room"
                        external
                        className="hidden text-[13px] tracking-tight text-[var(--color-ink-dim)] transition hover:text-[var(--color-ink)] sm:inline-flex"
                    >
                        GitHub
                    </MarqueeLink>
                    <MarqueeLink
                        href="https://github.com/parlali/agent_room"
                        external
                        className="inline-flex items-center gap-2 border border-[var(--color-ink)] bg-[var(--color-ink)] px-3.5 py-2 text-[12.5px] font-medium tracking-tight text-[var(--color-night)] transition hover:bg-transparent hover:text-[var(--color-ink)]"
                    >
                        Boot a room
                    </MarqueeLink>
                </div>
            </div>
        </header>
    )
}
