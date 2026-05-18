import { Link } from '@tanstack/react-router'
import { useState, type Dispatch, type SetStateAction } from 'react'
import {
    ExternalLinkIcon,
    GitBranchIcon,
    GlobeIcon,
    ImageIcon,
    PlugIcon,
    RefreshCwIcon,
    Trash2Icon,
    UserRoundIcon,
    WrenchIcon,
} from 'lucide-react'

import {
    AttentionBanner,
    BrandMark,
    EmptyState,
    LoadingRows,
    Section,
    StateBadge,
} from '#/components/agent-room'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '#/components/ui/dialog'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '#/components/ui/select'
import { Switch } from '#/components/ui/switch'
import { CAPABILITY_OPTIONS } from '#/lib/capabilities'
import { formatRelativeTime } from '#/lib/format'
import { imageModelOptionsForProvider } from '#/lib/model-options'
import { describeProviderStatus } from '#/lib/state'
import type {
    McpConnectionSummary,
    OperatorConfigSnapshot,
    ProviderConnectionSummary,
} from '#/server/configuration/operator-configuration'

import {
    ChipBadge,
    ConnectionRow,
    ConnectionsSection,
    FieldGroup,
    MaskedSecretField,
    ModelSelectField,
    type DeleteConnectionTarget,
} from './-forms'

export type AppCapabilityDefaults = OperatorConfigSnapshot['settings']['capabilityDefaults']
export type AppImageProvider = 'none' | 'openai' | 'gemini'
export type AppSearchSafeSearch =
    OperatorConfigSnapshot['settings']['search']['brave']['safeSearch']

export interface AppSearchDraft {
    enabled: boolean
    backendUrl: string
    defaultResultCount: number
    timeoutMs: number
    maxSearchesPerRun: number
    brave: {
        enabled: boolean
        country: string
        searchLang: string
        safeSearch: AppSearchSafeSearch
        timeoutMs: number
        resultCount: number
        apiKey: string
        hasCredential: boolean
        replaceApiKey: boolean
    }
    browserbase: {
        enabled: boolean
        timeoutMs: number
        resultCount: number
        apiKey: string
        hasCredential: boolean
        replaceApiKey: boolean
    }
}

