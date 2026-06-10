import { CAPABILITY_OPTIONS } from '#/domain/capabilities'
import type {
    McpConnectionSummary,
    OperatorConfigSnapshot,
    ProviderConnectionSummary,
} from '#/server/configuration/operator-configuration'

export type ProviderApi = ProviderConnectionSummary['api']
export type ProviderAuthMode = ProviderConnectionSummary['authMode']
export type McpTransport = McpConnectionSummary['transport']
export type McpAuthMode = McpConnectionSummary['authMode']
export type AppCapabilityDefaults = OperatorConfigSnapshot['settings']['capabilityDefaults']

export type DeleteConnectionTarget =
    | { kind: 'provider'; entry: ProviderConnectionSummary }
    | { kind: 'mcp'; entry: McpConnectionSummary }

export function capabilityDefaultsEqual(
    left: AppCapabilityDefaults | null,
    right: AppCapabilityDefaults | null,
): boolean {
    if (!left || !right) return left === right
    return CAPABILITY_OPTIONS.every((option) => left[option.id] === right[option.id])
}

export const PROVIDER_API_OPTIONS: { value: ProviderApi; label: string }[] = [
    { value: 'openai-completions', label: 'OpenAI compatible' },
    { value: 'openai-responses', label: 'OpenAI Responses' },
    { value: 'openai-codex-responses', label: 'OpenAI Codex (OAuth)' },
    { value: 'anthropic-messages', label: 'Anthropic' },
    { value: 'google-generative-ai', label: 'Google Gemini' },
]

export const TRANSPORT_OPTIONS: { value: McpTransport; label: string }[] = [
    { value: 'stdio', label: 'Local command (stdio)' },
    { value: 'http', label: 'HTTP endpoint' },
    { value: 'streamable_http', label: 'Streamable HTTP' },
]

export interface ProviderFormState {
    id?: string
    label: string
    provider: string
    api: ProviderApi
    authMode: ProviderAuthMode
    baseUrl: string
    defaultModel: string
    fallbackModels: string
    apiKey: string
    replaceApiKey: boolean
    hasCredential: boolean
    makeDefault: boolean
}

export function resolveProviderFormProtocol(
    form: ProviderFormState,
    providerCatalog: OperatorConfigSnapshot['providerCatalog'],
): {
    selectedProvider: OperatorConfigSnapshot['providerCatalog'][number] | null
    api: ProviderApi
    authMode: ProviderAuthMode
} {
    const selectedProvider =
        providerCatalog.find((entry) => entry.provider === form.provider.trim()) ?? null
    const api = selectedProvider?.api ?? form.api
    const authMode = api === 'openai-codex-responses' ? 'oauth' : form.authMode

    return {
        selectedProvider,
        api,
        authMode,
    }
}

export const EMPTY_PROVIDER_FORM: ProviderFormState = {
    label: '',
    provider: 'openrouter',
    api: 'openai-completions',
    authMode: 'api_key',
    baseUrl: '',
    defaultModel: 'openrouter/auto',
    fallbackModels: '',
    apiKey: '',
    replaceApiKey: true,
    hasCredential: false,
    makeDefault: false,
}

export interface McpFormState {
    id?: string
    name: string
    serverKey: string
    transport: McpTransport
    command: string
    argsText: string
    url: string
    headersText: string
    authMode: McpAuthMode
    bearerToken: string
    replaceBearerToken: boolean
    hasCredential: boolean
    allowedToolsText: string
}

export const EMPTY_MCP_FORM: McpFormState = {
    name: '',
    serverKey: '',
    transport: 'stdio',
    command: '',
    argsText: '',
    url: '',
    headersText: '',
    authMode: 'none',
    bearerToken: '',
    replaceBearerToken: true,
    hasCredential: false,
    allowedToolsText: '',
}
