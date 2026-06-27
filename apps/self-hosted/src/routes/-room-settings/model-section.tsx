import { Label } from '#/components/ui/label'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '#/components/ui/select'
import { Section } from '#/components/agent-room'
import { describeProviderStatus } from '#/domain/state'
import type { ProviderConnectionSummary } from '#/server/configuration/operator-configuration'
import type { ConfigDraft } from './model'
import { InlineDisclosure, ModeRadio } from './shared'
import { RoomModeField } from './room-mode-section'

function providerConnectionOptionLabel(provider: ProviderConnectionSummary): string {
    return `${provider.label} - ${provider.defaultModel}`
}

export function ModelSection({
    draft,
    providers,
    managedHostedAvailable,
    onChange,
}: {
    draft: ConfigDraft
    providers: ProviderConnectionSummary[]
    managedHostedAvailable: boolean | null
    onChange: (patch: Partial<ConfigDraft>) => void
}) {
    const usesAppDefault =
        draft.providerMode === 'app_default' || draft.providerMode === 'managed_hosted'

    return (
        <Section
            title="Model"
            description="The model this room uses to think and respond."
        >
            <div className="space-y-4">
                <p className="text-sm text-foreground">
                    {usesAppDefault
                        ? 'Uses the app default model.'
                        : 'Uses a custom model set under Advanced.'}
                </p>

                <InlineDisclosure label="Advanced" defaultOpen={!usesAppDefault}>
                    {managedHostedAvailable !== null ? (
                        <HostedModelOverride
                            draft={draft}
                            providers={providers}
                            managedHostedAvailable={managedHostedAvailable}
                            onChange={onChange}
                        />
                    ) : (
                        <AppModelOverride
                            draft={draft}
                            providers={providers}
                            onChange={onChange}
                        />
                    )}

                    <div className="space-y-2">
                        <h3 className="text-sm font-medium text-foreground">Mode</h3>
                        <RoomModeField
                            draft={draft}
                            onChange={(roomMode) => onChange({ roomMode })}
                        />
                    </div>
                </InlineDisclosure>
            </div>
        </Section>
    )
}

function AppModelOverride({
    draft,
    providers,
    onChange,
}: {
    draft: ConfigDraft
    providers: ProviderConnectionSummary[]
    onChange: (patch: Partial<ConfigDraft>) => void
}) {
    return (
        <div className="space-y-4">
            <fieldset className="grid gap-2 sm:grid-cols-2">
                <ModeRadio
                    label="App default"
                    description="Use the default or only configured app provider."
                    checked={draft.providerMode === 'app_default'}
                    onSelect={() =>
                        onChange({
                            providerMode: 'app_default',
                            providerConnectionId: '',
                        })
                    }
                />
                <ModeRadio
                    label="Use this"
                    description="Pin one saved app provider for this room."
                    checked={draft.providerMode === 'app_connection'}
                    onSelect={() => onChange({ providerMode: 'app_connection' })}
                />
            </fieldset>

            {draft.providerMode === 'app_connection' ? (
                <div className="space-y-1.5">
                    <Label htmlFor="room-provider-connection">Saved app provider</Label>
                    {providers.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                            Add OpenRouter or Codex app server in app settings first.
                        </p>
                    ) : (
                        <Select
                            value={draft.providerConnectionId || ''}
                            onValueChange={(value) => onChange({ providerConnectionId: value })}
                        >
                            <SelectTrigger id="room-provider-connection" className="w-full">
                                <SelectValue placeholder="Pick a provider" />
                            </SelectTrigger>
                            <SelectContent>
                                {providers.map((provider) => {
                                    const status = describeProviderStatus(provider.status)
                                    return (
                                        <SelectItem key={provider.id} value={provider.id}>
                                            {provider.label} · {provider.defaultModel} ·{' '}
                                            {status.label}
                                        </SelectItem>
                                    )
                                })}
                            </SelectContent>
                        </Select>
                    )}
                </div>
            ) : null}
        </div>
    )
}

function HostedModelOverride({
    draft,
    providers,
    managedHostedAvailable,
    onChange,
}: {
    draft: ConfigDraft
    providers: ProviderConnectionSummary[]
    managedHostedAvailable: boolean
    onChange: (patch: Partial<ConfigDraft>) => void
}) {
    const readyProviders = providers.filter((provider) => provider.status === 'ready')
    const openRouterProviders = readyProviders.filter(
        (provider) => provider.provider === 'openrouter',
    )
    const codexProviders = readyProviders.filter((provider) => provider.provider === 'openai-codex')
    const selectedProvider = providers.find(
        (provider) => provider.id === draft.providerConnectionId,
    )
    const selectedSource =
        draft.providerMode === 'managed_hosted'
            ? 'hosted'
            : draft.providerMode === 'app_connection' && selectedProvider?.provider === 'openrouter'
              ? 'openrouter'
              : draft.providerMode === 'app_connection' &&
                  selectedProvider?.provider === 'openai-codex'
                ? 'codex'
                : null
    const selectedOptions =
        selectedSource === 'openrouter'
            ? openRouterProviders
            : selectedSource === 'codex'
              ? codexProviders
              : []
    const selectedLabel = selectedSource === 'openrouter' ? 'OpenRouter model' : 'Codex model'
    const selectSource = (source: 'hosted' | 'openrouter' | 'codex') => {
        if (source === 'hosted') {
            onChange({
                providerMode: 'managed_hosted',
                providerConnectionId: '',
            })
            return
        }
        const candidates = source === 'openrouter' ? openRouterProviders : codexProviders
        onChange({
            providerMode: 'app_connection',
            providerConnectionId: candidates[0]?.id ?? '',
        })
    }

    return (
        <div className="space-y-4">
            <fieldset className="grid gap-2 sm:grid-cols-3">
                <ModeRadio
                    label="Hosted"
                    description={
                        managedHostedAvailable
                            ? 'Use the managed hosted model.'
                            : 'Unavailable for this workspace.'
                    }
                    checked={selectedSource === 'hosted'}
                    disabled={!managedHostedAvailable}
                    onSelect={() => selectSource('hosted')}
                />
                <ModeRadio
                    label="OpenRouter"
                    description={
                        openRouterProviders.length > 0
                            ? 'Use a saved OpenRouter model.'
                            : 'Add a ready OpenRouter provider first.'
                    }
                    checked={selectedSource === 'openrouter'}
                    disabled={openRouterProviders.length === 0}
                    onSelect={() => selectSource('openrouter')}
                />
                <ModeRadio
                    label="Codex"
                    description={
                        codexProviders.length > 0
                            ? 'Use a saved Codex model.'
                            : 'Add a ready Codex provider first.'
                    }
                    checked={selectedSource === 'codex'}
                    disabled={codexProviders.length === 0}
                    onSelect={() => selectSource('codex')}
                />
            </fieldset>

            {selectedSource === 'openrouter' || selectedSource === 'codex' ? (
                <div className="space-y-1.5">
                    <Label htmlFor="room-provider-connection">{selectedLabel}</Label>
                    <Select
                        value={draft.providerConnectionId || ''}
                        onValueChange={(value) => onChange({ providerConnectionId: value })}
                    >
                        <SelectTrigger id="room-provider-connection" className="w-full">
                            <SelectValue placeholder="Pick a model" />
                        </SelectTrigger>
                        <SelectContent>
                            {selectedOptions.map((provider) => (
                                <SelectItem key={provider.id} value={provider.id}>
                                    {providerConnectionOptionLabel(provider)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            ) : null}
        </div>
    )
}
