import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { PlugIcon } from 'lucide-react'
import {
    AttentionBanner,
    EmptyState,
    LoadingRows,
    SaveBar,
    Section,
    StateBadge,
    ToggleSelector,
} from '#/components/agent-room'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '#/components/ui/select'
import { describeProviderStatus } from '#/domain/state'
import { roomQueryKey, roomQueryPolicy } from '#/lib/room-query-keys'
import {
    getOperatorConfigServer,
    getRoomConfigServer,
    saveRoomConfigServer,
} from '#/routes/-operator-config-server'
import type { RoomConfigSnapshot } from '#/server/configuration/operator-configuration'
import type { ConfigDraft } from './model'
import { COMMON_TIMEZONES, configFromSnapshot, configsEqual } from './model'
import { CapabilitiesSection } from './capabilities-section'
import { GitHubSection } from './github-section'
import { ModelSection } from './model-section'
import { RoomModeSection } from './room-mode-section'
import { SecretsSection } from './secrets-section'
import { DangerZoneSection, PauseAndArchiveSection } from './lifecycle-sections'
import { Disclosure } from './shared'

export function RoomSettingsBody({
    roomId,
    snapshot,
    paused,
    roomSlug,
    roomDisplayName,
    loading,
    roomsLoading,
    onSaved,
}: {
    roomId: string
    snapshot: RoomConfigSnapshot | null
    paused: boolean
    roomSlug: string
    roomDisplayName: string
    loading: boolean
    roomsLoading: boolean
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
        mutationFn: async (input: ConfigDraft) => {
            const latest = await getRoomConfigServer({ data: { roomId } })
            return saveRoomConfigServer({
                data: {
                    roomId,
                    instructions: latest.config.instructions ?? '',
                    providerMode: input.providerMode,
                    providerConnectionId:
                        input.providerMode === 'app_connection'
                            ? input.providerConnectionId || null
                            : null,
                    roomMode: input.roomMode,
                    capabilityOverrides: input.capabilityOverrides,
                    imageProvider: input.imageProvider === 'inherit' ? null : input.imageProvider,
                    imageModel:
                        input.imageProvider === 'inherit' ? null : input.imageModel.trim() || null,
                    imageApiKey: input.imageApiKey || undefined,
                    cronTimezone: input.cronTimezone,
                    browserActionBudget: input.browserActionBudget,
                    mcpConnectionIds: input.mcpConnectionIds,
                    githubEnabled: input.githubEnabled,
                    githubInstallationId: input.githubInstallationId || null,
                    githubRepositories: input.githubRepositories,
                },
            })
        },
        onSuccess: async () => {
            await onSaved()
            toast.success('Room settings saved')
        },
        onError: (e: unknown) =>
            toast.error('Could not save room settings', {
                description: e instanceof Error ? e.message : 'Unexpected error',
            }),
    })

    const providers = snapshot?.providers ?? []
    const mcpConnections = snapshot?.mcpConnections ?? []

    const handleSave = () => {
        if (!draft || !dirty || mutation.isPending) return
        mutation.mutate(draft)
    }

    const handleRevert = () => {
        if (baseline) setDraft(baseline)
    }

    if (loading || !draft || !snapshot || operatorQuery.isLoading) {
        return (
            <Section title="Capabilities" description="Loading current configuration.">
                <LoadingRows count={4} />
            </Section>
        )
    }

    const operatorData = operatorQuery.data

    if (!operatorData) {
        return (
            <>
                <Section
                    title="Capabilities"
                    description="Room configuration options could not load."
                >
                    <AttentionBanner
                        tone="danger"
                        title="Could not load configuration options"
                        description="Something went wrong loading this room's settings. Try again."
                        action={
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => operatorQuery.refetch()}
                                disabled={operatorQuery.isFetching}
                            >
                                Retry
                            </Button>
                        }
                    />
                </Section>

                <PauseAndArchiveSection roomId={roomId} paused={paused} loading={roomsLoading} />

                <DangerZoneSection
                    roomId={roomId}
                    roomSlug={roomSlug}
                    roomDisplayName={roomDisplayName}
                    loading={roomsLoading}
                />
            </>
        )
    }

    return (
        <>
            <CapabilitiesSection
                draft={draft}
                appDefaults={operatorData.settings.capabilityDefaults ?? null}
                effectiveCapabilities={snapshot.effective.capabilities}
                searchReady={snapshot.effective.searchReady}
                imageReady={snapshot.effective.imageReady}
                onChange={(patch) => setDraft((prev) => (prev ? { ...prev, ...patch } : prev))}
                saving={mutation.isPending}
            />

            <RoomModeSection
                draft={draft}
                onChange={(patch) => setDraft((prev) => (prev ? { ...prev, ...patch } : prev))}
            />

            <ModelSection
                draft={draft}
                providers={providers}
                managedHostedAvailable={operatorData.onboarding.managedOpenRouterAvailable ?? null}
                onChange={(patch) => setDraft((prev) => (prev ? { ...prev, ...patch } : prev))}
            />

            <Disclosure
                title="Integrations"
                description="GitHub, connected tools, secrets, and task scheduling."
            >
                <GitHubSection
                    draft={draft}
                    github={snapshot.github}
                    onChange={(patch) => setDraft((prev) => (prev ? { ...prev, ...patch } : prev))}
                />

                <Section
                    title="Connected tools (MCP)"
                    description="Pick which MCP servers this room can use."
                    bodyClassName={mcpConnections.length === 0 ? 'p-4' : 'p-0'}
                >
                    {mcpConnections.length === 0 ? (
                        <EmptyState
                            icon={PlugIcon}
                            title="No MCP connections yet"
                            description="Add MCP servers from app settings, then enable them here."
                        />
                    ) : (
                        <ToggleSelector
                            items={mcpConnections}
                            selectedValues={draft.mcpConnectionIds}
                            getValue={(connection) => connection.id}
                            getAriaLabel={(connection) => `Toggle ${connection.name}`}
                            onCheckedChange={(connectionId, next) =>
                                setDraft((prev) => {
                                    if (!prev) return prev
                                    const ids = next
                                        ? Array.from(
                                              new Set([...prev.mcpConnectionIds, connectionId]),
                                          )
                                        : prev.mcpConnectionIds.filter((id) => id !== connectionId)
                                    return { ...prev, mcpConnectionIds: ids }
                                })
                            }
                            renderItem={(connection) => {
                                const status = describeProviderStatus(connection.status)
                                return (
                                    <>
                                        <div className="flex items-center gap-2">
                                            <h4 className="truncate text-sm font-medium text-foreground">
                                                {connection.name}
                                            </h4>
                                            <StateBadge tone={status.tone} label={status.label} />
                                        </div>
                                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                            {connection.serverKey} · {connection.transport}
                                        </p>
                                    </>
                                )
                            }}
                        />
                    )}
                </Section>

                <SecretsSection roomId={roomId} secrets={snapshot.roomSecrets} onSaved={onSaved} />

                <Section title="Task timezone" description="Scheduled tasks run on this timezone.">
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
                                    setDraft((prev) =>
                                        prev ? { ...prev, cronTimezone: value } : prev,
                                    )
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
            </Disclosure>

            <PauseAndArchiveSection roomId={roomId} paused={paused} loading={roomsLoading} />

            <DangerZoneSection
                roomId={roomId}
                roomSlug={roomSlug}
                roomDisplayName={roomDisplayName}
                loading={roomsLoading}
            />

            <SaveBar
                dirty={dirty}
                saving={mutation.isPending}
                onSave={handleSave}
                onRevert={handleRevert}
                saveLabel="Save settings"
            />
        </>
    )
}
