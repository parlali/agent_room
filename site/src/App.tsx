import {
    ActivityIcon,
    ArrowRightIcon,
    BrainIcon,
    CheckCircle2Icon,
    CodeIcon,
    FileArchiveIcon,
    FileTextIcon,
    FolderIcon,
    GitBranchIcon,
    GlobeIcon,
    ImageIcon,
    MonitorIcon,
    PresentationIcon,
    SearchIcon,
    ServerIcon,
    ShieldCheckIcon,
    TableIcon,
    TerminalIcon,
    WrenchIcon,
    type LucideIcon,
} from 'lucide-react'

import { BrandMark } from '#/components/agent-room/brand'
import { Button } from '#/components/ui/button'
import type { CapabilityOption } from '#/lib/capabilities'

import {
    alphaInterestUrl,
    capabilityRows,
    deploymentDefaults,
    modeRows,
    operatingPrinciples,
    repositoryUrl,
    roomPrimitives,
} from './content'

const capabilityIconById = {
    web_search: SearchIcon,
    url_fetch: GlobeIcon,
    documents: FileTextIcon,
    spreadsheets: TableIcon,
    presentations: PresentationIcon,
    pdf: FileArchiveIcon,
    images: ImageIcon,
    mcp: WrenchIcon,
    shell_coding: TerminalIcon,
} satisfies Record<CapabilityOption['id'], LucideIcon>

const modeIconByTitle = {
    Programmer: CodeIcon,
    Coworker: MonitorIcon,
} satisfies Record<(typeof modeRows)[number]['title'], LucideIcon>

const roomSignals = [
    {
        label: 'Memory',
        value: 'Structured',
        tone: 'ready',
    },
    {
        label: 'Files',
        value: 'Mounted',
        tone: 'work',
    },
    {
        label: 'Jobs',
        value: 'Scheduled',
        tone: 'attention',
    },
    {
        label: 'Provider',
        value: 'Bound',
        tone: 'ready',
    },
]

const statusRows = [
    {
        label: 'Filesystem',
        value: 'Room workspace isolated',
    },
    {
        label: 'Runtime',
        value: 'Per-room process and token',
    },
    {
        label: 'Artifacts',
        value: 'DOCX, XLSX, PPTX, PDF, images',
    },
    {
        label: 'Audit',
        value: 'Runs, tool calls, cost, status',
    },
]

const roomTimeline = [
    'Connect provider',
    'Create room',
    'Attach tools',
    'Run sessions',
    'Schedule jobs',
    'Inspect outputs',
]

export function App() {
    return (
        <div className="min-h-screen bg-background text-foreground">
            <SiteHeader />
            <main>
                <HeroSection />
                <ProblemSection />
                <RoomsSection />
                <DemoSection />
                <CapabilitiesSection />
                <SelfHostingSection />
            </main>
            <SiteFooter />
        </div>
    )
}

function SiteHeader() {
    return (
        <header className="site-header">
            <a href="#top" className="brand-lockup" aria-label="Agent Room home">
                <BrandMark size={30} className="brand-mark" />
                <span>Agent Room</span>
            </a>
            <nav className="site-nav" aria-label="Primary navigation">
                <a href="#rooms">Rooms</a>
                <a href="#demo">Product</a>
                <a href="#capabilities">Capabilities</a>
                <a href="#pricing">Pricing</a>
            </nav>
            <div className="header-actions">
                <Button asChild variant="ghost" size="sm">
                    <a href={repositoryUrl} rel="noreferrer" target="_blank">
                        <GitBranchIcon />
                        GitHub
                    </a>
                </Button>
                <Button asChild size="sm">
                    <a href={alphaInterestUrl} rel="noreferrer" target="_blank">
                        Alpha
                        <ArrowRightIcon />
                    </a>
                </Button>
            </div>
        </header>
    )
}

function HeroSection() {
    return (
        <section id="top" className="hero-section section-band">
            <div className="hero-grid">
                <div className="hero-copy">
                    <div className="status-line">
                        <span className="status-pulse" aria-hidden />
                        OSS now. Closed alpha testing. Managed hosting later.
                    </div>
                    <h1>Self-hosted rooms for persistent AI coworkers.</h1>
                    <p className="hero-lede">
                        Agent Room turns model providers into durable coworkers with their own
                        memory, filesystem, tools, scheduled work, provider binding, artifacts, and
                        audit history.
                    </p>
                    <div className="hero-actions">
                        <Button asChild size="lg">
                            <a href={repositoryUrl} rel="noreferrer" target="_blank">
                                <GitBranchIcon />
                                View on GitHub
                            </a>
                        </Button>
                        <Button asChild variant="outline" size="lg">
                            <a href="#demo">
                                See the product surface
                                <ArrowRightIcon />
                            </a>
                        </Button>
                    </div>
                </div>
                <ControlRoomPanel />
            </div>
            <div className="hero-strip" aria-label="Room workflow">
                {roomTimeline.map((item) => (
                    <span key={item}>{item}</span>
                ))}
            </div>
        </section>
    )
}

