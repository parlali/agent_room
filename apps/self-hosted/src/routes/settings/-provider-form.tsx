import type { FormEvent } from 'react'
import { KeyRoundIcon } from 'lucide-react'

import { AttentionBanner } from '#/components/agent-room'
import { Switch } from '#/components/ui/switch'
import { providerModelOptionsForProvider } from '#/domain/model-options'
import type { OperatorConfigSnapshot } from '#/server/configuration/operator-configuration'

import {
    PROVIDER_API_OPTIONS,
    type ProviderAuthMode,
    type ProviderFormState,
    resolveProviderFormProtocol,
} from './-form-model'
import {
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
    const providerApiOptions = protocol.selectedProvider
        ? PROVIDER_API_OPTIONS.filter((option) => option.value === protocol.selectedProvider?.api)
        : PROVIDER_API_OPTIONS
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
            <div className="grid gap-3 sm:grid-cols-2">
                <SelectField
                    id="provider-key"
                    label="Provider"
                    value={form.provider}
                    onChange={(provider) => {
                        const selected = providerCatalog.find(
                            (entry) => entry.provider === provider,
                        )
                        setForm({
                            provider,
                            api: selected?.api ?? form.api,
                            authMode:
                                selected?.api === 'openai-codex-responses'
                                    ? 'oauth'
                                    : form.authMode === 'oauth'
                                      ? 'api_key'
                                      : form.authMode,
                            defaultModel: selected?.model ?? form.defaultModel,
                        })
                    }}
                    options={providerOptions}
                />
                <SelectField
                    id="provider-api"
                    label="API"
                    value={protocol.api}
                    onChange={(api) => setForm({ api })}
                    options={providerApiOptions}
                />
            </div>
            <SelectField<ProviderAuthMode>
                id="provider-auth"
                label="Auth mode"
                value={protocol.authMode}
                onChange={(authMode) => setForm({ authMode })}
                options={[
                    { value: 'api_key', label: 'API key' },
                    { value: 'oauth', label: 'OAuth (browser)' },
                ]}
            />
            <TextField
                id="provider-base-url"
                label="Base URL"
                value={form.baseUrl}
                onChange={(baseUrl) => setForm({ baseUrl })}
                placeholder="https://"
                hint="Optional override for OpenRouter, Ollama, or LM Studio endpoints."
            />
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
                    title="Browser login"
                    description="OAuth providers complete sign-in per room. No API key is stored."
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
