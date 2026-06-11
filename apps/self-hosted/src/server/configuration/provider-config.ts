import type { ProviderApi } from '#/domain/domain-types'

export const providerCatalog = [
    {
        provider: 'openai-codex',
        label: 'Codex app server',
        api: 'openai-codex-responses' as const,
        model: 'openai-codex/gpt-5.5',
    },
    {
        provider: 'openrouter',
        label: 'OpenRouter',
        api: 'openai-completions' as const,
        model: 'openrouter/auto',
    },
] satisfies Array<{
    provider: string
    label: string
    api: ProviderApi
    model: string
}>

const supportedProviderIds = new Set(providerCatalog.map((entry) => entry.provider))

export function normalizeProviderId(provider: string): string {
    const normalized = provider.trim().toLowerCase()
    return normalized
}

export function isSupportedProvider(provider: string): boolean {
    return supportedProviderIds.has(normalizeProviderId(provider))
}

export function supportedProviderCatalogEntry(provider: string) {
    const normalized = normalizeProviderId(provider)
    return providerCatalog.find((entry) => entry.provider === normalized) ?? null
}

export function assertSupportedProvider(provider: string): void {
    if (!isSupportedProvider(provider)) {
        throw new Error(`Provider ${provider} is not supported by this Agent Room build`)
    }
}

export function assertSupportedProviderApi(provider: string, api: ProviderApi): void {
    const entry = supportedProviderCatalogEntry(provider)
    if (!entry) {
        throw new Error(`Provider ${provider} is not supported by this Agent Room build`)
    }
    if (entry.api !== api) {
        throw new Error(`Provider ${provider} must use ${entry.api}`)
    }
}

export function isOpenAICodexProvider(input: {
    provider: string
    api?: ProviderApi | string | null
}): boolean {
    return (
        normalizeProviderId(input.provider) === 'openai-codex' ||
        input.api === 'openai-codex-responses'
    )
}

export function isLocalProvider(provider: string): boolean {
    void provider
    return false
}

export function providerRequiresStoredCredential(input: {
    provider: string
    authMode: 'api_key' | 'oauth'
}): boolean {
    return input.authMode === 'api_key' && !isLocalProvider(input.provider)
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
    const provider = normalizeProviderId(input.provider)
    if (isOpenAICodexProvider(input)) {
        return 'https://chatgpt.com/backend-api'
    }
    if (provider === 'openrouter') {
        return input.baseUrl ?? 'https://openrouter.ai/api/v1'
    }
    return input.baseUrl
}

export function normalizeProviderModel(provider: string, model: string): string {
    const normalizedProvider = normalizeProviderId(provider)
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
