import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { SettingsIcon } from 'lucide-react'
import { KeyValueList, LoadingRows, Page, PageHeader, Section } from '#/components/agent-room'
import { cn } from '#/lib/utils'
import { roleLabel } from '#/domain/format'
import { roomQueryKey } from '#/lib/room-query-keys'
import { currentUserServer } from './-auth-server'
import { ThemeControl } from '#/components/app-shell/theme-control'
import { useHostedDeployment } from '#/components/app-shell/nav-config'
import { requireRouteUser } from './-route-auth'
import { ProvidersIntegrationsSection } from './settings/-advanced-section'
import { UsageBillingSection } from './settings/-usage-section'

interface SettingsSearch {
    installationId?: string
    setupAction?: string
    githubState?: string
}

export const Route = createFileRoute('/settings')({
    beforeLoad: requireRouteUser,
    validateSearch: (search: Record<string, unknown>): SettingsSearch => ({
        installationId:
            typeof search.installation_id === 'string' && search.installation_id
                ? search.installation_id
                : undefined,
        setupAction:
            typeof search.setup_action === 'string' && search.setup_action
                ? search.setup_action
                : undefined,
        githubState: typeof search.state === 'string' && search.state ? search.state : undefined,
    }),
    component: SettingsPage,
})

const sectionNav = [
    { id: 'account', label: 'Account' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'usage', label: 'Usage & billing' },
    { id: 'advanced', label: 'Providers & integrations' },
]

const sectionIds = sectionNav.map((entry) => entry.id)

function useActiveSection(ids: string[]): string {
    const [active, setActive] = useState(ids[0] ?? '')
    useEffect(() => {
        if (typeof window === 'undefined') return
        const observer = new IntersectionObserver(
            (entries) => {
                const visible = entries
                    .filter((entry) => entry.isIntersecting)
                    .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
                if (visible[0]) setActive(visible[0].target.id)
            },
            { rootMargin: '-40% 0px -55% 0px', threshold: 0 },
        )
        for (const id of ids) {
            const element = document.getElementById(id)
            if (element) observer.observe(element)
        }
        return () => observer.disconnect()
    }, [ids])
    return active
}

function SectionNav({ active }: { active: string }) {
    return (
        <nav className="flex gap-1 overflow-x-auto">
            {sectionNav.map((entry) => {
                const isActive = entry.id === active
                return (
                    <a
                        key={entry.id}
                        href={`#${entry.id}`}
                        aria-current={isActive ? 'true' : undefined}
                        className={cn(
                            'shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                            isActive
                                ? 'bg-accent text-foreground'
                                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                        )}
                    >
                        {entry.label}
                    </a>
                )
            })}
        </nav>
    )
}

function SettingsPage() {
    const hosted = useHostedDeployment()
    const search = Route.useSearch()
    const navigate = Route.useNavigate()

    const [githubReturn] = useState(() => ({
        installationId: search.installationId ?? '',
        setupAction: search.setupAction ?? '',
        githubState: search.githubState ?? '',
    }))

    useEffect(() => {
        if (!search.installationId && !search.setupAction && !search.githubState) return
        void navigate({ search: {}, replace: true })
    }, [navigate, search.installationId, search.setupAction, search.githubState])

    const userQuery = useQuery({
        queryKey: roomQueryKey.authUser,
        queryFn: () => currentUserServer(),
        staleTime: 5 * 60_000,
    })
    const user = userQuery.data
    const activeSection = useActiveSection(sectionIds)

    return (
        <Page
            width="lg"
            header={
                <PageHeader
                    eyebrow="Workspace"
                    glyph={<SettingsIcon className="size-6 text-muted-foreground" />}
                    title="Settings"
                    subtitle="Your account, appearance, usage, and everything your rooms can do."
                />
            }
            subnav={<SectionNav active={activeSection} />}
        >
            <div className="flex flex-col gap-10">
                <section id="account" className="scroll-mt-40 space-y-3">
                    <Section
                        title="Account"
                        description="The signed-in operator for this workspace."
                    >
                        {userQuery.isLoading ? (
                            <LoadingRows count={2} />
                        ) : (
                            <KeyValueList
                                items={[
                                    { label: 'Email', value: user?.email ?? 'Unknown' },
                                    {
                                        label: 'Role',
                                        value: user ? roleLabel(user.role) : 'Account',
                                    },
                                ]}
                            />
                        )}
                    </Section>
                </section>

                <section id="appearance" className="scroll-mt-40 space-y-3">
                    <Section
                        title="Appearance"
                        description="Choose how Agent Room looks on this device."
                    >
                        <ThemeControl />
                    </Section>
                </section>

                <section id="usage" className="scroll-mt-40 space-y-3">
                    <div className="space-y-0.5">
                        <h2 className="text-base font-semibold tracking-tight text-foreground">
                            Usage & billing
                        </h2>
                        <p className="text-sm text-muted-foreground">
                            What your rooms have used across the whole workspace.
                        </p>
                    </div>
                    <UsageBillingSection hosted={hosted} />
                </section>

                <section id="advanced" className="scroll-mt-40 space-y-3">
                    <div className="space-y-0.5">
                        <h2 className="text-base font-semibold tracking-tight text-foreground">
                            Providers & integrations
                        </h2>
                        <p className="text-sm text-muted-foreground">
                            AI models, connected tools, GitHub, and runtime defaults. Changes here
                            apply across every room.
                        </p>
                    </div>
                    <ProvidersIntegrationsSection githubReturn={githubReturn} />
                </section>
            </div>
        </Page>
    )
}
