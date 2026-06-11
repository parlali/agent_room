import type { FormEvent } from 'react'
import { KeyRoundIcon } from 'lucide-react'

import { AttentionBanner } from '#/components/agent-room'
import { Switch } from '#/components/ui/switch'
import { providerModelOptionsForProvider } from '#/domain/model-options'
import type { OperatorConfigSnapshot } from '#/server/configuration/operator-configuration'

import { type ProviderFormState, resolveProviderFormProtocol } from './-form-model'
import {
    FieldGroup,
    FormShell,
    MaskedSecretField,
    ModelSelectField,
    SelectField,
    TextField,
} from './-form-controls'

export function ProviderForm({
    form,
    setForm,
    onSubmit,
    onCancel,
    pending,
    providerCatalog,
}: {
    form: ProviderFormState
    setForm: (patch: Partial<ProviderFormState>) => void
    onSubmit: (event: FormEvent<HTMLFormElement>) => void
    onCancel: () => void
    pending: boolean
    providerCatalog: OperatorConfigSnapshot['providerCatalog']
}) {
    const protocol = resolveProviderFormProtocol(form, providerCatalog)
    const usesOAuth = protocol.authMode === 'oauth' || protocol.api === 'openai-codex-responses'
    const providerOptions = providerCatalog.map((entry) => ({
        value: entry.provider,
        label: entry.label,
    }))
    const providerModelOptions = providerModelOptionsForProvider({
        provider: form.provider,
        currentModel: form.defaultModel,
        providerCatalog,
    })
    return (
        <FormShell
            onSubmit={onSubmit}
            onCancel={onCancel}
            pending={pending}
            submitLabel={form.id ? 'Save provider' : 'Create provider'}
            submitIcon={<KeyRoundIcon />}
        >
            <TextField
                id="provider-label"
                label="Label"
                value={form.label}
                onChange={(label) => setForm({ label })}
                placeholder="OpenRouter"
            />
            <SelectField
                id="provider-key"
                label="Provider"
                value={form.provider}
                onChange={(provider) => {
                    const selected = providerCatalog.find((entry) => entry.provider === provider)
                    setForm({
                        provider,
                        defaultModel: selected?.model ?? form.defaultModel,
                    })
                }}
                options={providerOptions}
            />
            <FieldGroup label="Auth mode">
                <div className="flex min-h-10 items-center rounded-md border border-border bg-muted/30 px-3 text-sm">
                    {usesOAuth ? 'OpenAI token verification' : 'OpenRouter API key'}
                </div>
            </FieldGroup>
            <ModelSelectField
                id="provider-default-model"
                label="Default model"
                value={form.defaultModel}
                onChange={(defaultModel) => setForm({ defaultModel })}
                options={providerModelOptions}
            />
            <TextField
                id="provider-fallback-models"
                label="Fallback models"
                value={form.fallbackModels}
                onChange={(fallbackModels) => setForm({ fallbackModels })}
                placeholder="provider/model, provider/model"
                hint="Comma separated. Used in order if the default fails."
            />
            {usesOAuth ? (
                <AttentionBanner
                    tone="info"
                    title="OpenAI token verification"
                    description="Use the Codex app server authorization section in app settings to generate and verify the OpenAI code."
                />
            ) : (
                <MaskedSecretField
                    label="API key"
                    id="provider-api-key"
                    hasCredential={form.hasCredential}
                    replace={form.replaceApiKey}
                    onToggleReplace={(replace) =>
                        setForm({ replaceApiKey: replace, apiKey: replace ? form.apiKey : '' })
                    }
                    value={form.apiKey}
                    onChange={(apiKey) => setForm({ apiKey })}
                    placeholder="sk-..."
                />
            )}
            <label className="flex items-start justify-between gap-3 rounded-lg border border-border/60 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-foreground">Use as app default</div>
                    <p className="text-xs text-muted-foreground">
                        New rooms inherit this connection unless overridden.
                    </p>
                </div>
                <Switch
                    checked={form.makeDefault}
                    onCheckedChange={(makeDefault) => setForm({ makeDefault })}
                />
            </label>
        </FormShell>
    )
}
