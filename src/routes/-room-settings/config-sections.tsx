import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { PlugIcon } from 'lucide-react'
import { EmptyState, LoadingRows, Section, StateBadge } from '#/components/agent-room'
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
import { roomQueryKey, roomQueryPolicy } from '#/lib/room-query-keys'
import { getOperatorConfigServer, saveRoomConfigServer } from '#/routes/-operator-config-server'
import type {
    ProviderConnectionSummary,
    RoomConfigSnapshot,
} from '#/server/configuration/operator-configuration'
import type { ProviderApi } from '#/lib/domain-types'
import type { ConfigDraft, ProviderMode } from './model'
import { COMMON_TIMEZONES, configFromSnapshot, configsEqual } from './model'
import { CapabilitiesSection } from './capabilities-section'
import { CodexOAuthSection } from './codex-oauth-section'
import { GitHubSection } from './github-section'
import { ModelSection } from './model-section'
import { RoomModeSection } from './room-mode-section'
import { SaveBar } from './shared'

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
        queryKey: roomQueryKey.operatorConfig,
        queryFn: () => getOperatorConfigServer(),
        staleTime: roomQueryPolicy.warmStaleMs,
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
    return input.providers.find((provider) => provider.id === id) ?? null
}
