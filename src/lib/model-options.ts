import type { OperatorConfigSnapshot } from '#/server/configuration/operator-configuration'
import type { ImageProviderId } from '#/server/domain/types'

export interface ModelOption {
    value: string
    label: string
}

const PROVIDER_MODEL_OPTIONS: Record<string, ModelOption[]> = {
    'openai-codex': [
        { value: 'openai-codex/gpt-5.5', label: 'GPT-5.5' },
        { value: 'openai-codex/gpt-5.4', label: 'GPT-5.4' },
        { value: 'openai-codex/gpt-5.4-mini', label: 'GPT-5.4 Mini' },
        { value: 'openai-codex/gpt-5.3-codex', label: 'GPT-5.3 Codex' },
        { value: 'openai-codex/gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark' },
    ],
    openrouter: [{ value: 'openrouter/auto', label: 'Automatic' }],
    google: [
        { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
        { value: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
        { value: 'google/gemini-3-pro-preview', label: 'Gemini 3 Pro Preview' },
    ],
    ollama: [{ value: 'ollama/llama3.2', label: 'Llama 3.2' }],
    lmstudio: [{ value: 'lmstudio/local-model', label: 'Local model' }],
}

export const IMAGE_MODEL_OPTIONS: Record<ImageProviderId, ModelOption[]> = {
    openai: [
        { value: 'gpt-image-2', label: 'GPT Image 2' },
        { value: 'gpt-image-1.5', label: 'GPT Image 1.5' },
        { value: 'gpt-image-1', label: 'GPT Image 1' },
        { value: 'gpt-image-1-mini', label: 'GPT Image 1 Mini' },
    ],
    gemini: [
        { value: 'gemini-3.1-flash-image-preview', label: 'Gemini 3.1 Flash Image Preview' },
        { value: 'gemini-3-pro-image-preview', label: 'Gemini 3 Pro Image Preview' },
        { value: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image' },
    ],
}

function includeCurrentOption(options: ModelOption[], current: string | null | undefined) {
    const value = current?.trim() ?? ''
    if (!value || options.some((option) => option.value === value)) {
        return options
    }
    return [{ value, label: value }, ...options]
}

export function providerModelOptionsForProvider(input: {
    provider: string
    currentModel?: string | null
    providerCatalog?: OperatorConfigSnapshot['providerCatalog']
}): ModelOption[] {
    const provider = input.provider.trim().toLowerCase()
    const catalogDefault = input.providerCatalog?.find((entry) => entry.provider === provider)
    const options = PROVIDER_MODEL_OPTIONS[provider] ?? []
    const withCatalogDefault = catalogDefault
        ? includeCurrentOption(options, catalogDefault.model)
        : options
    return includeCurrentOption(withCatalogDefault, input.currentModel)
}

export function imageModelOptionsForProvider(
    provider: ImageProviderId,
    currentModel?: string | null,
): ModelOption[] {
    return includeCurrentOption(IMAGE_MODEL_OPTIONS[provider], currentModel)
}
