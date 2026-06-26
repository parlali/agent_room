import type { CapabilityId, UsageEventKind } from './domain-types'

export const WEB_ACCESS_CAPABILITY_IDS: CapabilityId[] = ['web_search', 'url_fetch']

export const WEB_ACCESS_CAPABILITY_LABEL = 'Web access'

const capabilityLabels: Record<CapabilityId, string> = {
    web_search: 'Web search',
    url_fetch: 'Web page fetch',
    documents: 'Documents',
    spreadsheets: 'Spreadsheets',
    presentations: 'Presentations',
    pdf: 'PDF',
    images: 'Images',
    mcp: 'Connected tools',
    shell_coding: 'Files and code',
}

export function capabilityLabel(id: CapabilityId): string {
    return capabilityLabels[id] ?? humanize(id)
}

const usageProviderLabels: Record<string, string> = {
    openrouter: 'Model usage',
    'openai-codex': 'Model usage',
    openai: 'Model usage',
    anthropic: 'Model usage',
    gemini: 'Model usage',
    brave: 'Web search',
    browserbase: 'Web search',
    searxng: 'Web search',
    fetch_url: 'Web page fetch',
}

export function usageProviderLabel(provider: string | null | undefined): string {
    if (!provider) return 'Usage'
    return usageProviderLabels[provider] ?? humanize(provider)
}

const usageKindLabels: Record<UsageEventKind, string> = {
    run: 'Agent run',
    provider: 'Model usage',
    tool: 'Tool use',
    document_worker: 'Document work',
    image: 'Image generation',
    job: 'Scheduled task',
}

export function usageKindLabel(kind: UsageEventKind): string {
    return usageKindLabels[kind] ?? humanize(kind)
}

function humanize(value: string): string {
    return value
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, (c) => c.toUpperCase())
}
