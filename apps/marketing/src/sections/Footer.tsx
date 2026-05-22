import { BrandMark } from '@agent-room/brand'
import { MarqueeLink } from '../components/Marquee'

export function Footer() {
    return (
        <footer className="relative border-t border-[var(--color-rule)] bg-[var(--color-night)]">
            <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-10">
                <div className="grid grid-cols-12 gap-x-6 gap-y-10 py-14 lg:gap-x-10">
                    <div className="col-span-12 lg:col-span-4">
                        <div className="flex items-center gap-3 text-[var(--color-ink)]">
                            <BrandMark size={26} />
                            <span className="font-serif text-[22px] tracking-tight">
                                Agent Room
                            </span>
                        </div>
                        <p className="mt-5 max-w-sm text-[13.5px] leading-[1.6] text-[var(--color-ink-dim)]">
                            A self-hosted home for persistent AI coworkers. Each room is a workspace
                            that remembers, owns files, runs scheduled work, and stays on your
                            hardware.
                        </p>
                    </div>
                    <FootCol title="PROJECT">
                        <FootLink href="https://github.com/parlali/agent_room">github</FootLink>
                        <FootLink href="https://github.com/parlali/agent_room/blob/main/README.md">
                            readme
                        </FootLink>
                        <FootLink href="https://github.com/parlali/agent_room/blob/main/SECURITY.md">
                            security
                        </FootLink>
                        <FootLink href="https://github.com/parlali/agent_room/blob/main/LICENSE">
                            license · MIT
                        </FootLink>
                    </FootCol>
                    <FootCol title="DOCS">
                        <FootLink href="#anatomy">anatomy of a room</FootLink>
                        <FootLink href="#pricing">pricing note</FootLink>
                        <FootLink href="https://github.com/parlali/agent_room/blob/main/CONTRIBUTING.md">
                            contributing
                        </FootLink>
                        <FootLink href="https://github.com/parlali/agent_room/blob/main/CODE_OF_CONDUCT.md">
                            code of conduct
                        </FootLink>
                    </FootCol>
                    <FootCol title="CONTACT">
                        <FootLink href="mailto:hello@openagentroom.com">
                            hello@openagentroom.com
                        </FootLink>
                        <FootLink href="https://github.com/parlali/agent_room/issues">
                            issues
                        </FootLink>
                        <FootLink href="https://github.com/parlali/agent_room/discussions">
                            discussions
                        </FootLink>
                    </FootCol>
                </div>

                <div className="flex flex-col gap-6 border-t border-[var(--color-rule)] py-6 sm:flex-row sm:items-end sm:justify-between">
                    <div className="font-mono text-[10px] uppercase leading-[1.7] tracking-[0.18em] text-[var(--color-ink-faint)]">
                        <div>
                            © {new Date().getFullYear()} agent room project · mit license · made
                            with open primitives
                        </div>
                        <div>operator-grade software · not a chat client</div>
                    </div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-faint)]">
                        openagentroom.com · revision A1 · printed on the web
                    </div>
                </div>

                <div
                    aria-hidden
                    className="font-serif overflow-hidden pb-6 text-[18vw] leading-none tracking-[-0.05em] text-[var(--color-rule)]"
                    style={{ fontVariationSettings: "'opsz' 144, 'SOFT' 50" }}
                >
                    AGENT&nbsp;ROOM
                </div>
            </div>
        </footer>
    )
}

function FootCol({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="col-span-6 sm:col-span-4 lg:col-span-2 lg:col-start-7">
            <div className="label-mono mb-4">{title}</div>
            <ul className="space-y-2.5 text-[13px] text-[var(--color-ink-dim)]">{children}</ul>
        </div>
    )
}

function FootLink({ href, children }: { href: string; children: React.ReactNode }) {
    const external = href.startsWith('http') || href.startsWith('mailto:')
    return (
        <li>
            <MarqueeLink
                href={href}
                external={external && href.startsWith('http')}
                className="inline-flex hover:text-[var(--color-ink)]"
            >
                {children}
            </MarqueeLink>
        </li>
    )
}
