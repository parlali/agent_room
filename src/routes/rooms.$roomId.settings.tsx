import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
    AlertTriangleIcon,
    ArchiveIcon,
    CopyIcon,
    ExternalLinkIcon,
    GlobeIcon,
    ImageIcon,
    KeyRoundIcon,
    Loader2Icon,
    PauseIcon,
    PlayIcon,
    PlugIcon,
    PlusIcon,
    SaveIcon,
    ShieldIcon,
    SignalHighIcon,
    Trash2Icon,
    XIcon,
} from 'lucide-react'

import { RoomDashboardLayout } from '#/components/room-dashboard'
import {
    AttentionBanner,
    DangerZone,
    DangerZoneItem,
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
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '#/components/ui/dialog'
import { Skeleton } from '#/components/ui/skeleton'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '#/components/ui/select'
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from '#/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '#/components/ui/tooltip'
import { formatRelativeTime } from '#/lib/format'
import { describeProviderStatus } from '#/lib/state'
import { cn } from '#/lib/utils'
import { CAPABILITY_OPTIONS, type CapabilityOption } from '#/lib/capabilities'
import {
    imageModelOptionsForProvider,
    providerModelOptionsForProvider,
    type ModelOption,
} from '#/lib/model-options'
import {
    cancelCodexOAuthSessionServer,
    getCodexOAuthSessionServer,
    getOperatorConfigServer,
    getRoomConfigServer,
    saveRoomConfigServer,
    saveRoomSecretServer,
    startCodexOAuthSessionServer,
    submitCodexOAuthRedirectServer,
} from '#/routes/-operator-config-server'
import {
    deleteRoomServer,
    listRoomsServer,
    setRoomDesiredStateServer,
    updateRoomIdentityServer,
} from '#/routes/-room-runtime-server'
import { requireRouteUser } from '#/routes/-route-auth'
import type {
    OperatorConfigSnapshot,
    ProviderConnectionSummary,
    RoomConfigSnapshot,
    RoomSecretSummary,
} from '#/server/configuration/operator-configuration'
import type {
    ProviderApi,
    RoomProviderMode,
    RoomSecretPurpose,
    RoomToolProfile,
} from '#/server/domain/types'

export const Route = createFileRoute('/rooms/$roomId/settings')({
    beforeLoad: requireRouteUser,
    component: RoomSettingsPage,
})

type ProviderMode = RoomProviderMode
type SecretPurpose = RoomSecretPurpose

const TOOL_PROFILES = [
    { value: 'coding', label: 'Coding' },
    { value: 'minimal', label: 'Minimal' },
    { value: 'read-only', label: 'Read only' },
] satisfies Array<{ value: RoomToolProfile; label: string }>

const COMMON_TIMEZONES = [
    'UTC',
    'America/Los_Angeles',
    'America/Denver',
    'America/Chicago',
    'America/New_York',
    'America/Sao_Paulo',
    'Europe/London',
    'Europe/Berlin',
    'Europe/Istanbul',
    'Asia/Dubai',
    'Asia/Kolkata',
    'Asia/Singapore',
    'Asia/Tokyo',
    'Australia/Sydney',
]

interface IdentityDraft {
    displayName: string
    slug: string
}

interface ConfigDraft {
    instructions: string
    providerMode: ProviderMode
    providerConnectionId: string
    provider: string
    providerApi: ProviderApi
    providerBaseUrl: string
    providerModel: string
    providerApiKey: string
    toolsProfile: RoomToolProfile
    capabilityOverrides: Record<string, boolean>
    imageProvider: 'inherit' | 'openai' | 'gemini'
    imageModel: string
    imageApiKey: string
    cronTimezone: string
    mcpConnectionIds: string[]
}

interface SecretDraft {
    label: string
    envKey: string
    purpose: SecretPurpose
    provider: string
    value: string
}

function emptySecretDraft(): SecretDraft {
    return {
        label: '',
        envKey: '',
        purpose: 'generic',
        provider: '',
        value: '',
    }
}

function configFromSnapshot(snapshot: RoomConfigSnapshot): ConfigDraft {
    return {
        instructions: snapshot.config.instructions ?? '',
        providerMode: snapshot.config.providerMode,
        providerConnectionId: snapshot.config.providerConnectionId ?? '',
        provider: snapshot.config.provider ?? '',
        providerApi: (snapshot.config.providerApi ?? 'openai-completions') as ProviderApi,
        providerBaseUrl: snapshot.config.providerBaseUrl ?? '',
        providerModel: snapshot.config.providerModel ?? '',
        providerApiKey: '',
        toolsProfile: snapshot.config.toolsProfile || 'coding',
        capabilityOverrides: { ...snapshot.config.capabilityOverrides },
        imageProvider: snapshot.config.imageProvider ?? 'inherit',
        imageModel: snapshot.config.imageModel ?? '',
        imageApiKey: '',
        cronTimezone: snapshot.config.cronTimezone || 'UTC',
        mcpConnectionIds: [...snapshot.config.mcpConnectionIds],
    }
}

function arraysEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false
    const sortedA = [...a].sort()
    const sortedB = [...b].sort()
    return sortedA.every((v, i) => v === sortedB[i])
}