export function GitHubAppSection({
    config,
    publicOrigin,
    targetOwner,
    setupPending,
    accountConnectPending,
    refreshPending,
    disconnectAccountPending,
    resetPending,
    onChangePublicOrigin,
    onChangeTargetOwner,
    onStartSetup,
    onConnectAccount,
    onRefresh,
    onDisconnectAccount,
    onReset,
}: {
    config: OperatorConfigSnapshot | undefined
    publicOrigin: string
    targetOwner: string
    setupPending: boolean
    accountConnectPending: boolean
    refreshPending: boolean
    disconnectAccountPending: boolean
    resetPending: boolean
    onChangePublicOrigin: (value: string) => void
    onChangeTargetOwner: (value: string) => void
    onStartSetup: () => void
    onConnectAccount: () => void
    onRefresh: () => void
    onDisconnectAccount: () => void
    onReset: () => void
}) {
    const [resetOpen, setResetOpen] = useState(false)
    const github = config?.github
    const app = github?.app
    const configured = app?.configured ?? false
    const installations = github?.installations ?? []
    const accounts = github?.accounts ?? []
    const user = github?.user
    const connected = user?.connected ?? false
    return (
        <>
            <Section
                title="GitHub"
                description="Connect accounts and install the room-scoped GitHub App."
                actions={
                    configured ? (
                        <div className="flex flex-wrap justify-end gap-2">
                            {app?.htmlUrl ? (
                                <Button type="button" size="sm" variant="outline" asChild>
                                    <a href={app.htmlUrl} target="_blank" rel="noreferrer">
                                        <ExternalLinkIcon />
                                        App
                                    </a>
                                </Button>
                            ) : null}
                            {app?.installUrl ? (
                                <Button type="button" size="sm" asChild>
                                    <a href={app.installUrl}>
                                        <ExternalLinkIcon />
                                        Add account
                                    </a>
                                </Button>
                            ) : null}
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={onRefresh}
                                disabled={refreshPending || resetPending}
                            >
                                <RefreshCwIcon className={refreshPending ? 'animate-spin' : ''} />
                                Refresh
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => setResetOpen(true)}
                                disabled={resetPending}
                            >
                                <Trash2Icon />
                                Forget
                            </Button>
                        </div>
                    ) : null
                }
            >
                {!configured ? (
                    <div className="space-y-4">
                        <AttentionBanner
                            tone="info"
                            title="Installable across GitHub accounts"
                            description="New Agent Room GitHub Apps are public so GitHub can offer your personal account and organizations during installation."
                        />
                        <div className="grid gap-3 sm:grid-cols-2">
                            <FieldGroup
                                label="Public origin"
                                htmlFor="github-public-origin"
                                hint="The URL GitHub can redirect back to after app creation."
                            >
                                <Input
                                    id="github-public-origin"
                                    value={publicOrigin}
                                    onChange={(event) => onChangePublicOrigin(event.target.value)}
                                    placeholder="https://agent-room.example.com"
                                />
                            </FieldGroup>
                            <FieldGroup
                                label="Organization owner"
                                htmlFor="github-target-owner"
                                hint="Optional owner for the GitHub App registration."
                            >
                                <Input
                                    id="github-target-owner"
                                    value={targetOwner}
                                    onChange={(event) => onChangeTargetOwner(event.target.value)}
                                    placeholder="Optional"
                                />
                            </FieldGroup>
                        </div>
                        <div className="flex justify-end">
                            <Button type="button" onClick={onStartSetup} disabled={setupPending}>
                                <GitBranchIcon />
                                {setupPending ? 'Preparing...' : 'Create GitHub App'}
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="grid gap-3 sm:grid-cols-2">
                            <FieldGroup label="App">
                                <div className="flex min-h-10 items-center rounded-md border border-border bg-muted/30 px-3 text-sm">
                                    {app?.name} · {app?.slug}
                                </div>
                            </FieldGroup>
                            <FieldGroup label="Installations">
                                <div className="flex min-h-10 items-center rounded-md border border-border bg-muted/30 px-3 text-sm">
                                    {installations.length}
                                </div>
                            </FieldGroup>
                        </div>

                        <div className="rounded-md border p-3">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-sm font-medium">GitHub account</span>
                                        {connected ? (
                                            <StateBadge
                                                tone={
                                                    user?.status === 'invalid' ? 'danger' : 'ready'
                                                }
                                                label={
                                                    user?.status === 'invalid'
                                                        ? 'Reconnect'
                                                        : 'Connected'
                                                }
                                            />
                                        ) : null}
                                    </div>
                                    <div className="mt-0.5 text-xs text-muted-foreground">
                                        {connected
                                            ? user?.login
                                                ? `Connected as ${user.login}`
                                                : 'Connected'
                                            : 'Connect GitHub to discover accounts and guide installs.'}
                                    </div>
                                    {user?.validationMessage ? (
                                        <div className="mt-1 text-xs text-destructive">
                                            {user.validationMessage}
                                        </div>
                                    ) : null}
                                </div>
                                <div className="flex flex-wrap justify-end gap-2">
                                    {connected ? (
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            onClick={onDisconnectAccount}
                                            disabled={disconnectAccountPending}
                                        >
                                            <UserRoundIcon />
                                            Disconnect
                                        </Button>
                                    ) : null}
                                    <Button
                                        type="button"
                                        size="sm"
                                        onClick={onConnectAccount}
                                        disabled={accountConnectPending}
                                    >
                                        <UserRoundIcon />
                                        {connected
                                            ? accountConnectPending
                                                ? 'Reconnecting...'
                                                : 'Reconnect GitHub'
                                            : accountConnectPending
                                              ? 'Connecting...'
                                              : 'Connect GitHub'}
                                    </Button>
                                </div>
                            </div>
                        </div>

                        {accounts.length === 0 ? (
                            <EmptyState
                                icon={GitBranchIcon}
                                title="No GitHub accounts"
                                description="Connect GitHub or install the app on accounts programmer rooms should use."
                            />
                        ) : (
                            <div className="divide-y divide-border/60 rounded-md border">
                                {accounts.map((account) => {
                                    const status = describeProviderStatus(
                                        account.installationStatus,
                                    )
                                    return (
                                        <div
                                            key={account.login}
                                            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                                        >
                                            <div className="min-w-0">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className="text-sm font-medium">
                                                        {account.login}
                                                    </span>
                                                    <ChipBadge>{account.accountType}</ChipBadge>
                                                    {account.repositorySelection ? (
                                                        <ChipBadge>
                                                            {account.repositorySelection}
                                                        </ChipBadge>
                                                    ) : null}
                                                    {account.installed ? (
                                                        <StateBadge
                                                            tone={status.tone}
                                                            label={status.label}
                                                        />
                                                    ) : (
                                                        <StateBadge
                                                            tone="muted"
                                                            label="Not installed"
                                                        />
                                                    )}
                                                </div>
                                                {account.updatedAt ? (
                                                    <div className="mt-0.5 text-xs text-muted-foreground">
                                                        Updated{' '}
                                                        {formatRelativeTime(account.updatedAt)}
                                                    </div>
                                                ) : null}
                                            </div>
                                            <div className="flex flex-wrap justify-end gap-2">
                                                {account.manageUrl ? (
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant="outline"
                                                        asChild
                                                    >
                                                        <a
                                                            href={account.manageUrl}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                        >
                                                            <ExternalLinkIcon />
                                                            Manage
                                                        </a>
                                                    </Button>
                                                ) : null}
                                                {account.installUrl ? (
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant={
                                                            account.installed
                                                                ? 'outline'
                                                                : 'default'
                                                        }
                                                        asChild
                                                    >
                                                        <a href={account.installUrl}>
                                                            <ExternalLinkIcon />
                                                            {account.installed
                                                                ? 'Update'
                                                                : 'Install'}
                                                        </a>
                                                    </Button>
                                                ) : null}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                )}
            </Section>
            <Dialog
                open={resetOpen}
                onOpenChange={(open) => {
                    if (!open && !resetPending) setResetOpen(false)
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Forget GitHub App configuration?</DialogTitle>
                        <DialogDescription className="space-y-2">
                            <span className="block">
                                Agent Room will remove its stored GitHub App credentials,
                                installations, and room bindings. The GitHub App registration and
                                installations on github.com are not deleted.
                            </span>
                            <span className="block">
                                Use this when you want to set up a new app that can be installed on
                                organizations.
                            </span>
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => setResetOpen(false)}
                            disabled={resetPending}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            variant="destructive"
                            onClick={() => {
                                onReset()
                                setResetOpen(false)
                            }}
                            disabled={resetPending}
                        >
                            Forget GitHub App
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}

export function SetupBanner({ onboardingCompleted }: { onboardingCompleted: boolean | null }) {
    if (onboardingCompleted === null) return null
    if (onboardingCompleted) return null
    return (
        <AttentionBanner
            tone="info"
            title="Finish setup"
            description="Add a provider connection and pick an app default to enable rooms."
        />
    )
}

export function ProviderConnectionsSection({
    providers,
    defaultProviderId,
    loading,
    deletingProviderId,
    onAdd,
    onEdit,
    onDelete,
}: {
    providers: ProviderConnectionSummary[]
    defaultProviderId: string | null | undefined
    loading: boolean
    deletingProviderId: string | undefined
    onAdd: () => void
    onEdit: (entry: ProviderConnectionSummary) => void
    onDelete: (entry: ProviderConnectionSummary) => void
}) {
    return (
        <ConnectionsSection
            title="Provider connections"
            description="Saved providers can be used by any room."
            addLabel="Add provider"
            emptyIcon={PlugIcon}
            emptyTitle="No provider connections"
            emptyDescription="Add an OpenAI, Anthropic, or compatible provider to enable rooms."
            loading={loading}
            items={providers}
            onAdd={onAdd}
            renderRow={(entry) => {
                const status = describeProviderStatus(entry.status)
                const isDefault = defaultProviderId === entry.id
                return (
                    <ConnectionRow
                        key={entry.id}
                        title={entry.label}
                        badges={
                            <>
                                {isDefault ? <ChipBadge>Default</ChipBadge> : null}
                                <StateBadge tone={status.tone} label={status.label} />
                            </>
                        }
                        meta={
                            <>
                                <div className="truncate">
                                    {entry.provider} · {entry.api} · {entry.defaultModel}
                                </div>
                                <div className="mt-0.5">
                                    Updated {formatRelativeTime(entry.updatedAt)}
                                </div>
                            </>
                        }
                        onEdit={() => onEdit(entry)}
                        onDelete={() => onDelete(entry)}
                        deletePending={deletingProviderId === entry.id}
                    />
                )
            }}
        />
    )
}

export function McpConnectionsSection({
    mcpConnections,
    loading,
    deletingMcpId,
    onAdd,
    onEdit,
    onDelete,
}: {
    mcpConnections: McpConnectionSummary[]
    loading: boolean
    deletingMcpId: string | undefined
    onAdd: () => void
    onEdit: (entry: McpConnectionSummary) => void
    onDelete: (entry: McpConnectionSummary) => void
}) {
    return (
        <ConnectionsSection
            title="Connected tools"
            description="MCP servers exposed to rooms."
            addLabel="Add tool"
            emptyIcon={WrenchIcon}
            emptyTitle="No tools connected"
            emptyDescription="Attach MCP servers so rooms can call external tools."
            loading={loading}
            items={mcpConnections}
            onAdd={onAdd}
            renderRow={(entry) => {
                const status = describeProviderStatus(entry.status)
                return (
                    <ConnectionRow
                        key={entry.id}
                        title={entry.name}
                        badges={
                            <>
                                <ChipBadge>{entry.transport}</ChipBadge>
                                <StateBadge tone={status.tone} label={status.label} />
                            </>
                        }
                        meta={
                            <>
                                <div className="truncate">{entry.serverKey}</div>
                                <div className="mt-0.5">
                                    Updated {formatRelativeTime(entry.updatedAt)}
                                </div>
                            </>
                        }
                        onEdit={() => onEdit(entry)}
                        onDelete={() => onDelete(entry)}
                        deletePending={deletingMcpId === entry.id}
                    />
                )
            }}
        />
    )
}

export function AppDefaultsSection({
    providers,
    defaultProviderId,
    selectedDefaultProvider,
    defaultsDirty,
    pending,
    onChangeDefaultProvider,
    onSave,
}: {
    providers: ProviderConnectionSummary[]
    defaultProviderId: string | null
    selectedDefaultProvider: ProviderConnectionSummary | null
    defaultsDirty: boolean
    pending: boolean
    onChangeDefaultProvider: (value: string | null) => void
    onSave: () => void
}) {
    return (
        <Section title="App defaults" description="New rooms inherit these unless overridden.">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <FieldGroup label="Default provider" htmlFor="default-provider">
                    <Select
                        value={defaultProviderId ?? '__none'}
                        onValueChange={(value) =>
                            onChangeDefaultProvider(value === '__none' ? null : value)
                        }
                    >
                        <SelectTrigger id="default-provider" className="w-full">
                            <SelectValue placeholder="No default" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="__none">No default</SelectItem>
                            {providers.map((entry) => (
                                <SelectItem key={entry.id} value={entry.id}>
                                    {entry.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </FieldGroup>
                <FieldGroup label="Model used by new rooms">
                    <div className="flex min-h-10 items-center rounded-md border border-border bg-muted/30 px-3 text-sm text-muted-foreground">
                        {selectedDefaultProvider
                            ? selectedDefaultProvider.defaultModel
                            : 'Pick a default provider'}
                    </div>
                </FieldGroup>
            </div>
            <div className="mt-4 flex justify-end">
                <Button type="button" onClick={onSave} disabled={pending || !defaultsDirty}>
                    Save defaults
                </Button>
            </div>
        </Section>
    )
}

export function CapabilitiesSection({
    config,
    capabilityDefaults,
    appImageProvider,
    appImageModel,
    appImageApiKey,
    appImageHasCredential,
    appImageReplaceApiKey,
    appSearch,
    savePending,
    capabilitiesDirty,
    setCapabilityDefaults,
    setAppImageProvider,
    setAppImageModel,
    setAppImageApiKey,
    setAppImageHasCredential,
    setAppImageReplaceApiKey,
    setAppSearch,
    onSaveCapabilities,
}: {
    config: OperatorConfigSnapshot | undefined
    capabilityDefaults: AppCapabilityDefaults | null
    appImageProvider: AppImageProvider
    appImageModel: string
    appImageApiKey: string
    appImageHasCredential: boolean
    appImageReplaceApiKey: boolean
    appSearch: AppSearchDraft | null
    savePending: boolean
    capabilitiesDirty: boolean
    setCapabilityDefaults: Dispatch<SetStateAction<AppCapabilityDefaults | null>>
    setAppImageProvider: Dispatch<SetStateAction<AppImageProvider>>
    setAppImageModel: Dispatch<SetStateAction<string>>
    setAppImageApiKey: Dispatch<SetStateAction<string>>
    setAppImageHasCredential: Dispatch<SetStateAction<boolean>>
    setAppImageReplaceApiKey: Dispatch<SetStateAction<boolean>>
    setAppSearch: Dispatch<SetStateAction<AppSearchDraft | null>>
    onSaveCapabilities: () => void
}) {
    const updateSearch = (patch: Partial<AppSearchDraft>) =>
        setAppSearch((current) => (current ? { ...current, ...patch } : current))
    const updateBrave = (patch: Partial<AppSearchDraft['brave']>) =>
        setAppSearch((current) =>
            current ? { ...current, brave: { ...current.brave, ...patch } } : current,
        )
    const updateBrowserbase = (patch: Partial<AppSearchDraft['browserbase']>) =>
        setAppSearch((current) =>
            current ? { ...current, browserbase: { ...current.browserbase, ...patch } } : current,
        )

    return (
        <Section
            title="Capabilities"
            description="Defaults inherited by rooms unless a room override is set."
        >
            {!capabilityDefaults || !appSearch ? (
                <LoadingRows count={4} />
            ) : (
                <div className="space-y-4">
                    <div className="grid gap-2 sm:grid-cols-2">
                        {CAPABILITY_OPTIONS.map((option) => (
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
                                            <WrenchIcon className="size-4 text-muted-foreground" />
                                        )}
                                        {option.label}
                                    </span>
                                    <span className="mt-0.5 block text-xs text-muted-foreground">
                                        {option.description}
                                    </span>
                                </span>
                                <Switch
                                    checked={capabilityDefaults[option.id]}
                                    onCheckedChange={(next) =>
                                        setCapabilityDefaults((current) =>
                                            current ? { ...current, [option.id]: next } : current,
                                        )
                                    }
                                    aria-label={`Toggle ${option.label}`}
                                />
                            </label>
                        ))}
                    </div>
                    <div className="rounded-lg border border-border/60 p-3">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <div className="text-sm font-medium text-foreground">
                                    Web search defaults
                                </div>
                            </div>
                            <Switch
                                checked={appSearch.enabled}
                                onCheckedChange={(enabled) => updateSearch({ enabled })}
                                aria-label="Toggle web search"
                            />
                        </div>
                        <div className="mt-3 max-w-sm">
                            <FieldGroup label="Searches per run" htmlFor="search-max-per-run">
                                <Input
                                    id="search-max-per-run"
                                    type="number"
                                    min={1}
                                    max={100}
                                    value={appSearch.maxSearchesPerRun}
                                    onChange={(event) =>
                                        updateSearch({
                                            maxSearchesPerRun: Number(event.target.value),
                                        })
                                    }
                                />
                            </FieldGroup>
                        </div>
                        <div className="mt-4 grid gap-3">
                            <div className="rounded-md border border-border/60 p-3">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="text-sm font-medium text-foreground">
                                        Brave Search
                                    </div>
                                    <Switch
                                        checked={appSearch.brave.enabled}
                                        onCheckedChange={(enabled) => updateBrave({ enabled })}
                                        aria-label="Toggle Brave Search"
                                    />
                                </div>
                                {appSearch.brave.enabled ? (
                                    <div className="mt-3 space-y-3">
                                        <MaskedSecretField
                                            label="Brave API key"
                                            id="brave-search-api-key"
                                            hasCredential={appSearch.brave.hasCredential}
                                            replace={appSearch.brave.replaceApiKey}
                                            onToggleReplace={(replaceApiKey) => {
                                                updateBrave({
                                                    replaceApiKey,
                                                    apiKey: replaceApiKey
                                                        ? appSearch.brave.apiKey
                                                        : '',
                                                })
                                            }}
                                            value={appSearch.brave.apiKey}
                                            onChange={(apiKey) => updateBrave({ apiKey })}
                                            placeholder="Brave Search API key"
                                        />
                                        <div className="grid gap-3 sm:grid-cols-2">
                                            <FieldGroup label="Country" htmlFor="brave-country">
                                                <Input
                                                    id="brave-country"
                                                    value={appSearch.brave.country}
                                                    onChange={(event) =>
                                                        updateBrave({
                                                            country: event.target.value,
                                                        })
                                                    }
                                                    placeholder="US"
                                                />
                                            </FieldGroup>
                                            <FieldGroup
                                                label="Search language"
                                                htmlFor="brave-search-lang"
                                            >
                                                <Input
                                                    id="brave-search-lang"
                                                    value={appSearch.brave.searchLang}
                                                    onChange={(event) =>
                                                        updateBrave({
                                                            searchLang: event.target.value,
                                                        })
                                                    }
                                                    placeholder="en"
                                                />
                                            </FieldGroup>
                                            <FieldGroup
                                                label="Safe search"
                                                htmlFor="brave-safe-search"
                                            >
                                                <Select
                                                    value={appSearch.brave.safeSearch}
                                                    onValueChange={(value) =>
                                                        updateBrave({
                                                            safeSearch:
                                                                value as AppSearchSafeSearch,
                                                        })
                                                    }
                                                >
                                                    <SelectTrigger
                                                        id="brave-safe-search"
                                                        className="w-full"
                                                    >
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="off">Off</SelectItem>
                                                        <SelectItem value="moderate">
                                                            Moderate
                                                        </SelectItem>
                                                        <SelectItem value="strict">
                                                            Strict
                                                        </SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </FieldGroup>
                                            <FieldGroup
                                                label="Result count"
                                                htmlFor="brave-result-count"
                                            >
                                                <Input
                                                    id="brave-result-count"
                                                    type="number"
                                                    min={1}
                                                    max={20}
                                                    value={appSearch.brave.resultCount}
                                                    onChange={(event) =>
                                                        updateBrave({
                                                            resultCount: Number(event.target.value),
                                                        })
                                                    }
                                                />
                                            </FieldGroup>
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                            <div className="rounded-md border border-border/60 p-3">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="text-sm font-medium text-foreground">
                                        Browserbase Search
                                    </div>
                                    <Switch
                                        checked={appSearch.browserbase.enabled}
                                        onCheckedChange={(enabled) =>
                                            updateBrowserbase({ enabled })
                                        }
                                        aria-label="Toggle Browserbase Search"
                                    />
                                </div>
                                {appSearch.browserbase.enabled ? (
                                    <div className="mt-3 space-y-3">
                                        <MaskedSecretField
                                            label="Browserbase API key"
                                            id="browserbase-search-api-key"
                                            hasCredential={appSearch.browserbase.hasCredential}
                                            replace={appSearch.browserbase.replaceApiKey}
                                            onToggleReplace={(replaceApiKey) => {
                                                updateBrowserbase({
                                                    replaceApiKey,
                                                    apiKey: replaceApiKey
                                                        ? appSearch.browserbase.apiKey
                                                        : '',
                                                })
                                            }}
                                            value={appSearch.browserbase.apiKey}
                                            onChange={(apiKey) => updateBrowserbase({ apiKey })}
                                            placeholder="Browserbase API key"
                                        />
                                        <div className="grid gap-3 sm:grid-cols-2">
                                            <FieldGroup
                                                label="Result count"
                                                htmlFor="browserbase-result-count"
                                            >
                                                <Input
                                                    id="browserbase-result-count"
                                                    type="number"
                                                    min={1}
                                                    max={20}
                                                    value={appSearch.browserbase.resultCount}
                                                    onChange={(event) =>
                                                        updateBrowserbase({
                                                            resultCount: Number(event.target.value),
                                                        })
                                                    }
                                                />
                                            </FieldGroup>
                                            <FieldGroup
                                                label="Timeout"
                                                htmlFor="browserbase-timeout-ms"
                                            >
                                                <Input
                                                    id="browserbase-timeout-ms"
                                                    type="number"
                                                    min={1000}
                                                    max={30000}
                                                    value={appSearch.browserbase.timeoutMs}
                                                    onChange={(event) =>
                                                        updateBrowserbase({
                                                            timeoutMs: Number(event.target.value),
                                                        })
                                                    }
                                                />
                                            </FieldGroup>
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    </div>
                    <div className="rounded-lg border border-border/60 p-3">
                        <div className="text-sm font-medium text-foreground">Image defaults</div>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            <FieldGroup label="Provider" htmlFor="app-image-provider">
                                <Select
                                    value={appImageProvider}
                                    onValueChange={(value) => {
                                        const provider = value as AppImageProvider
                                        const savedProvider =
                                            config?.settings.image.provider ?? 'none'
                                        const hasCredential =
                                            provider !== 'none' &&
                                            provider === savedProvider &&
                                            Boolean(config?.settings.image.hasCredential)
                                        const options =
                                            provider === 'none'
                                                ? []
                                                : imageModelOptionsForProvider(provider)
                                        setAppImageProvider(provider)
                                        setAppImageModel(
                                            provider === 'none'
                                                ? ''
                                                : provider === savedProvider
                                                  ? (config?.settings.image.model ??
                                                    options[0]?.value ??
                                                    '')
                                                  : (options[0]?.value ?? ''),
                                        )
                                        setAppImageApiKey('')
                                        setAppImageHasCredential(hasCredential)
                                        setAppImageReplaceApiKey(!hasCredential)
                                    }}
                                >
                                    <SelectTrigger id="app-image-provider" className="w-full">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">None</SelectItem>
                                        <SelectItem value="openai">OpenAI Images</SelectItem>
                                        <SelectItem value="gemini">Gemini Images</SelectItem>
                                    </SelectContent>
                                </Select>
                            </FieldGroup>
                            {appImageProvider === 'none' ? (
                                <FieldGroup label="Default image model">
                                    <div className="flex min-h-10 items-center rounded-md border border-border bg-muted/30 px-3 text-sm text-muted-foreground">
                                        Images use room overrides only
                                    </div>
                                </FieldGroup>
                            ) : (
                                <ModelSelectField
                                    id="app-image-model"
                                    label="Default image model"
                                    value={appImageModel}
                                    onChange={setAppImageModel}
                                    options={imageModelOptionsForProvider(
                                        appImageProvider,
                                        appImageModel,
                                    )}
                                />
                            )}
                        </div>
                        {appImageProvider !== 'none' ? (
                            <div className="mt-3">
                                <MaskedSecretField
                                    label="Image API key"
                                    id="app-image-api-key"
                                    hasCredential={appImageHasCredential}
                                    replace={appImageReplaceApiKey}
                                    onToggleReplace={(replace) => {
                                        setAppImageReplaceApiKey(replace)
                                        if (!replace) setAppImageApiKey('')
                                    }}
                                    value={appImageApiKey}
                                    onChange={setAppImageApiKey}
                                    placeholder={
                                        appImageProvider === 'gemini'
                                            ? 'Gemini API key'
                                            : 'OpenAI API key'
                                    }
                                />
                            </div>
                        ) : null}
                    </div>
                    <div className="flex justify-end">
                        <Button
                            type="button"
                            onClick={onSaveCapabilities}
                            disabled={savePending || !capabilitiesDirty}
                        >
                            Save capabilities
                        </Button>
                    </div>
                </div>
            )}
        </Section>
    )
}

export function ProductInfoCard() {
    return (
        <Card className="overflow-hidden">
            <CardHeader>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
                        <BrandMark size={20} />
                    </span>
                    <div className="min-w-0 flex-1">
                        <CardTitle>How Agent Room Works</CardTitle>
                        <CardDescription>
                            A short operator guide to rooms, sessions, provider bindings, tools,
                            memory, and scheduled work.
                        </CardDescription>
                    </div>
                    <Button asChild variant="outline" size="sm" className="shrink-0">
                        <Link to="/about">Learn more</Link>
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
                <div>
                    <div className="font-medium text-foreground">Room-local state</div>
                    <p className="mt-1">
                        Files, memory, logs, and runtime auth stay scoped to a room.
                    </p>
                </div>
                <div>
                    <div className="font-medium text-foreground">Provider truth</div>
                    <p className="mt-1">
                        Rooms inherit app defaults or bind to explicit connections.
                    </p>
                </div>
                <div>
                    <div className="font-medium text-foreground">Auditable work</div>
                    <p className="mt-1">
                        Sessions, tools, jobs, and usage create an inspectable trail.
                    </p>
                </div>
            </CardContent>
        </Card>
    )
}

export function DeleteConnectionDialog({
    target,
    pending,
    targetName,
    title,
    description,
    onCancel,
    onConfirm,
}: {
    target: DeleteConnectionTarget | null
    pending: boolean
    targetName: string
    title: string
    description: string
    onCancel: () => void
    onConfirm: () => void
}) {
    return (
        <Dialog
            open={target !== null}
            onOpenChange={(open) => {
                if (!open && !pending) onCancel()
            }}
        >
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription className="space-y-2">
                        <span className="block">{description}</span>
                        {targetName ? (
                            <span className="block font-medium text-foreground">{targetName}</span>
                        ) : null}
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        variant="destructive"
                        onClick={onConfirm}
                        disabled={pending}
                    >
                        <Trash2Icon />
                        Delete
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
