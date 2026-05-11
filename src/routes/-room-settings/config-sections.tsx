import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
    BriefcaseBusinessIcon,
    Code2Icon,
    GitBranchIcon,
    GlobeIcon,
    ImageIcon,
    PlugIcon,
    RefreshCwIcon,
} from 'lucide-react'
import {
    AttentionBanner,
    EmptyState,
    LoadingRows,
    Section,
    StateBadge,
} from '#/components/agent-room'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Textarea } from '#/components/ui/textarea'
import { Switch } from '#/components/ui/switch'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '#/components/ui/select'
import { describeProviderStatus } from '#/lib/state'
import { CAPABILITY_OPTIONS, type CapabilityOption } from '#/lib/capabilities'
import { imageModelOptionsForProvider, providerModelOptionsForProvider } from '#/lib/model-options'
import {
    getOperatorConfigServer,
    listGitHubInstallationRepositoriesServer,
    refreshGitHubInstallationsServer,
    saveRoomConfigServer,
} from '#/routes/-operator-config-server'
import type {
    OperatorConfigSnapshot,
    ProviderConnectionSummary,
    RoomConfigSnapshot,
} from '#/server/configuration/operator-configuration'
import type { ProviderApi, RoomMode } from '#/server/domain/types'
import type { ConfigDraft, ProviderMode } from './model'
import { COMMON_TIMEZONES, ROOM_MODES, configFromSnapshot, configsEqual } from './model'
import { CodexOAuthSection } from './codex-oauth-section'
import { ModeRadio, ModelSelect, SaveBar } from './shared'

