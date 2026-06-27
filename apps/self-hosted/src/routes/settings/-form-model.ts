import { CAPABILITY_OPTIONS } from '#/domain/capabilities'
import type {
    McpConnectionSummary,
    OperatorConfigSnapshot,
    ProviderConnectionSummary,
} from '#/server/configuration/operator-configuration'

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

export const TRANSPORT_OPTIONS: { value: McpTransport; label: string }[] = [
    { value: 'stdio', label: 'Local command (stdio)' },
    { value: 'http', label: 'HTTP endpoint' },
    { value: 'streamable_http', label: 'Streamable HTTP' },
]

export interface ProviderFormState {
    id?: string
    label: string
    provider: string
    defaultModel: string
    fallbackModels: string
    apiKey: string
    replaceApiKey: boolean
    hasCredential: boolean
}

export function resolveProviderFormProtocol(
    form: ProviderFormState,
    providerCatalog: OperatorConfigSnapshot['providerCatalog'],
): {
    selectedProvider: OperatorConfigSnapshot['providerCatalog'][number] | null
    api: ProviderConnectionSummary['api']
    authMode: ProviderConnectionSummary['authMode']
} {
    const selectedProvider =
        providerCatalog.find((entry) => entry.provider === form.provider.trim()) ?? null
    const api = selectedProvider?.api ?? 'openai-completions'
    const authMode = api === 'openai-codex-responses' ? 'oauth' : 'api_key'

    return {
        selectedProvider,
        api,
        authMode,
    }
}

export const EMPTY_PROVIDER_FORM: ProviderFormState = {
    label: '',
    provider: 'openrouter',
    defaultModel: 'openrouter/auto',
    fallbackModels: '',
    apiKey: '',
    replaceApiKey: true,
    hasCredential: false,
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
