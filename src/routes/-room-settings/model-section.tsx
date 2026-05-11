import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '#/components/ui/select'
import { Section } from '#/components/agent-room'
import { describeProviderStatus } from '#/lib/state'
import { providerModelOptionsForProvider } from '#/lib/model-options'
import type {
    OperatorConfigSnapshot,
    ProviderConnectionSummary,
} from '#/server/configuration/operator-configuration'
import type { ProviderApi } from '#/lib/domain-types'
import type { ConfigDraft } from './model'
import { ModeRadio, ModelSelect, SaveBar } from './shared'

export function ModelSection({
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