function recordsEqual(a: Record<string, boolean>, b: Record<string, boolean>): boolean {
    const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)]))
    return keys.every((key) => a[key] === b[key])
}

function configsEqual(a: ConfigDraft, b: ConfigDraft): boolean {
    return (
        a.instructions === b.instructions &&
        a.providerMode === b.providerMode &&
        a.providerConnectionId === b.providerConnectionId &&
        a.provider === b.provider &&
        a.providerApi === b.providerApi &&
        a.providerBaseUrl === b.providerBaseUrl &&
        a.providerModel === b.providerModel &&
        a.providerApiKey === b.providerApiKey &&
        a.toolsProfile === b.toolsProfile &&
        recordsEqual(a.capabilityOverrides, b.capabilityOverrides) &&
        a.imageProvider === b.imageProvider &&
        a.imageModel === b.imageModel &&
        a.imageApiKey === b.imageApiKey &&
        a.cronTimezone === b.cronTimezone &&
        arraysEqual(a.mcpConnectionIds, b.mcpConnectionIds)
    )
}

function ModelSelect({
    id,
    value,
    options,
    onChange,
    disabled = false,
}: {
    id: string
    value: string
    options: ModelOption[]
    onChange: (value: string) => void
    disabled?: boolean
}) {
    return (
        <Select value={value} onValueChange={onChange} disabled={disabled}>
            <SelectTrigger id={id} className="w-full">
                <SelectValue placeholder="Pick a model" />
            </SelectTrigger>
            <SelectContent>
                {options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                        {option.label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}

function RoomSettingsPage() {
    const { roomId } = Route.useParams()
    const queryClient = useQueryClient()

    const roomConfigQuery = useQuery({
        queryKey: ['room-config', roomId],
        queryFn: () => getRoomConfigServer({ data: { roomId } }),
        staleTime: 5_000,
    })

    const roomsQuery = useQuery({
        queryKey: ['rooms-list'],
        queryFn: () => listRoomsServer(),
        staleTime: 10_000,
    })

    const room = roomsQuery.data?.find((r) => r.roomId === roomId) ?? null
    const snapshot = roomConfigQuery.data ?? null

    return (
        <RoomDashboardLayout roomId={roomId} activeTab="settings">
            <TooltipProvider>
                <div className="mx-auto flex max-w-4xl flex-col gap-6">
                    {roomConfigQuery.isError ? (
                        <AttentionBanner
                            tone="danger"
                            title="Could not load room settings"
                            description={
                                roomConfigQuery.error instanceof Error
                                    ? roomConfigQuery.error.message
                                    : 'Unexpected error'
                            }
                        />
                    ) : null}

                    {snapshot && !snapshot.effective.ready ? (
                        <AttentionBanner
                            tone="attention"
                            title="Room is not ready yet"
                            description={snapshot.effective.blockedReasons.join('; ')}
                        />
                    ) : null}

                    <IdentitySection
                        roomId={roomId}
                        loading={roomsQuery.isLoading}
                        defaultDisplayName={room?.displayName ?? ''}
                        defaultSlug={room?.slug ?? ''}
                        onSaved={async () => {
                            await Promise.all([
                                queryClient.invalidateQueries({ queryKey: ['rooms-list'] }),
                                queryClient.invalidateQueries({
                                    queryKey: ['room-config', roomId],
                                }),
                            ])
                        }}
                    />

                    <ConfigSections
                        roomId={roomId}
                        snapshot={snapshot}
                        loading={roomConfigQuery.isLoading}
                        onSaved={async () => {
                            await queryClient.invalidateQueries({
                                queryKey: ['room-config', roomId],
                            })
                        }}
                    />

                    <SecretsSection
                        roomId={roomId}
                        loading={roomConfigQuery.isLoading}
                        secrets={snapshot?.roomSecrets ?? []}
                        onSaved={async () => {
                            await queryClient.invalidateQueries({
                                queryKey: ['room-config', roomId],
                            })
                        }}
                    />

                    <PauseAndArchiveSection
                        roomId={roomId}
                        paused={room?.desiredState === 'stopped'}
                        loading={roomsQuery.isLoading}
                    />

                    <DangerZoneSection
                        roomId={roomId}
                        roomSlug={room?.slug ?? ''}
                        roomDisplayName={room?.displayName ?? ''}
                        loading={roomsQuery.isLoading}
                    />
                </div>
            </TooltipProvider>
        </RoomDashboardLayout>
    )
}

function IdentitySection({
    roomId,
    loading,
    defaultDisplayName,
    defaultSlug,
    onSaved,
}: {
    roomId: string
    loading: boolean
    defaultDisplayName: string
    defaultSlug: string
    onSaved: () => Promise<void>
}) {
    const [draft, setDraft] = useState<IdentityDraft>({
        displayName: defaultDisplayName,
        slug: defaultSlug,
    })

    useEffect(() => {
        setDraft({ displayName: defaultDisplayName, slug: defaultSlug })
    }, [defaultDisplayName, defaultSlug])

    const mutation = useMutation({
        mutationFn: () =>
            updateRoomIdentityServer({
                data: {
                    roomId,
                    displayName: draft.displayName.trim(),
                    slug: draft.slug.trim() || null,
                },
            }),
        onSuccess: async () => {
            await onSaved()
            toast.success('Room identity saved')
        },
        onError: (e: unknown) =>
            toast.error('Could not save identity', {
                description: e instanceof Error ? e.message : 'Unexpected error',
            }),
    })

    const dirty = draft.displayName !== defaultDisplayName || draft.slug !== defaultSlug
    const valid = draft.displayName.trim().length > 0

    return (
        <Section title="Identity" description="The name and URL slug operators see for this room.">
            {loading ? (
                <div className="space-y-3">
                    <Skeleton className="h-9 w-full" />
                    <Skeleton className="h-9 w-full" />
                </div>
            ) : (
                <form
                    className="grid gap-4 sm:grid-cols-2"
                    onSubmit={(e) => {
                        e.preventDefault()
                        if (!valid || !dirty || mutation.isPending) return
                        mutation.mutate()
                    }}
                >
                    <div className="space-y-1.5">
                        <Label htmlFor="room-display-name">Display name</Label>
                        <Input
                            id="room-display-name"
                            value={draft.displayName}
                            onChange={(e) =>
                                setDraft((prev) => ({ ...prev, displayName: e.target.value }))
                            }
                            required
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="room-slug">Slug</Label>
                        <Input
                            id="room-slug"
                            value={draft.slug}
                            onChange={(e) =>
                                setDraft((prev) => ({ ...prev, slug: e.target.value }))
                            }
                            placeholder="auto"
                        />
                        <p className="text-xs text-muted-foreground">
                            Lowercase, hyphenated. Leave blank to auto-generate.
                        </p>
                    </div>
                    <div className="flex justify-end gap-2 sm:col-span-2">
                        <Button type="submit" disabled={!valid || !dirty || mutation.isPending}>
                            {mutation.isPending ? (
                                <Loader2Icon className="animate-spin" />
                            ) : (
                                <SaveIcon />
                            )}
                            Save identity
                        </Button>
                    </div>
                </form>
            )}
        </Section>
    )
}

function ConfigSections({
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
                    toolsProfile: input.toolsProfile,
                    capabilityOverrides: input.capabilityOverrides,
                    imageProvider: input.imageProvider === 'inherit' ? null : input.imageProvider,
                    imageModel:
                        input.imageProvider === 'inherit' ? null : input.imageModel.trim() || null,
                    imageApiKey: input.imageApiKey || undefined,
                    cronTimezone: input.cronTimezone,
                    mcpConnectionIds: input.mcpConnectionIds,
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

            <Section
                title="Tools profile"
                description="Which built-in tool set agents in this room may use."
                actions={<SaveBar dirty={dirty} pending={mutation.isPending} onSave={handleSave} />}
            >
                <div className="space-y-1.5">
                    <Label htmlFor="room-tools-profile">Profile</Label>
                    <Select
                        value={draft.toolsProfile}
                        onValueChange={(value) =>
                            setDraft((prev) =>
                                prev ? { ...prev, toolsProfile: value as RoomToolProfile } : prev,
                            )
                        }
                    >
                        <SelectTrigger id="room-tools-profile" className="w-full sm:w-64">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {TOOL_PROFILES.map((profile) => (
                                <SelectItem key={profile.value} value={profile.value}>
                                    {profile.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
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
    const roomImageModelOptions =
        draft.imageProvider === 'inherit'
            ? []
            : imageModelOptionsForProvider(draft.imageProvider, draft.imageModel)

    return (
        <Section
            title="Capabilities"
            description="Built-in room features and provider-backed image generation."
            actions={<SaveBar dirty={dirty} pending={pending} onSave={onSave} />}
        >
            <div className="space-y-4">
                <div className="grid gap-2 sm:grid-cols-2">
                    {CAPABILITY_OPTIONS.map((option) => {
                        const checked = capabilityValue({
                            draft,
                            option,
                            appDefaults,
                            effectiveCapabilities,
                        })
                        const inherited =
                            appDefaults && draft.capabilityOverrides[option.id] === undefined
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

                <div className="flex justify-end">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onChange({ capabilityOverrides: {} })}
                        disabled={Object.keys(draft.capabilityOverrides).length === 0 || pending}
                    >
                        Use app capability defaults
                    </Button>
                </div>
            </div>
        </Section>
    )
}

function ModeRadio({
    label,
    description,
    checked,
    onSelect,
}: {
    label: string
    description: string
    checked: boolean
    onSelect: () => void
}) {
    return (
        <button
            type="button"
            onClick={onSelect}
            className={cn(
                'flex flex-col items-start gap-1 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                checked
                    ? 'border-foreground bg-muted/40 text-foreground'
                    : 'border-border/70 text-muted-foreground hover:border-border hover:text-foreground',
            )}
            aria-pressed={checked}
        >
            <span className="font-medium">{label}</span>
            <span className="text-xs">{description}</span>
        </button>
    )
}

function SaveBar({
    dirty,
    pending,
    onSave,
}: {
    dirty: boolean
    pending: boolean
    onSave: () => void
}) {
    return (
        <Button
            size="sm"
            onClick={onSave}
            disabled={!dirty || pending}
            variant={dirty ? 'default' : 'outline'}
        >
            {pending ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
            Save
        </Button>
    )
}

function CodexOAuthSection({ roomId }: { roomId: string }) {
    const queryClient = useQueryClient()
    const [redirectUrl, setRedirectUrl] = useState('')

    const sessionQuery = useQuery({
        queryKey: ['codex-oauth-session', roomId],
        queryFn: () => getCodexOAuthSessionServer({ data: { roomId } }),
        refetchInterval: (query) => {
            const data = query.state.data
            return data && ['starting', 'awaiting_redirect', 'submitting'].includes(data.status)
                ? 3000
                : false
        },
    })

    const session = sessionQuery.data ?? null
    const status = session?.status ?? 'idle'

    const copyAuthUrl = async (authUrl: string) => {
        try {
            await navigator.clipboard.writeText(authUrl)
            toast.success('OpenAI sign-in link copied')
        } catch {
            toast.error('Could not copy sign-in link')
        }
    }

    useEffect(() => {
        if (status !== 'awaiting_redirect') {
            setRedirectUrl('')
        }
    }, [status])

    const startMutation = useMutation({
        mutationFn: () => startCodexOAuthSessionServer({ data: { roomId } }),
        onSuccess: async () => {
            await queryClient.invalidateQueries({
                queryKey: ['codex-oauth-session', roomId],
            })
        },
        onError: (e: unknown) =>
            toast.error('Could not start OpenAI sign-in', {
                description: e instanceof Error ? e.message : 'Unexpected error',
            }),
    })

    const submitMutation = useMutation({
        mutationFn: (value: string) =>
            submitCodexOAuthRedirectServer({
                data: { roomId, redirectUrl: value },
            }),
        onSuccess: async () => {
            await queryClient.invalidateQueries({
                queryKey: ['codex-oauth-session', roomId],
            })
        },
        onError: (e: unknown) =>
            toast.error('Could not submit redirect URL', {
                description: e instanceof Error ? e.message : 'Unexpected error',
            }),
    })

    const cancelMutation = useMutation({
        mutationFn: () => cancelCodexOAuthSessionServer({ data: { roomId } }),
        onSuccess: async () => {
            await queryClient.invalidateQueries({
                queryKey: ['codex-oauth-session', roomId],
            })
            toast.message('OpenAI sign-in cancelled')
        },
        onError: (e: unknown) =>
            toast.error('Could not cancel sign-in', {
                description: e instanceof Error ? e.message : 'Unexpected error',
            }),
    })

    const isActive = status !== 'idle' && status !== 'complete'

    return (
        <Section
            title="OpenAI Codex OAuth"
            description="Sign in once for this room. Tokens never leave the host."
            actions={
                isActive ? (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => cancelMutation.mutate()}
                        disabled={cancelMutation.isPending}
                    >
                        {cancelMutation.isPending ? (
                            <Loader2Icon className="animate-spin" />
                        ) : (
                            <XIcon />
                        )}
                        Cancel
                    </Button>
                ) : null
            }
        >
            <div className="space-y-3">
                {status === 'idle' ? (
                    <Button
                        onClick={() => startMutation.mutate()}
                        disabled={startMutation.isPending}
                    >
                        {startMutation.isPending ? (
                            <Loader2Icon className="animate-spin" />
                        ) : (
                            <SignalHighIcon />
                        )}
                        Connect with OpenAI
                    </Button>
                ) : null}

                {status === 'starting' ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2Icon className="size-4 animate-spin" />
                        Preparing sign-in
                    </div>
                ) : null}

                {status === 'awaiting_redirect' && session ? (
                    <div className="space-y-3">
                        {session.authUrl ? (
                            <div className="flex flex-wrap items-center gap-2">
                                <a
                                    href={session.authUrl}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                    className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                                >
                                    Open OpenAI sign-in
                                    <ExternalLinkIcon className="size-3.5" />
                                </a>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => void copyAuthUrl(session.authUrl as string)}
                                >
                                    <CopyIcon />
                                    Copy link
                                </Button>
                            </div>
                        ) : null}
                        <p className="text-xs text-muted-foreground">
                            After signing in, copy the full redirect URL the browser shows (it
                            includes <code>code</code> and <code>state</code>) and paste it below.
                        </p>
                        <form
                            className="flex flex-col gap-2 sm:flex-row sm:items-end"
                            onSubmit={(e) => {
                                e.preventDefault()
                                if (!redirectUrl.trim() || submitMutation.isPending) return
                                submitMutation.mutate(redirectUrl.trim())
                            }}
                        >
                            <div className="flex-1 space-y-1.5">
                                <Label htmlFor="codex-redirect-url">Redirect URL</Label>
                                <Input
                                    id="codex-redirect-url"
                                    value={redirectUrl}
                                    onChange={(e) => setRedirectUrl(e.target.value)}
                                    placeholder="http://localhost:1455/auth/callback?code=...&state=..."
                                    required
                                />
                            </div>
                            <Button
                                type="submit"
                                disabled={!redirectUrl.trim() || submitMutation.isPending}
                            >
                                {submitMutation.isPending ? (
                                    <Loader2Icon className="animate-spin" />
                                ) : null}
                                Submit
                            </Button>
                        </form>
                    </div>
                ) : null}

                {status === 'submitting' ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2Icon className="size-4 animate-spin" />
                        Verifying with OpenAI
                    </div>
                ) : null}

                {status === 'complete' ? (
                    <div className="flex items-center gap-2">
                        <StateBadge tone="ready" label="Connected" />
                        <span className="text-sm text-muted-foreground">
                            {session?.message ?? 'OpenAI Codex profile is ready for this room.'}
                        </span>
                    </div>
                ) : null}

                {status === 'failed' || status === 'expired' || status === 'cancelled' ? (
                    <div className="space-y-2">
                        <AttentionBanner
                            tone={status === 'cancelled' ? 'muted' : 'danger'}
                            title={
                                status === 'failed'
                                    ? 'OpenAI sign-in failed'
                                    : status === 'expired'
                                      ? 'OpenAI sign-in expired'
                                      : 'OpenAI sign-in cancelled'
                            }
                            description={session?.message ?? null}
                        />
                        <Button
                            onClick={() => startMutation.mutate()}
                            disabled={startMutation.isPending}
                        >
                            {startMutation.isPending ? (
                                <Loader2Icon className="animate-spin" />
                            ) : (
                                <SignalHighIcon />
                            )}
                            Try again
                        </Button>
                    </div>
                ) : null}
            </div>
        </Section>
    )
}

function SecretsSection({
    roomId,
    loading,
    secrets,
    onSaved,
}: {
    roomId: string
    loading: boolean
    secrets: RoomSecretSummary[]
    onSaved: () => Promise<void>
}) {
    const [open, setOpen] = useState(false)
    const [draft, setDraft] = useState<SecretDraft>(emptySecretDraft())
    const [editingExisting, setEditingExisting] = useState<RoomSecretSummary | null>(null)

    const mutation = useMutation({
        mutationFn: (input: SecretDraft) =>
            saveRoomSecretServer({
                data: {
                    roomId,
                    label: input.label.trim(),
                    envKey: input.envKey.trim(),
                    purpose: input.purpose,
                    provider: input.provider.trim() || null,
                    value: input.value,
                },
            }),
        onSuccess: async () => {
            await onSaved()
            toast.success(editingExisting ? 'Secret replaced' : 'Secret saved')
            setOpen(false)
            setDraft(emptySecretDraft())
            setEditingExisting(null)
        },
        onError: (e: unknown) =>
            toast.error('Could not save secret', {
                description: e instanceof Error ? e.message : 'Unexpected error',
            }),
    })

    const handleAdd = () => {
        setEditingExisting(null)
        setDraft(emptySecretDraft())
        setOpen(true)
    }

    const handleReplace = (secret: RoomSecretSummary) => {
        setEditingExisting(secret)
        setDraft({
            label: secret.label,
            envKey: secret.envKey,
            purpose: (secret.purpose as SecretPurpose) ?? 'generic',
            provider: secret.provider ?? '',
            value: '',
        })
        setOpen(true)
    }

    const valid =
        draft.label.trim().length > 0 && draft.envKey.trim().length > 0 && draft.value.length > 0

    return (
        <Section
            title="Room secrets"
            description="Encrypted, write-only values exposed to this room as env vars."
            actions={
                <Button size="sm" onClick={handleAdd}>
                    <PlusIcon />
                    Add secret
                </Button>
            }
            bodyClassName={loading || secrets.length === 0 ? 'p-4' : 'p-0'}
        >
            {loading ? (
                <LoadingRows count={2} />
            ) : secrets.length === 0 ? (
                <EmptyState
                    icon={KeyRoundIcon}
                    title="No room secrets yet"
                    description="Add an encrypted value this room can read at runtime."
                    action={
                        <Button size="sm" onClick={handleAdd}>
                            <PlusIcon />
                            Add secret
                        </Button>
                    }
                />
            ) : (
                <ul className="divide-y divide-border/60">
                    {secrets.map((secret) => (
                        <li key={secret.id} className="flex items-center gap-3 px-4 py-3">
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                                <KeyRoundIcon className="size-4" />
                            </span>
                            <div className="min-w-0 flex-1">
                                <h4 className="truncate text-sm font-medium text-foreground">
                                    {secret.label}
                                </h4>
                                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                    {secret.envKey} · {secret.purpose}
                                    {secret.provider ? ` · ${secret.provider}` : ''} · updated{' '}
                                    {formatRelativeTime(secret.updatedAt)}
                                </p>
                            </div>
                            <StateBadge tone="muted" label="Masked" />
                            <Button variant="ghost" size="sm" onClick={() => handleReplace(secret)}>
                                Replace
                            </Button>
                        </li>
                    ))}
                </ul>
            )}

            <Sheet
                open={open}
                onOpenChange={(next) => {
                    setOpen(next)
                    if (!next) {
                        setDraft(emptySecretDraft())
                        setEditingExisting(null)
                    }
                }}
            >
                <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md">
                    <SheetHeader>
                        <SheetTitle>
                            {editingExisting ? 'Replace secret value' : 'Add room secret'}
                        </SheetTitle>
                        <SheetDescription>
                            {editingExisting
                                ? 'The new value overwrites the existing one. Old values cannot be recovered.'
                                : 'Stored encrypted on disk. Available to the room as an env var.'}
                        </SheetDescription>
                    </SheetHeader>
                    <form
                        className="flex min-h-0 flex-1 flex-col"
                        onSubmit={(e) => {
                            e.preventDefault()
                            if (!valid || mutation.isPending) return
                            mutation.mutate(draft)
                        }}
                    >
                        <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
                            <div className="space-y-1.5">
                                <Label htmlFor="secret-label">Label</Label>
                                <Input
                                    id="secret-label"
                                    value={draft.label}
                                    onChange={(e) =>
                                        setDraft((prev) => ({ ...prev, label: e.target.value }))
                                    }
                                    required
                                    disabled={editingExisting !== null}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="secret-env-key">Env key</Label>
                                <Input
                                    id="secret-env-key"
                                    value={draft.envKey}
                                    onChange={(e) =>
                                        setDraft((prev) => ({ ...prev, envKey: e.target.value }))
                                    }
                                    placeholder="MY_SECRET"
                                    required
                                    disabled={editingExisting !== null}
                                />
                                <p className="text-xs text-muted-foreground">
                                    Becomes <code>{draft.envKey || 'MY_SECRET'}</code> inside the
                                    room.
                                </p>
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="secret-purpose">Purpose</Label>
                                <Select
                                    value={draft.purpose}
                                    onValueChange={(value) =>
                                        setDraft((prev) => ({
                                            ...prev,
                                            purpose: value as SecretPurpose,
                                        }))
                                    }
                                    disabled={editingExisting !== null}
                                >
                                    <SelectTrigger id="secret-purpose" className="w-full">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="generic">Generic</SelectItem>
                                        <SelectItem value="provider_api_key">
                                            Provider API key
                                        </SelectItem>
                                        <SelectItem value="webhook">Webhook</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="secret-provider">Provider (optional)</Label>
                                <Input
                                    id="secret-provider"
                                    value={draft.provider}
                                    onChange={(e) =>
                                        setDraft((prev) => ({
                                            ...prev,
                                            provider: e.target.value,
                                        }))
                                    }
                                    placeholder="anthropic"
                                    disabled={editingExisting !== null}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="secret-value">Secret value</Label>
                                <Input
                                    id="secret-value"
                                    type="password"
                                    value={draft.value}
                                    onChange={(e) =>
                                        setDraft((prev) => ({ ...prev, value: e.target.value }))
                                    }
                                    autoComplete="off"
                                    required
                                />
                                <p className="text-xs text-muted-foreground">
                                    Write-only. Cannot be retrieved after save.
                                </p>
                            </div>
                        </div>
                        <SheetFooter className="border-t border-border/60">
                            <div className="flex justify-end gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setOpen(false)}
                                    disabled={mutation.isPending}
                                >
                                    Cancel
                                </Button>
                                <Button type="submit" disabled={!valid || mutation.isPending}>
                                    {mutation.isPending ? (
                                        <Loader2Icon className="animate-spin" />
                                    ) : (
                                        <ShieldIcon />
                                    )}
                                    {editingExisting ? 'Replace value' : 'Save secret'}
                                </Button>
                            </div>
                        </SheetFooter>
                    </form>
                </SheetContent>
            </Sheet>
        </Section>
    )
}

function PauseAndArchiveSection({
    roomId,
    paused,
    loading,
}: {
    roomId: string
    paused: boolean
    loading: boolean
}) {
    const queryClient = useQueryClient()

    const pauseMutation = useMutation({
        mutationFn: (next: boolean) =>
            setRoomDesiredStateServer({
                data: { roomId, desiredState: next ? 'stopped' : 'running' },
            }),
        onSuccess: async (_data, next) => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['rooms-list'] }),
                queryClient.invalidateQueries({ queryKey: ['room-execution', roomId] }),
            ])
            toast.success(next ? 'Room paused' : 'Room resumed')
        },
        onError: (e: unknown) =>
            toast.error('Could not change room state', {
                description: e instanceof Error ? e.message : 'Unexpected error',
            }),
    })

    return (
        <Section
            title="Lifecycle"
            description="Pause work or archive the room."
            bodyClassName="p-0"
        >
            <div className="divide-y divide-border/60">
                <div className="flex items-center gap-4 px-4 py-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        {paused ? (
                            <PauseIcon className="size-4" />
                        ) : (
                            <PlayIcon className="size-4" />
                        )}
                    </span>
                    <div className="min-w-0 flex-1">
                        <h4 className="text-sm font-medium text-foreground">
                            {paused ? 'Room is paused' : 'Room is running'}
                        </h4>
                        <p className="text-xs text-muted-foreground">
                            Pause stops the runtime and cron jobs. Resume to bring it back.
                        </p>
                    </div>
                    <Switch
                        checked={paused}
                        disabled={loading || pauseMutation.isPending}
                        onCheckedChange={(next) => pauseMutation.mutate(next)}
                        aria-label={paused ? 'Resume room' : 'Pause room'}
                    />
                </div>
                <div className="flex items-center gap-4 px-4 py-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        <ArchiveIcon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                        <h4 className="text-sm font-medium text-foreground">Archive room</h4>
                        <p className="text-xs text-muted-foreground">
                            Hides the room and stops all execution. Cannot be undone.
                        </p>
                    </div>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <span>
                                <Button variant="outline" size="sm" disabled>
                                    <ArchiveIcon />
                                    Archive
                                </Button>
                            </span>
                        </TooltipTrigger>
                        <TooltipContent>
                            Coming soon. No archive endpoint exists yet.
                        </TooltipContent>
                    </Tooltip>
                </div>
            </div>
        </Section>
    )
}