function ControlRoomPanel() {
    return (
        <div className="control-room" aria-label="Agent Room product status preview">
            <div className="control-room-screen">
                <div className="screen-topline">
                    <span>Room: Launch Ops</span>
                    <span>Ready</span>
                </div>
                <div className="signal-grid" aria-hidden>
                    <span className="signal-column signal-column-a" />
                    <span className="signal-column signal-column-b" />
                    <span className="signal-column signal-column-c" />
                    <span className="signal-column signal-column-d" />
                </div>
                <div className="room-command">
                    <span className="command-label">Current work</span>
                    <strong>Prepare launch deck, pricing notes, and deployment checklist.</strong>
                </div>
                <div className="room-signal-grid">
                    {roomSignals.map((signal) => (
                        <div key={signal.label} className="room-signal" data-tone={signal.tone}>
                            <span>{signal.label}</span>
                            <strong>{signal.value}</strong>
                        </div>
                    ))}
                </div>
                <div className="artifact-stack" aria-label="Generated artifacts">
                    <ArtifactRow icon={PresentationIcon} label="Board update" value="PPTX" />
                    <ArtifactRow icon={TableIcon} label="Usage model" value="XLSX" />
                    <ArtifactRow icon={FileTextIcon} label="Deployment brief" value="PDF" />
                </div>
            </div>
        </div>
    )
}

function ArtifactRow({
    icon: Icon,
    label,
    value,
}: {
    icon: LucideIcon
    label: string
    value: string
}) {
    return (
        <div className="artifact-row">
            <Icon aria-hidden />
            <span>{label}</span>
            <strong>{value}</strong>
        </div>
    )
}

