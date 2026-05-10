import { Link } from '@tanstack/react-router'
import type { Dispatch, SetStateAction } from 'react'
import { GlobeIcon, ImageIcon, PlugIcon, Trash2Icon, WrenchIcon } from 'lucide-react'

import {
    AttentionBanner,
    BrandMark,
    LoadingRows,
    Section,
    StateBadge,
} from '#/components/agent-room'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
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
    savePending,
    capabilitiesDirty,
    setCapabilityDefaults,
    setAppImageProvider,
    setAppImageModel,
    setAppImageApiKey,
    setAppImageHasCredential,
    setAppImageReplaceApiKey,
    onSaveCapabilities,
}: {
    config: OperatorConfigSnapshot | undefined
    capabilityDefaults: AppCapabilityDefaults | null
    appImageProvider: AppImageProvider
    appImageModel: string
    appImageApiKey: string
    appImageHasCredential: boolean
    appImageReplaceApiKey: boolean
    savePending: boolean
    capabilitiesDirty: boolean
    setCapabilityDefaults: Dispatch<SetStateAction<AppCapabilityDefaults | null>>
    setAppImageProvider: Dispatch<SetStateAction<AppImageProvider>>
    setAppImageModel: Dispatch<SetStateAction<string>>
    setAppImageApiKey: Dispatch<SetStateAction<string>>
    setAppImageHasCredential: Dispatch<SetStateAction<boolean>>
    setAppImageReplaceApiKey: Dispatch<SetStateAction<boolean>>
    onSaveCapabilities: () => void
}) {
    return (
        <Section
            title="Capabilities"
            description="Defaults inherited by rooms unless a room override is set."
        >
            {!capabilityDefaults ? (
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
