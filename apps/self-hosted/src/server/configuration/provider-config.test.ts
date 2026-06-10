import { describe, expect, it } from 'vitest'
import {
    assertSupportedProvider,
    assertSupportedProviderApi,
    inferProviderAuthMode,
    normalizeProviderModel,
    providerEnvKey,
    resolveProviderBaseUrl,
} from './provider-config'

describe('provider config helpers', () => {
    it('uses canonical environment keys for provider credentials', () => {
        expect(providerEnvKey('openrouter')).toBe('OPENROUTER_API_KEY')
        expect(providerEnvKey('custom-provider')).toBe('CUSTOM_PROVIDER_API_KEY')
    })

    it('treats OpenAI Codex responses as OAuth-backed', () => {
        expect(
            inferProviderAuthMode({
                provider: 'openai-codex',
                api: 'openai-codex-responses',
            }),
        ).toBe('oauth')
        expect(
            inferProviderAuthMode({
                provider: 'openrouter',
                api: 'openai-completions',
            }),
        ).toBe('api_key')
    })

    it('pins Codex and OpenRouter to their runtime provider URLs', () => {
        expect(
            resolveProviderBaseUrl({
                provider: 'openai-codex',
                api: 'openai-codex-responses',
                baseUrl: 'https://example.invalid',
            }),
        ).toBe('https://chatgpt.com/backend-api')
        expect(
            resolveProviderBaseUrl({
                provider: 'openrouter',
                api: 'openai-completions',
                baseUrl: null,
            }),
        ).toBe('https://openrouter.ai/api/v1')
    })

    it('normalizes Codex OAuth models onto the Pi Codex provider route', () => {
        expect(normalizeProviderModel('openai-codex', 'gpt-5.4')).toBe('openai-codex/gpt-5.4')
        expect(normalizeProviderModel('openai-codex', 'openai/gpt-5.4')).toBe(
            'openai-codex/gpt-5.4',
        )
        expect(normalizeProviderModel('openai-codex', 'codex/gpt-5.4')).toBe('openai-codex/gpt-5.4')
    })

    it('fails closed for providers outside the supported v0 catalog', () => {
        expect(() => assertSupportedProvider('custom-openai-compatible')).toThrow('not supported')
        expect(() => assertSupportedProvider('lm-studio')).not.toThrow()
    })

    it('fails closed for provider API paths outside the supported catalog mapping', () => {
        expect(() => assertSupportedProviderApi('openrouter', 'openai-responses')).toThrow(
            'must use openai-completions',
        )
        expect(() => assertSupportedProviderApi('openrouter', 'openai-completions')).not.toThrow()
    })
})