export function ConfigSections({
    roomId,
    snapshot,
    loading,
    onSaved,
}: {
    roomId: string
    snapshot: RoomConfigSnapshot | null
    loading: boolean
    onSaved: () => Promise<void>
}) {
    const operatorQuery = useQuery({
        queryKey: ['operator-config'],
        queryFn: () => getOperatorConfigServer(),
        staleTime: 30_000,
    })

    const [draft, setDraft] = useState<ConfigDraft | null>(null)

    useEffect(() => {
        if (snapshot) {
            setDraft(configFromSnapshot(snapshot))
        }
    }, [snapshot])

    const baseline = useMemo(() => (snapshot ? configFromSnapshot(snapshot) : null), [snapshot])

    const dirty = draft !== null && baseline !== null && !configsEqual(draft, baseline)

    const mutation = useMutation({
        mutationFn: (input: ConfigDraft) =>
            saveRoomConfigServer({
                data: {
                    roomId,
                    instructions: input.instructions,
                    providerMode: input.providerMode,
                    providerConnectionId:
                        input.providerMode === 'app_connection'
                            ? input.providerConnectionId || null
                            : null,
                    provider:
                        input.providerMode === 'room_secret' ? input.provider.trim() || null : null,
                    providerApi: input.providerMode === 'room_secret' ? input.providerApi : null,
                    providerBaseUrl:
                        input.providerMode === 'room_secret'
                            ? input.providerBaseUrl.trim() || null
                            : null,
                    providerModel:
                        input.providerMode === 'room_secret'
                            ? input.providerModel.trim() || null
                            : null,
                    providerApiKey:
                        input.providerMode === 'room_secret' && input.providerApiKey
                            ? input.providerApiKey
                            : undefined,
                    roomMode: input.roomMode,
                    capabilityOverrides: input.capabilityOverrides,
                    imageProvider: input.imageProvider === 'inherit' ? null : input.imageProvider,
                    imageModel:
                        input.imageProvider === 'inherit' ? null : input.imageModel.trim() || null,
                    imageApiKey: input.imageApiKey || undefined,
                    cronTimezone: input.cronTimezone,
                    mcpConnectionIds: input.mcpConnectionIds,
                    githubEnabled: input.roomMode === 'programmer' && input.githubEnabled,
                    githubInstallationId:
                        input.roomMode === 'programmer' ? input.githubInstallationId || null : null,
                    githubRepositories:
                        input.roomMode === 'programmer' ? input.githubRepositories : [],
                },
            }),
        onSuccess: async () => {
            await onSaved()
            toast.success('Room settings saved')
        },
        onError: (e: unknown) =>
            toast.error('Could not save room settings', {
                description: e instanceof Error ? e.message : 'Unexpected error',
            }),
    })

    const providers = snapshot?.providers ?? operatorQuery.data?.providers ?? []
    const mcpConnections = snapshot?.mcpConnections ?? operatorQuery.data?.mcpConnections ?? []

    const handleSave = () => {
        if (!draft || !dirty || mutation.isPending) return
        mutation.mutate(draft)
    }

    if (loading || !draft) {
        return (
            <Section title="Configuration" description="Loading current configuration.">
                <LoadingRows count={4} />
            </Section>
        )
    }

    const effectiveProvider = resolveEffectiveProvider({
        providerMode: draft.providerMode,
        providerConnectionId: draft.providerConnectionId,
        providers,
        operatorDefaultId: operatorQuery.data?.settings.defaultProviderConnectionId ?? null,
    })
    const effectiveApi: ProviderApi | null =
        draft.providerMode === 'room_secret' ? draft.providerApi : (effectiveProvider?.api ?? null)
    const effectiveAuthMode: 'api_key' | 'oauth' | null =
        draft.providerMode === 'room_secret' ? 'api_key' : (effectiveProvider?.authMode ?? null)
    const showCodexSection =
        effectiveApi === 'openai-codex-responses' && effectiveAuthMode === 'oauth'

    return (
        <>
            <Section
                title="Instructions"
                description="System instructions sent to every agent in this room."
                actions={<SaveBar dirty={dirty} pending={mutation.isPending} onSave={handleSave} />}
            >
                <Textarea
                    rows={8}
                    value={draft.instructions}
                    onChange={(e) =>
                        setDraft((prev) =>
                            prev ? { ...prev, instructions: e.target.value } : prev,
                        )
                    }
                    placeholder="Tell agents in this room how to behave."
                />
            </Section>

            <ModelSection
                draft={draft}
                providers={providers}
                providerCatalog={operatorQuery.data?.providerCatalog ?? []}
                onChange={(patch) => setDraft((prev) => (prev ? { ...prev, ...patch } : prev))}
                onSave={handleSave}
                dirty={dirty}
                pending={mutation.isPending}
            />

            {showCodexSection ? <CodexOAuthSection roomId={roomId} /> : null}

            <RoomModeSection
                draft={draft}
                onChange={(roomMode) => setDraft((prev) => (prev ? { ...prev, roomMode } : prev))}
                onSave={handleSave}
                dirty={dirty}
                pending={mutation.isPending}
            />

            <CapabilitiesSection
                draft={draft}
                appDefaults={operatorQuery.data?.settings.capabilityDefaults ?? null}
                appImage={operatorQuery.data?.settings.image ?? null}
                effectiveCapabilities={snapshot?.effective.capabilities ?? null}
                searchReady={snapshot?.effective.searchReady ?? false}
                imageReady={snapshot?.effective.imageReady ?? false}
                onChange={(patch) => setDraft((prev) => (prev ? { ...prev, ...patch } : prev))}
                onSave={handleSave}
                dirty={dirty}
                pending={mutation.isPending}
            />

            {draft.roomMode === 'programmer' ? (
                <GitHubSection
                    draft={draft}
                    github={operatorQuery.data?.github ?? snapshot?.github ?? null}
                    onChange={(patch) => setDraft((prev) => (prev ? { ...prev, ...patch } : prev))}
                    onSave={handleSave}
                    dirty={dirty}
                    pending={mutation.isPending}
                />
            ) : null}

            <Section
                title="Connected tools (MCP)"
                description="Pick which MCP servers this room can use."
                actions={<SaveBar dirty={dirty} pending={mutation.isPending} onSave={handleSave} />}
                bodyClassName={mcpConnections.length === 0 ? 'p-4' : 'p-0'}
            >
                {mcpConnections.length === 0 ? (
                    <EmptyState
                        icon={PlugIcon}
                        title="No MCP connections yet"
                        description="Add MCP servers from app settings, then enable them here."
                    />
                ) : (
                    <ul className="divide-y divide-border/60">
                        {mcpConnections.map((connection) => {
                            const checked = draft.mcpConnectionIds.includes(connection.id)
                            const status = describeProviderStatus(connection.status)
                            return (
                                <li
                                    key={connection.id}
                                    className="flex items-center gap-3 px-4 py-3"
                                >
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <h4 className="truncate text-sm font-medium text-foreground">
                                                {connection.name}
                                            </h4>
                                            <StateBadge tone={status.tone} label={status.label} />
                                        </div>
                                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                            {connection.serverKey} · {connection.transport}
                                        </p>
                                    </div>
                                    <Switch
                                        checked={checked}
                                        onCheckedChange={(next) =>
                                            setDraft((prev) => {
                                                if (!prev) return prev
                                                const ids = next
                                                    ? Array.from(
                                                          new Set([
                                                              ...prev.mcpConnectionIds,
                                                              connection.id,
                                                          ]),
                                                      )
                                                    : prev.mcpConnectionIds.filter(
                                                          (id) => id !== connection.id,
                                                      )
                                                return { ...prev, mcpConnectionIds: ids }
                                            })
                                        }
                                        aria-label={`Toggle ${connection.name}`}
                                    />
                                </li>
                            )
                        })}
                    </ul>
                )}
            </Section>

            <Section
                title="Job timezone"
                description="Cron jobs run on this timezone."
                actions={<SaveBar dirty={dirty} pending={mutation.isPending} onSave={handleSave} />}
            >
                <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                        <Label htmlFor="room-timezone-pick">Common zones</Label>
                        <Select
                            value={
                                COMMON_TIMEZONES.includes(draft.cronTimezone)
                                    ? draft.cronTimezone
                                    : ''
                            }
                            onValueChange={(value) =>
                                setDraft((prev) => (prev ? { ...prev, cronTimezone: value } : prev))
                            }
                        >
                            <SelectTrigger id="room-timezone-pick" className="w-full">
                                <SelectValue placeholder="Pick a timezone" />
                            </SelectTrigger>
                            <SelectContent>
                                {COMMON_TIMEZONES.map((tz) => (
                                    <SelectItem key={tz} value={tz}>
                                        {tz}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="room-timezone-custom">Or enter custom</Label>
                        <Input
                            id="room-timezone-custom"
                            value={draft.cronTimezone}
                            onChange={(e) =>
                                setDraft((prev) =>
                                    prev ? { ...prev, cronTimezone: e.target.value } : prev,
                                )
                            }
                            placeholder="UTC"
                        />
                    </div>
                </div>
            </Section>
        </>
    )
}

function resolveEffectiveProvider(input: {
    providerMode: ProviderMode
    providerConnectionId: string
    providers: ProviderConnectionSummary[]
    operatorDefaultId: string | null
}): ProviderConnectionSummary | null {
    if (input.providerMode === 'room_secret') return null
    const id =
        input.providerMode === 'app_connection'
            ? input.providerConnectionId
            : input.operatorDefaultId
    if (!id) return null
    return input.providers.find((p) => p.id === id) ?? null
}

function RoomModeSection({
    draft,
    onChange,
    onSave,
    dirty,
    pending,
}: {
    draft: ConfigDraft
    onChange: (roomMode: RoomMode) => void
    onSave: () => void
    dirty: boolean
    pending: boolean
}) {
    return (
        <Section
            title="Mode"
            description="Choose the harness shape for this room."
            actions={<SaveBar dirty={dirty} pending={pending} onSave={onSave} />}
        >
            <div className="grid gap-3 md:grid-cols-2">
                {ROOM_MODES.map((mode) => {
                    const selected = draft.roomMode === mode.value
                    const Icon = mode.value === 'programmer' ? Code2Icon : BriefcaseBusinessIcon
                    return (
                        <button
                            key={mode.value}
                            type="button"
                            onClick={() => onChange(mode.value)}
                            className={[
                                'flex min-h-28 items-start gap-3 rounded-md border p-4 text-left transition-colors',
                                selected
                                    ? 'border-primary bg-primary/10 text-foreground'
                                    : 'border-border/70 bg-background hover:bg-muted/40',
                            ].join(' ')}
                            aria-pressed={selected}
                        >
                            <span
                                className={[
                                    'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border',
                                    selected
                                        ? 'border-primary/30 bg-primary/15 text-primary'
                                        : 'border-border/70 bg-muted/40 text-muted-foreground',
                                ].join(' ')}
                            >
                                <Icon className="size-4" />
                            </span>
                            <span className="min-w-0">
                                <span className="block text-sm font-medium">{mode.label}</span>
                                <span className="mt-1 block text-sm text-muted-foreground">
                                    {mode.description}
                                </span>
                                <span className="mt-3 block text-xs text-muted-foreground">
                                    {mode.value === 'programmer'
                                        ? 'Optimized for source changes, shell commands, tests, and future GitHub auth.'
                                        : 'Optimized for broad autonomous work with durable memory and rich artifacts.'}
                                </span>
                            </span>
                        </button>
                    )
                })}
            </div>
        </Section>
    )
}

function GitHubSection({
    draft,
    github,
    onChange,
    onSave,
    dirty,
    pending,
}: {
    draft: ConfigDraft
    github: OperatorConfigSnapshot['github'] | null
    onChange: (patch: Partial<ConfigDraft>) => void
    onSave: () => void
    dirty: boolean
    pending: boolean
}) {
    const queryClient = useQueryClient()
    const installations = github?.installations ?? []
    const app = github?.app ?? null
    const selectedInstallation =
        installations.find(
            (installation) => installation.installationId === draft.githubInstallationId,
        ) ?? null
    const repositoriesQuery = useQuery({
        queryKey: ['github-installation-repositories', draft.githubInstallationId],
        queryFn: () =>
            listGitHubInstallationRepositoriesServer({
                data: {
                    installationId: draft.githubInstallationId,
                },
            }),
        enabled: draft.githubEnabled && Boolean(draft.githubInstallationId),
        staleTime: 30_000,
    })
    const refreshMutation = useMutation({
        mutationFn: () => refreshGitHubInstallationsServer(),
        onSuccess: async () => {
            toast.success('GitHub installations refreshed')
            await queryClient.invalidateQueries({ queryKey: ['operator-config'], exact: false })
        },
        onError: (error) =>
            toast.error(error instanceof Error ? error.message : 'GitHub refresh failed'),
    })
    const repositories = repositoriesQuery.data ?? []
    const toggleRepository = (repository: string, enabled: boolean) => {
        const next = enabled
            ? Array.from(new Set([...draft.githubRepositories, repository]))
            : draft.githubRepositories.filter((entry) => entry !== repository)
        onChange({ githubRepositories: next.sort((left, right) => left.localeCompare(right)) })
    }

    return (
        <Section
            title="GitHub"
            description="Room-scoped repository credentials for programmer work."
            actions={
                <div className="flex flex-wrap justify-end gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => refreshMutation.mutate()}
                        disabled={refreshMutation.isPending || !app?.configured}
                    >
                        <RefreshCwIcon
                            className={refreshMutation.isPending ? 'animate-spin' : ''}
                        />
                        Refresh
                    </Button>
                    <SaveBar dirty={dirty} pending={pending} onSave={onSave} />
                </div>
            }
        >
            {!app?.configured ? (
                <EmptyState
                    icon={GitBranchIcon}
                    title="GitHub App is not configured"
                    description="Create the first-party GitHub App in app settings before binding repositories."
                />
            ) : installations.length === 0 ? (
                <EmptyState
                    icon={GitBranchIcon}
                    title="No GitHub installations"
                    description="Install the GitHub App on repositories this programmer room should use."
                />
            ) : (
                <div className="space-y-4">
                    <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                        <div>
                            <div className="text-sm font-medium">Enable GitHub</div>
                            <div className="text-xs text-muted-foreground">
                                Credentials are materialized only for this programmer room.
                            </div>
                        </div>
                        <Switch
                            checked={draft.githubEnabled}
                            onCheckedChange={(enabled) =>
                                onChange({
                                    githubEnabled: enabled,
                                    githubInstallationId:
                                        draft.githubInstallationId ||
                                        installations[0]?.installationId ||
                                        '',
                                })
                            }
                            aria-label="Enable GitHub for this room"
                        />
                    </div>

                    {draft.githubEnabled ? (
                        <>
                            <div className="space-y-1.5">
                                <Label htmlFor="github-installation">Installation</Label>
                                <Select
                                    value={draft.githubInstallationId}
                                    onValueChange={(installationId) =>
                                        onChange({
                                            githubInstallationId: installationId,
                                            githubRepositories: [],
                                        })
                                    }
                                >
                                    <SelectTrigger id="github-installation" className="w-full">
                                        <SelectValue placeholder="Pick an installation" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {installations.map((installation) => {
                                            const status = describeProviderStatus(
                                                installation.status,
                                            )
                                            return (
                                                <SelectItem
                                                    key={installation.installationId}
                                                    value={installation.installationId}
                                                >
                                                    {installation.accountLogin} · {status.label}
                                                </SelectItem>
                                            )
                                        })}
                                    </SelectContent>
                                </Select>
                            </div>

                            {selectedInstallation ? (
                                <div className="space-y-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <StateBadge
                                            tone={
                                                describeProviderStatus(selectedInstallation.status)
                                                    .tone
                                            }
                                            label={
                                                describeProviderStatus(selectedInstallation.status)
                                                    .label
                                            }
                                        />
                                        <span className="text-xs text-muted-foreground">
                                            {selectedInstallation.repositorySelection} repositories
                                        </span>
                                    </div>
                                    {repositoriesQuery.isLoading ? (
                                        <LoadingRows count={3} />
                                    ) : repositoriesQuery.isError ? (
                                        <AttentionBanner
                                            tone="danger"
                                            title="Could not load repositories"
                                            description={
                                                repositoriesQuery.error instanceof Error
                                                    ? repositoriesQuery.error.message
                                                    : 'Unexpected GitHub repository error'
                                            }
                                        />
                                    ) : repositories.length === 0 ? (
                                        <EmptyState
                                            icon={GitBranchIcon}
                                            title="No repositories available"
                                            description="Update the GitHub App installation to include at least one repository."
                                        />
                                    ) : (
                                        <ul className="max-h-72 divide-y divide-border/60 overflow-auto rounded-md border">
                                            {repositories.map((repository) => {
                                                const checked = draft.githubRepositories.includes(
                                                    repository.fullName,
                                                )
                                                return (
                                                    <li
                                                        key={repository.id}
                                                        className="flex items-center gap-3 px-4 py-3"
                                                    >
                                                        <div className="min-w-0 flex-1">
                                                            <div className="truncate text-sm font-medium">
                                                                {repository.fullName}
                                                            </div>
                                                            <div className="text-xs text-muted-foreground">
                                                                {repository.private
                                                                    ? 'Private'
                                                                    : 'Public'}
                                                                {repository.defaultBranch
                                                                    ? ` · ${repository.defaultBranch}`
                                                                    : ''}
                                                            </div>
                                                        </div>
                                                        <Switch
                                                            checked={checked}
                                                            onCheckedChange={(enabled) =>
                                                                toggleRepository(
                                                                    repository.fullName,
                                                                    enabled,
                                                                )
                                                            }
                                                            aria-label={`Toggle ${repository.fullName}`}
                                                        />
                                                    </li>
                                                )
                                            })}
                                        </ul>
                                    )}
                                </div>
                            ) : null}
                        </>
                    ) : null}
                </div>
            )}
        </Section>
    )
}

function ModelSection({
    draft,
    providers,
    providerCatalog,
    onChange,
    onSave,
    dirty,
    pending,
}: {
    draft: ConfigDraft
    providers: ProviderConnectionSummary[]
    providerCatalog: OperatorConfigSnapshot['providerCatalog']
    onChange: (patch: Partial<ConfigDraft>) => void
    onSave: () => void
    dirty: boolean
    pending: boolean
}) {
    const roomSecretProviders = providerCatalog.filter(
        (entry) => entry.api !== 'openai-codex-responses',
    )
    const roomSecretProviderOptions = roomSecretProviders.map((entry) => ({
        value: entry.provider,
        label: entry.label,
    }))
    const providerApiOptions = [
        ...new Map(
            roomSecretProviders.map((entry) => [
                entry.api,
                {
                    value: entry.api,
                    label: entry.api === 'openai-completions' ? 'OpenAI compatible' : entry.api,
                },
            ]),
        ).values(),
    ]
    const firstRoomSecretProvider = roomSecretProviders[0] ?? null
    const providerModelOptions = providerModelOptionsForProvider({
        provider: draft.provider,
        currentModel: draft.providerModel,
        providerCatalog,
    })
    return (
        <Section
            title="Model"
            description="Where this room sends prompts."
            actions={<SaveBar dirty={dirty} pending={pending} onSave={onSave} />}
        >
            <div className="space-y-4">
                <fieldset className="grid gap-2 sm:grid-cols-3">
                    <ModeRadio
                        label="App default"
                        description="Use the operator's default provider."
                        checked={draft.providerMode === 'app_default'}
                        onSelect={() => onChange({ providerMode: 'app_default' })}
                    />
                    <ModeRadio
                        label="App connection"
                        description="Use a saved provider connection."
                        checked={draft.providerMode === 'app_connection'}
                        onSelect={() => onChange({ providerMode: 'app_connection' })}
                    />
                    <ModeRadio
                        label="Room key"
                        description="Use a key just for this room."
                        checked={draft.providerMode === 'room_secret'}
                        onSelect={() =>
                            onChange({
                                providerMode: 'room_secret',
                                provider: draft.provider || firstRoomSecretProvider?.provider || '',
                                providerApi: firstRoomSecretProvider?.api ?? draft.providerApi,
                                providerModel:
                                    draft.providerModel || firstRoomSecretProvider?.model || '',
                            })
                        }
                    />
                </fieldset>

                {draft.providerMode === 'app_connection' ? (
                    <div className="space-y-1.5">
                        <Label htmlFor="room-provider-connection">Saved connection</Label>
                        {providers.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                                No app provider connections yet. Add one in app settings first.
                            </p>
                        ) : (
                            <Select
                                value={draft.providerConnectionId || ''}
                                onValueChange={(value) => onChange({ providerConnectionId: value })}
                            >
                                <SelectTrigger id="room-provider-connection" className="w-full">
                                    <SelectValue placeholder="Pick a connection" />
                                </SelectTrigger>
                                <SelectContent>
                                    {providers.map((provider) => {
                                        const status = describeProviderStatus(provider.status)
                                        return (
                                            <SelectItem key={provider.id} value={provider.id}>
                                                {provider.label} · {provider.provider} ·{' '}
                                                {status.label}
                                            </SelectItem>
                                        )
                                    })}
                                </SelectContent>
                            </Select>
                        )}
                    </div>
                ) : null}

                {draft.providerMode === 'room_secret' ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label htmlFor="room-provider">Provider</Label>
                            <Select
                                value={draft.provider}
                                onValueChange={(value) => {
                                    const selected = roomSecretProviders.find(
                                        (entry) => entry.provider === value,
                                    )
                                    onChange({
                                        provider: value,
                                        providerApi: selected?.api ?? draft.providerApi,
                                        providerModel: selected?.model ?? draft.providerModel,
                                    })
                                }}
                            >
                                <SelectTrigger id="room-provider" className="w-full">
                                    <SelectValue placeholder="Pick a provider" />
                                </SelectTrigger>
                                <SelectContent>
                                    {roomSecretProviderOptions.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="room-provider-api">Provider API</Label>
                            <Select
                                value={draft.providerApi}
                                onValueChange={(value) =>
                                    onChange({ providerApi: value as ProviderApi })
                                }
                            >
                                <SelectTrigger id="room-provider-api" className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {providerApiOptions.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="room-provider-base-url">Base URL</Label>
                            <Input
                                id="room-provider-base-url"
                                value={draft.providerBaseUrl}
                                onChange={(e) => onChange({ providerBaseUrl: e.target.value })}
                                placeholder="Optional"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="room-provider-model">Default model</Label>
                            <ModelSelect
                                id="room-provider-model"
                                value={draft.providerModel}
                                onChange={(providerModel) => onChange({ providerModel })}
                                options={providerModelOptions}
                            />
                        </div>
                        <div className="space-y-1.5 sm:col-span-2">
                            <Label htmlFor="room-provider-key">API key</Label>
                            <Input
                                id="room-provider-key"
                                type="password"
                                value={draft.providerApiKey}
                                onChange={(e) => onChange({ providerApiKey: e.target.value })}
                                placeholder={
                                    draft.providerApiKey
                                        ? ''
                                        : 'Leave blank to keep the existing masked key'
                                }
                                autoComplete="off"
                            />
                            <p className="text-xs text-muted-foreground">
                                Write-only. Once saved, the value can be replaced but never read
                                back.
                            </p>
                        </div>
                    </div>
                ) : null}
            </div>
        </Section>
    )
}

function capabilityValue(input: {
    draft: ConfigDraft
    option: CapabilityOption
    appDefaults: OperatorConfigSnapshot['settings']['capabilityDefaults'] | null
    effectiveCapabilities: RoomConfigSnapshot['effective']['capabilities'] | null
}): boolean {
    const override =
        input.draft.capabilityOverrides[input.option.id] ??
        input.draft.capabilityOverrides[input.option.key]
    if (typeof override === 'boolean') return override
    if (input.draft.roomMode === 'programmer') {
        if (
            input.option.id === 'documents' ||
            input.option.id === 'spreadsheets' ||
            input.option.id === 'presentations' ||
            input.option.id === 'pdf' ||
            input.option.id === 'images'
        ) {
            return false
        }
        if (
            input.option.id === 'web_search' ||
            input.option.id === 'url_fetch' ||
            input.option.id === 'shell_coding'
        ) {
            return true
        }
    }
    if (input.appDefaults && typeof input.appDefaults[input.option.id] === 'boolean') {
        return input.appDefaults[input.option.id]
    }
    return input.effectiveCapabilities?.[input.option.key] ?? false
}

function CapabilitiesSection({
    draft,
    appDefaults,
    appImage,
    effectiveCapabilities,
    searchReady,
    imageReady,
    onChange,
    onSave,
    dirty,
    pending,
}: {
    draft: ConfigDraft
    appDefaults: OperatorConfigSnapshot['settings']['capabilityDefaults'] | null
    appImage: OperatorConfigSnapshot['settings']['image'] | null
    effectiveCapabilities: RoomConfigSnapshot['effective']['capabilities'] | null
    searchReady: boolean
    imageReady: boolean
    onChange: (patch: Partial<ConfigDraft>) => void
    onSave: () => void
    dirty: boolean
    pending: boolean
}) {
    const setCapability = (option: CapabilityOption, next: boolean) => {
        const overrides = { ...draft.capabilityOverrides, [option.id]: next }
        if (appDefaults && appDefaults[option.id] === next) {
            delete overrides[option.id]
        }
        delete overrides[option.key]
        onChange({ capabilityOverrides: overrides })
    }
    const inheritedImage =
        appImage?.provider && appImage.model ? `${appImage.provider} - ${appImage.model}` : 'None'
    const imageConfigured = draft.imageProvider !== 'inherit'
    const programmerMode = draft.roomMode === 'programmer'
    const visibleOptions = programmerMode
        ? CAPABILITY_OPTIONS.filter(
              (option) =>
                  option.id === 'web_search' ||
                  option.id === 'url_fetch' ||
                  option.id === 'mcp' ||
                  option.id === 'shell_coding',
          )
        : CAPABILITY_OPTIONS
    const roomImageModelOptions =
        draft.imageProvider === 'inherit'
            ? []
            : imageModelOptionsForProvider(draft.imageProvider, draft.imageModel)

    return (
        <Section
            title="Capabilities"
            description={
                programmerMode
                    ? 'Programmer mode keeps the harness focused on source work.'
                    : 'Built-in room features and provider-backed image generation.'
            }
            actions={<SaveBar dirty={dirty} pending={pending} onSave={onSave} />}
        >
            <div className="space-y-4">
                <div className="grid gap-2 sm:grid-cols-2">
                    {visibleOptions.map((option) => {
                        const checked = capabilityValue({
                            draft,
                            option,
                            appDefaults,
                            effectiveCapabilities,
                        })
                        const inherited =
                            !programmerMode &&
                            appDefaults &&
                            draft.capabilityOverrides[option.id] === undefined
                        return (
                            <label
                                key={option.id}
                                className="flex items-start justify-between gap-3 rounded-lg border border-border/60 px-3 py-2.5"
                            >
                                <span className="min-w-0">
                                    <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                                        {option.id === 'images' ? (
                                            <ImageIcon className="size-4 text-muted-foreground" />
                                        ) : option.id === 'web_search' ||
                                          option.id === 'url_fetch' ? (
                                            <GlobeIcon className="size-4 text-muted-foreground" />
                                        ) : (
                                            <PlugIcon className="size-4 text-muted-foreground" />
                                        )}
                                        {option.label}
                                    </span>
                                    <span className="mt-0.5 block text-xs text-muted-foreground">
                                        {option.description}
                                    </span>
                                    {inherited ? (
                                        <span className="mt-1 block text-[0.7rem] uppercase tracking-wide text-muted-foreground">
                                            App default
                                        </span>
                                    ) : null}
                                </span>
                                <Switch
                                    checked={checked}
                                    onCheckedChange={(next) => setCapability(option, next)}
                                    aria-label={`Toggle ${option.label}`}
                                />
                            </label>
                        )
                    })}
                </div>

                {!programmerMode ? (
                    <div className="rounded-lg border border-border/60 p-3">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <div className="text-sm font-medium text-foreground">
                                    Image provider
                                </div>
                                <div className="text-xs text-muted-foreground">
                                    App default: {inheritedImage}. Room keys are write-only.
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <StateBadge
                                    tone={searchReady ? 'ready' : 'muted'}
                                    label={searchReady ? 'Search ready' : 'Search off'}
                                />
                                <StateBadge
                                    tone={imageReady ? 'ready' : 'muted'}
                                    label={imageReady ? 'Images ready' : 'Images not ready'}
                                />
                            </div>
                        </div>
                        <div className="mt-3 grid gap-3 sm:grid-cols-3">
                            <div className="space-y-1.5">
                                <Label htmlFor="room-image-provider">Provider</Label>
                                <Select
                                    value={draft.imageProvider}
                                    onValueChange={(value) => {
                                        const imageProvider = value as ConfigDraft['imageProvider']
                                        const options =
                                            imageProvider === 'inherit'
                                                ? []
                                                : imageModelOptionsForProvider(imageProvider)
                                        onChange({
                                            imageProvider,
                                            imageModel:
                                                imageProvider === 'inherit'
                                                    ? ''
                                                    : (options[0]?.value ?? ''),
                                            imageApiKey:
                                                imageProvider === 'inherit'
                                                    ? ''
                                                    : draft.imageApiKey,
                                        })
                                    }}
                                >
                                    <SelectTrigger id="room-image-provider" className="w-full">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="inherit">Use app default</SelectItem>
                                        <SelectItem value="openai">OpenAI Images</SelectItem>
                                        <SelectItem value="gemini">Gemini Images</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="room-image-model">Image model</Label>
                                {imageConfigured ? (
                                    <ModelSelect
                                        id="room-image-model"
                                        value={draft.imageModel}
                                        onChange={(imageModel) => onChange({ imageModel })}
                                        options={roomImageModelOptions}
                                    />
                                ) : (
                                    <div className="flex min-h-10 items-center rounded-md border border-border bg-muted/30 px-3 text-sm text-muted-foreground">
                                        {appImage?.model ?? 'Use app default'}
                                    </div>
                                )}
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="room-image-key">Image API key</Label>
                                <Input
                                    id="room-image-key"
                                    type="password"
                                    value={draft.imageApiKey}
                                    onChange={(e) => onChange({ imageApiKey: e.target.value })}
                                    disabled={!imageConfigured}
                                    placeholder="Leave blank to keep saved key"
                                    autoComplete="off"
                                />
                            </div>
                        </div>
                    </div>
                ) : null}

                <div className="flex justify-end">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onChange({ capabilityOverrides: {} })}
                        disabled={Object.keys(draft.capabilityOverrides).length === 0 || pending}
                    >
                        Use mode defaults
                    </Button>
                </div>
            </div>
        </Section>
    )
}
