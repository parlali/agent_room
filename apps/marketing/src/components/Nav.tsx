import { BrandMark } from '@agent-room/brand'
import { GitHubLink } from './GitHubLink'
import { TextLink } from './TextLink'

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
                    <span className="text-[16px] font-semibold">Agent Room</span>
                </a>
                <nav className="hidden items-center gap-8 md:flex">
                    {links.map((link) => (
                        <TextLink
                            key={link.href}
                            href={link.href}
                            className="text-[13px] text-[var(--color-ink-dim)] transition hover:text-[var(--color-ink)]"
                        >
                            {link.label}
                        </TextLink>
                    ))}
                </nav>
                <GitHubLink />
            </div>
        </header>
    )
}
