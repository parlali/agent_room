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
import { ModeRadio, SaveBar } from './shared'

export function ModelSection({
    draft,
    providers,
    onChange,
    onSave,
    dirty,
    pending,
}: {
    draft: ConfigDraft
    providers: ProviderConnectionSummary[]
    onChange: (patch: Partial<ConfigDraft>) => void
    onSave: () => void
    dirty: boolean
    pending: boolean
}) {
    return (
        <Section
            title="Model"
            description="Rooms use app-level provider configuration."
            actions={<SaveBar dirty={dirty} pending={pending} onSave={onSave} />}
        >
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
        </Section>
    )
}
