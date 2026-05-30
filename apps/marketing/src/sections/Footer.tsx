import { BrandMark } from '@agent-room/brand'
import { TextLink } from '../components/TextLink'

export function Footer() {
    return (
        <footer className="relative border-t border-[var(--color-rule)] bg-[var(--color-night)]">
            <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-10">
                <div className="grid gap-x-10 gap-y-10 py-14 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
                    <div>
                        <div className="flex items-center gap-3 text-[var(--color-ink)]">
                            <BrandMark size={26} />
                            <span className="text-[20px] font-semibold">Agent Room</span>
                        </div>
                        <p className="mt-5 max-w-sm text-[13.5px] leading-[1.6] text-[var(--color-ink-dim)]">
                            Self-hosted rooms for persistent AI coworkers. Each room has its own
                            memory, files, scheduled jobs, tools, provider binding, and audit trail.
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
                            license
                        </FootLink>
                    </FootCol>
                    <FootCol title="DOCS">
                        <FootLink href="#anatomy">how rooms work</FootLink>
                        <FootLink href="#pricing">pricing</FootLink>
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
                    <div className="font-mono text-[10px] uppercase leading-[1.7] text-[var(--color-ink-faint)]">
                        <div>
                            Copyright {new Date().getFullYear()} Agent Room Project - MIT license
                        </div>
                        <div>Self-hosted agent orchestration</div>
                    </div>
                    <div className="font-mono text-[10px] uppercase text-[var(--color-ink-faint)]">
                        openagentroom.com
                    </div>
                </div>
            </div>
        </footer>
    )
}

function FootCol({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div>
            <div className="label-mono mb-4">{title}</div>
            <ul className="space-y-2.5 text-[13px] text-[var(--color-ink-dim)]">{children}</ul>
        </div>
    )
}

function FootLink({ href, children }: { href: string; children: React.ReactNode }) {
    const external = href.startsWith('http') || href.startsWith('mailto:')
    return (
        <li>
            <TextLink
                href={href}
                external={external && href.startsWith('http')}
                className="inline-flex hover:text-[var(--color-ink)]"
            >
                {children}
            </TextLink>
        </li>
    )
}
