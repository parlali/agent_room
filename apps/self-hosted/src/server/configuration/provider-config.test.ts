import { describe, expect, it } from 'vitest'
import {
    assertSupportedProvider,
    assertSupportedProviderApi,
    inferProviderAuthMode,
    normalizeProviderModel,
    resolveProviderBaseUrl,
} from './provider-config'

describe('provider config helpers', () => {
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

    it('pins Codex to its runtime provider URL and defaults OpenRouter to OpenRouter', () => {
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

    it('normalizes Codex app server models onto the Pi Codex provider route', () => {
        expect(normalizeProviderModel('openai-codex', 'gpt-5.4')).toBe('openai-codex/gpt-5.4')
        expect(normalizeProviderModel('openai-codex', 'openai/gpt-5.4')).toBe(
            'openai-codex/gpt-5.4',
        )
        expect(normalizeProviderModel('openai-codex', 'codex/gpt-5.4')).toBe('openai-codex/gpt-5.4')
    })

    it('fails closed for providers outside the supported v0 catalog', () => {
        expect(() => assertSupportedProvider('custom-openai-compatible')).toThrow('not supported')
        expect(() => assertSupportedProvider('lm-studio')).toThrow('not supported')
    })

    it('fails closed for provider API paths outside the supported catalog mapping', () => {
        expect(() => assertSupportedProviderApi('openrouter', 'openai-codex-responses')).toThrow(
            'must use openai-completions',
        )
        expect(() => assertSupportedProviderApi('openrouter', 'openai-completions')).not.toThrow()
    })
})