function ProblemSection() {
    return (
        <section className="section-band section-rule problem-section">
            <div className="section-grid">
                <div className="section-kicker">
                    <span>Why rooms</span>
                </div>
                <div className="section-copy wide-copy">
                    <h2>
                        Most agent products still behave like chat tabs. Agent Room is built around
                        actual work.
                    </h2>
                    <p>
                        Work needs continuity, files, memory, provider truth, tools, scheduled runs,
                        and a place to inspect what happened. A room is the durable unit: one
                        coworker, one workspace, one audit trail.
                    </p>
                    <div className="principle-list">
                        {operatingPrinciples.map((principle) => (
                            <div key={principle} className="principle-row">
                                <CheckCircle2Icon aria-hidden />
                                <span>{principle}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </section>
    )
}

function RoomsSection() {
    return (
        <section id="rooms" className="section-band section-rule">
            <div className="section-grid">
                <div className="section-kicker">
                    <span>Room model</span>
                </div>
                <div className="section-copy">
                    <h2>Each coworker gets its own operating surface.</h2>
                    <p>
                        The app keeps durable context and runtime state attached to the room, not
                        scattered across prompt text, browser tabs, local folders, and hidden
                        provider settings.
                    </p>
                </div>
            </div>
            <div className="primitive-grid">
                {roomPrimitives.map((primitive) => (
                    <article key={primitive.title} className="primitive-card">
                        <h3>{primitive.title}</h3>
                        <p>{primitive.detail}</p>
                    </article>
                ))}
            </div>
        </section>
    )
}

function DemoSection() {
    return (
        <section id="demo" className="section-band section-rule demo-section">
            <div className="section-grid">
                <div className="section-kicker">
                    <span>Product surface</span>
                </div>
                <div className="section-copy">
                    <h2>Inspectable work, not invisible automation.</h2>
                    <p>
                        Sessions, files, memory, jobs, usage, status, and settings are separate
                        surfaces so the operator can see what the room knows, what it can touch, and
                        what it already produced.
                    </p>
                </div>
            </div>
            <ProductConsole />
        </section>
    )
}

function ProductConsole() {
    return (
        <div className="product-console" aria-label="Agent Room dashboard preview">
            <aside className="console-sidebar">
                <div className="console-room active">
                    <span />
                    Launch Ops
                </div>
                <div className="console-room">
                    <span />
                    Research
                </div>
                <div className="console-room">
                    <span />
                    Personal Admin
                </div>
            </aside>
            <div className="console-main">
                <div className="console-toolbar">
                    <div>
                        <span className="command-label">Room workspace</span>
                        <h3>Launch Ops</h3>
                    </div>
                    <Button asChild variant="secondary" size="sm">
                        <a href={repositoryUrl} rel="noreferrer" target="_blank">
                            <GitBranchIcon />
                            OSS repo
                        </a>
                    </Button>
                </div>
                <div className="console-tabs">
                    <span>Files</span>
                    <span>Jobs</span>
                    <span>Memory</span>
                    <span>Usage</span>
                    <span>Status</span>
                    <span>Settings</span>
                </div>
                <div className="console-content">
                    <section className="work-panel">
                        <div className="panel-heading">
                            <FolderIcon aria-hidden />
                            <span>Filesystem</span>
                        </div>
                        <StatusTable rows={statusRows} />
                    </section>
                    <section className="work-panel">
                        <div className="panel-heading">
                            <BrainIcon aria-hidden />
                            <span>Structured memory</span>
                        </div>
                        <div className="memory-blocks">
                            <span>Responsibilities</span>
                            <span>Current projects</span>
                            <span>Decisions</span>
                            <span>Deadlines</span>
                        </div>
                    </section>
                    <section className="work-panel wide-panel">
                        <div className="panel-heading">
                            <ActivityIcon aria-hidden />
                            <span>Recent work</span>
                        </div>
                        <div className="run-log">
                            <RunLogRow label="Create pricing teaser copy" value="Complete" />
                            <RunLogRow label="Export launch one-pager" value="PDF ready" />
                            <RunLogRow label="Schedule weekly research brief" value="Queued" />
                        </div>
                    </section>
                </div>
            </div>
        </div>
    )
}

function StatusTable({ rows }: { rows: Array<{ label: string; value: string }> }) {
    return (
        <div className="status-table">
            {rows.map((row) => (
                <div key={row.label}>
                    <span>{row.label}</span>
                    <strong>{row.value}</strong>
                </div>
            ))}
        </div>
    )
}

function RunLogRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="run-log-row">
            <span>{label}</span>
            <strong>{value}</strong>
        </div>
    )
}

function CapabilitiesSection() {
    return (
        <section id="capabilities" className="section-band section-rule">
            <div className="section-grid">
                <div className="section-kicker">
                    <span>Capabilities</span>
                </div>
                <div className="section-copy">
                    <h2>A real coworker needs more than a model call.</h2>
                    <p>
                        Agent Room exposes room-scoped capabilities deliberately, so broad work can
                        include code, browsing, research, Office documents, PDFs, generated images,
                        private integrations, and scheduled follow-through.
                    </p>
                </div>
            </div>
            <div className="capability-grid">
                {capabilityRows.map((capability) => {
                    const Icon = capabilityIconById[capability.id]
                    return (
                        <article key={capability.id} className="capability-card">
                            <Icon aria-hidden />
                            <h3>{capability.title}</h3>
                            <p>{capability.description}</p>
                        </article>
                    )
                })}
            </div>
            <div className="mode-strip">
                {modeRows.map((mode) => {
                    const Icon = modeIconByTitle[mode.title] ?? MonitorIcon
                    return (
                        <article key={mode.title}>
                            <Icon aria-hidden />
                            <div>
                                <h3>{mode.title} mode</h3>
                                <p>{mode.description}</p>
                            </div>
                        </article>
                    )
                })}
            </div>
        </section>
    )
}

function SelfHostingSection() {
    return (
        <section id="pricing" className="section-band section-rule self-hosting-section">
            <div className="section-grid">
                <div className="section-kicker">
                    <span>Status</span>
                </div>
                <div className="section-copy wide-copy">
                    <h2>
                        Open source and self-hosted first. Hosted SaaS is being shaped with alpha
                        users.
                    </h2>
                    <p>
                        The current product is designed for local or private-network deployment.
                        Managed hosting and pricing will come later; the near-term priority is a
                        trustworthy self-hosted control room with clean runtime boundaries.
                    </p>
                </div>
            </div>
            <div className="deployment-grid">
                <div className="deploy-panel">
                    <div className="panel-heading">
                        <ServerIcon aria-hidden />
                        <span>Docker-first launch</span>
                    </div>
                    <pre aria-label="Docker compose command">
                        <code>docker compose up -d --build</code>
                    </pre>
                    <div className="deployment-defaults">
                        {deploymentDefaults.map((item) => (
                            <div key={item.label}>
                                <span>{item.label}</span>
                                <strong>{item.value}</strong>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="alpha-panel">
                    <div className="alpha-heading">
                        <ShieldCheckIcon aria-hidden />
                        <span>Closed alpha</span>
                    </div>
                    <h3>Help shape the hosted path without weakening the self-hosted core.</h3>
                    <p>
                        Alpha feedback is focused on real workflows, deployment friction, provider
                        configuration, integrations, Office artifacts, and long-running work.
                    </p>
                    <div className="alpha-actions">
                        <Button asChild size="lg">
                            <a href={alphaInterestUrl} rel="noreferrer" target="_blank">
                                Request alpha access
                                <ArrowRightIcon />
                            </a>
                        </Button>
                        <Button asChild variant="outline" size="lg">
                            <a href={repositoryUrl} rel="noreferrer" target="_blank">
                                <GitBranchIcon />
                                Star the repo
                            </a>
                        </Button>
                    </div>
                </div>
            </div>
        </section>
    )
}

function SiteFooter() {
    return (
        <footer className="site-footer">
            <a href="#top" className="brand-lockup" aria-label="Agent Room home">
                <BrandMark size={24} className="brand-mark" />
                <span>Agent Room</span>
            </a>
            <div className="footer-links">
                <a href={repositoryUrl} rel="noreferrer" target="_blank">
                    GitHub
                </a>
                <a href={`${repositoryUrl}/issues`} rel="noreferrer" target="_blank">
                    Issues
                </a>
                <a href={`${repositoryUrl}/blob/main/SECURITY.md`} rel="noreferrer" target="_blank">
                    Security
                </a>
            </div>
        </footer>
    )
}
