import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { MonitorIcon, MoonIcon, SettingsIcon, SlidersHorizontalIcon, SunIcon } from 'lucide-react'
import {
    AttentionBanner,
    KeyValueList,
    LoadingRows,
    Page,
    PageHeader,
    Section,
    StateBadge,
    ThemeChoice,
    type KeyValueItem,
} from '#/components/agent-room'
import { Button } from '#/components/ui/button'
import { describeWebAccessReadiness, type Tone } from '#/domain/state'
import { useThemeMode } from '#/lib/theme'
import { roomQueryKey } from '#/lib/room-query-keys'
import { currentUserServer } from './-auth-server'
import { getOperatorConfigServer } from './-operator-config-server'
import { useHostedDeployment } from '#/components/app-shell/nav-config'
import type { OperatorConfigSnapshot } from '#/server/configuration/operator-configuration'
import { requireRouteUser } from './-route-auth'

export const Route = createFileRoute('/settings')({
    beforeLoad: requireRouteUser,
    component: SettingsPage,
})

interface AiAccessSummary {
    label: string
    tone: Tone
    detail: string
}

function describeAiAccess(config: OperatorConfigSnapshot): AiAccessSummary {
    if (config.onboarding.managedOpenRouterAvailable === true) {
        return {
            label: 'Included',
            tone: 'ready',
            detail: 'Your workspace includes managed AI credits, so rooms work without setup.',
        }
    }
    if (config.settings.defaultProviderConnectionId) {
        return {
            label: 'Connected',
            tone: 'ready',
            detail: 'Rooms use the AI access configured for your workspace.',
        }
    }
    return {
        label: 'Setup required',
        tone: 'attention',
        detail: 'No AI access is set up yet. Add it in the Operator console to start using rooms.',
    }
}

const operatorSearch = { installationId: '', setupAction: '', githubState: '' }