function DangerZoneSection({
    roomId,
    roomSlug,
    roomDisplayName,
    loading,
}: {
    roomId: string
    roomSlug: string
    roomDisplayName: string
    loading: boolean
}) {
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const [showDeleteDialog, setShowDeleteDialog] = useState(false)
    const [confirmSlug, setConfirmSlug] = useState('')

    const deleteMutation = useMutation({
        mutationFn: () => deleteRoomServer({ data: { roomId, confirmSlug } }),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['rooms-list'] })
            toast.success('Room deleted')
            navigate({ to: '/' })
        },
        onError: (e: unknown) =>
            toast.error('Could not delete room', {
                description: e instanceof Error ? e.message : 'Unexpected error',
            }),
    })

    const canDelete = confirmSlug === roomSlug && roomSlug.length > 0

    return (
        <>
            <DangerZone
                title="Danger Zone"
                description="Irreversible actions that permanently affect this room."
            >
                <DangerZoneItem
                    icon={<Trash2Icon className="size-5" />}
                    title="Delete this room"
                    description="Permanently delete this room and all its sessions, files, jobs, and secrets. This action cannot be undone."
                    action={
                        <Button
                            variant="destructive"
                            size="sm"
                            disabled={loading}
                            onClick={() => setShowDeleteDialog(true)}
                        >
                            <Trash2Icon />
                            Delete room
                        </Button>
                    }
                />
            </DangerZone>

            <Dialog
                open={showDeleteDialog}
                onOpenChange={(open) => {
                    if (!open && !deleteMutation.isPending) {
                        setShowDeleteDialog(false)
                        setConfirmSlug('')
                    }
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-danger-fg">
                            <AlertTriangleIcon className="size-5" />
                            Delete {roomDisplayName || 'this room'}?
                        </DialogTitle>
                        <DialogDescription className="space-y-3 pt-2">
                            <span className="block">
                                This will permanently delete the room and all associated data:
                            </span>
                            <ul className="list-inside list-disc space-y-1 text-sm">
                                <li>All sessions and conversation history</li>
                                <li>All workspace files</li>
                                <li>All scheduled jobs</li>
                                <li>All room secrets and configuration</li>
                            </ul>
                            <span className="block font-medium text-foreground">
                                This action cannot be undone.
                            </span>
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2 py-2">
                        <Label htmlFor="confirm-slug">
                            Type{' '}
                            <span className="font-mono font-semibold text-foreground">
                                {roomSlug}
                            </span>{' '}
                            to confirm
                        </Label>
                        <Input
                            id="confirm-slug"
                            value={confirmSlug}
                            onChange={(e) => setConfirmSlug(e.target.value)}
                            placeholder={roomSlug}
                            autoComplete="off"
                            disabled={deleteMutation.isPending}
                        />
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => {
                                setShowDeleteDialog(false)
                                setConfirmSlug('')
                            }}
                            disabled={deleteMutation.isPending}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={() => deleteMutation.mutate()}
                            disabled={!canDelete || deleteMutation.isPending}
                        >
                            {deleteMutation.isPending ? (
                                <Loader2Icon className="animate-spin" />
                            ) : (
                                <Trash2Icon />
                            )}
                            Delete room permanently
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
