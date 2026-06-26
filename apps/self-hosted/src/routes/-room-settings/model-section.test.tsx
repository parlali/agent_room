import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ProviderConnectionSummary } from '#/server/configuration/operator-configuration'
import { hostedManagedModelId } from '#/server/cloudflare/hosted-model-policy'
import type { ConfigDraft } from './model'
import { ModelSection, providerConnectionOptionLabel } from './model-section'

function draft(input: Partial<ConfigDraft> = {}): ConfigDraft {
    return {
        instructions: '',
        providerMode: 'managed_hosted',
        providerConnectionId: '',
        roomMode: 'coworker',
        capabilityOverrides: {},
        imageProvider: 'inherit',
        imageModel: '',
        imageApiKey: '',
        cronTimezone: 'UTC',
        browserActionBudget: 50,
        mcpConnectionIds: [],
        githubEnabled: false,
        githubInstallationId: '',
        githubRepositories: [],
        ...input,
    }
}

function provider(input: Partial<ProviderConnectionSummary>): ProviderConnectionSummary {
    return {
        id: 'provider_1',
        label: 'Provider',
        provider: 'openrouter',
        authMode: 'api_key',
        api: 'openai-completions',
        baseUrl: null,
        defaultModel: 'openrouter/auto',
        fallbackModels: [],
        hasCredential: true,
        status: 'ready',
        validationMessage: null,
        lastValidatedAt: null,
        updatedAt: new Date(0).toISOString(),
        ...input,
    }
}

describe('room model section', () => {
    it('renders hosted model source choices without exposing the hosted model id', () => {
        const providers = [
            provider({
                id: 'openrouter_1',
                label: 'OpenRouter',
                provider: 'openrouter',
                defaultModel: 'openrouter/auto',
            }),
            provider({
                id: 'codex_1',
                label: 'Codex',
                provider: 'openai-codex',
                authMode: 'oauth',
                api: 'openai-codex-responses',
                defaultModel: 'openai-codex/gpt-5.5',
            }),
        ]
        const hostedHtml = renderToStaticMarkup(
            <ModelSection
                draft={draft()}
                providers={providers}
                managedHostedAvailable
                onChange={() => undefined}
                onSave={() => undefined}
                dirty={false}
                pending={false}
            />,
        )

        expect(hostedHtml).toContain('Hosted')
        expect(hostedHtml).toContain('OpenRouter')
        expect(hostedHtml).toContain('Codex')
        expect(hostedHtml).not.toContain(hostedManagedModelId)
    })

    it('keeps the hosted selector while managed availability is still unavailable', () => {
        const hostedHtml = renderToStaticMarkup(
            <ModelSection
                draft={draft()}
                providers={[]}
                managedHostedAvailable={false}
                onChange={() => undefined}
                onSave={() => undefined}
                dirty={false}
                pending={false}
            />,
        )

        expect(hostedHtml).toContain('Hosted')
        expect(hostedHtml).toContain('OpenRouter')
        expect(hostedHtml).toContain('Codex')
        expect(hostedHtml).not.toContain('App default')
        expect(hostedHtml).not.toContain('Use this')
    })

    it('keeps provider labels in hosted BYOK dropdown option labels', () => {
        expect(
            providerConnectionOptionLabel(
                provider({
                    label: 'Production OpenRouter',
                    defaultModel: 'openrouter/auto',
                }),
            ),
        ).toBe('Production OpenRouter - openrouter/auto')
    })
})
