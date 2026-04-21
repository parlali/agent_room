import type { ProviderApi } from '../domain/types'

export function isOpenAICodexProvider(input: {
    provider: string
    api?: ProviderApi | string | null
}): boolean {
    return (
        input.provider.trim().toLowerCase() === 'openai-codex' ||
        input.api === 'openai-codex-responses'
    )
}

export function providerEnvKey(provider: string): string {
    const normalized = provider.trim().toLowerCase()
    const known: Record<string, string> = {
        anthropic: 'ANTHROPIC_API_KEY',
        openai: 'OPENAI_API_KEY',
        openrouter: 'OPENROUTER_API_KEY',
        google: 'GOOGLE_API_KEY',
        groq: 'GROQ_API_KEY',
        xai: 'XAI_API_KEY',
        cerebras: 'CEREBRAS_API_KEY',
    }

    return known[normalized] ?? `${upperSnake(normalized)}_API_KEY`
}

export function upperSnake(value: string): string {
    return value
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toUpperCase()
}

export function inferProviderAuthMode(input: {
    provider: string
    api: ProviderApi
}): 'api_key' | 'oauth' {
    return isOpenAICodexProvider(input) ? 'oauth' : 'api_key'
}

export function resolveProviderBaseUrl(input: {
    provider: string
    api: ProviderApi
    baseUrl: string | null
}): string | null {
    const provider = input.provider.trim().toLowerCase()
    if (isOpenAICodexProvider(input)) {
        return 'https://chatgpt.com/backend-api'
    }
    if (provider === 'openrouter') {
        return input.baseUrl ?? 'https://openrouter.ai/api/v1'
    }
    return input.baseUrl
}

export function normalizeProviderModel(provider: string, model: string): string {
    const normalizedProvider = provider.trim().toLowerCase()
    const trimmed = model.trim()
    const modelRef = trimmed.includes('/') ? trimmed : `${normalizedProvider}/${trimmed}`

    if (normalizedProvider === 'openai-codex') {
        if (modelRef.startsWith('openai/')) {
            return `openai-codex/${modelRef.slice('openai/'.length)}`
        }
        if (modelRef.startsWith('codex/')) {
            return `openai-codex/${modelRef.slice('codex/'.length)}`
        }
    }

    return modelRef
}