function SettingsPage() {
    const [themeMode, setThemeMode] = useThemeMode()
    const hosted = useHostedDeployment()

    const userQuery = useQuery({
        queryKey: roomQueryKey.authUser,
        queryFn: () => currentUserServer(),
        staleTime: 5 * 60_000,
    })
    const configQuery = useQuery<OperatorConfigSnapshot>({
        queryKey: roomQueryKey.operatorConfig,
        queryFn: () => getOperatorConfigServer(),
    })

    const user = userQuery.data
    const config = configQuery.data

    const aiAccess = config ? describeAiAccess(config) : null
    const webAccess = config
        ? describeWebAccessReadiness({
              enabled: config.settings.search.enabled,
              hasBackend: config.settings.search.backendUrl.trim().length > 0,
              hasCredential:
                  config.settings.search.brave.hasCredential ||
                  config.settings.search.browserbase.hasCredential,
          })
        : null
    const webAccessEnabled = config?.settings.search.enabled ?? false
    const toolCount = config?.mcpConnections.length ?? 0
    const githubConnected = config?.github.app.configured ?? false

    const summaryItems: KeyValueItem[] = config
        ? [
              {
                  label: 'AI access',
                  value: aiAccess ? (
                      <StateBadge tone={aiAccess.tone} label={aiAccess.label} />
                  ) : null,
                  hint: aiAccess?.detail,
              },
              {
                  label: 'Web access',
                  value: webAccess ? (
                      <StateBadge
                          tone={webAccessEnabled ? webAccess.tone : 'muted'}
                          label={webAccessEnabled ? 'Included' : 'Off'}
                      />
                  ) : null,
                  hint: 'Rooms can search and read public web pages.',
              },
              {
                  label: 'Connected tools',
                  value: toolCount > 0 ? `${toolCount} available` : 'None connected',
              },
              {
                  label: 'Integrations',
                  value: (
                      <StateBadge
                          tone={githubConnected ? 'ready' : 'muted'}
                          label={githubConnected ? 'Connected' : 'Not set up'}
                      />
                  ),
                  hint: 'Code and repository access for programmer rooms.',
              },
          ]
        : []

    return (
        <Page
            width="md"
            header={
                <PageHeader
                    eyebrow="Workspace"
                    glyph={<SettingsIcon className="size-6 text-muted-foreground" />}
                    title="Settings"
                    subtitle="Your account, appearance, and a summary of what your rooms can do."
                />
            }
        >
            <div className="flex flex-col gap-5">
                <Section title="Account" description="The signed-in operator for this workspace.">
                    {userQuery.isLoading ? (
                        <LoadingRows count={2} />
                    ) : (
                        <KeyValueList
                            items={[
                                { label: 'Email', value: user?.email ?? 'Unknown' },
                                {
                                    label: 'Role',
                                    value: user
                                        ? user.role === 'root'
                                            ? 'Root operator'
                                            : 'Operator'
                                        : 'Account',
                                },
                            ]}
                        />
                    )}
                </Section>

                <Section
                    title="Appearance"
                    description="Choose how Agent Room looks on this device."
                >
                    <div className="grid gap-2 sm:grid-cols-3">
                        <ThemeChoice
                            active={themeMode === 'light'}
                            icon={<SunIcon className="size-4" />}
                            label="Light"
                            onClick={() => setThemeMode('light')}
                        />
                        <ThemeChoice
                            active={themeMode === 'dark'}
                            icon={<MoonIcon className="size-4" />}
                            label="Dark"
                            onClick={() => setThemeMode('dark')}
                        />
                        <ThemeChoice
                            active={themeMode === 'system'}
                            icon={<MonitorIcon className="size-4" />}
                            label="System"
                            onClick={() => setThemeMode('system')}
                        />
                    </div>
                </Section>

                <Section
                    title="What your rooms can do"
                    description="A read-only summary of the access shared by every room."
                    actions={
                        <Button asChild variant="outline" size="sm">
                            <Link to="/operator" search={operatorSearch}>
                                <SlidersHorizontalIcon />
                                Manage in Operator console
                            </Link>
                        </Button>
                    }
                >
                    {configQuery.isLoading ? (
                        <LoadingRows count={4} />
                    ) : configQuery.isError ? (
                        <AttentionBanner
                            tone="danger"
                            title="Could not load your workspace summary"
                            description="Retry, or open the Operator console to review configuration directly."
                            action={
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => configQuery.refetch()}
                                    disabled={configQuery.isFetching}
                                >
                                    {configQuery.isFetching ? 'Retrying...' : 'Retry'}
                                </Button>
                            }
                        />
                    ) : (
                        <div className="space-y-4">
                            {aiAccess && aiAccess.tone === 'attention' ? (
                                <AttentionBanner
                                    tone="attention"
                                    title="Finish AI setup"
                                    description={aiAccess.detail}
                                    action={
                                        <Button asChild variant="outline" size="sm">
                                            <Link to="/operator" search={operatorSearch}>
                                                Open Operator console
                                            </Link>
                                        </Button>
                                    }
                                />
                            ) : null}
                            <KeyValueList items={summaryItems} />
                            <p className="text-xs text-muted-foreground">
                                Provider connections, connected tools, integrations, and runtime
                                defaults are managed in the Operator console.
                            </p>
                        </div>
                    )}
                </Section>

                {hosted ? (
                    <Section
                        title="Plan and usage"
                        description="Heavier work like web search and image generation draws from your credits."
                        actions={
                            <Button asChild variant="outline" size="sm">
                                <Link to="/billing" search={{ checkout: null }}>
                                    View billing
                                </Link>
                            </Button>
                        }
                    >
                        <p className="text-sm text-muted-foreground">
                            Everyday chatting is included. See billing for your credit balance,
                            recent usage, and ways to add more.
                        </p>
                    </Section>
                ) : null}
            </div>
        </Page>
    )
}
