import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { defineTool, type ToolDefinition } from '@mariozechner/pi-coding-agent'
import { Type } from '@mariozechner/pi-ai'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import { clampPositiveInteger, textToolResult } from './tool-helpers'

interface WebToolContext {
    config: PiRuntimeConfig
    audit: (event: string, payload: unknown) => Promise<void>
}

export interface WebSearchResult {
    title: string
    url: string
    snippet: string
    engine: string | null
    fetchedAt: string
    rank: number
}

interface FetchResult {
    url: string
    finalUrl: string
    status: number
    contentType: string
    title: string | null
    text: string
    byteLength: number
    truncated: boolean
}

interface WebToolDetails {
    url?: string
    finalUrl?: string
    status?: number
    contentType?: string
    byteLength?: number
    truncated?: boolean
    resultCount?: number
}

const maxFetchBytes = 512000
const maxReturnedTextBytes = 128000
const maxRedirects = 5
const maxDomainFilters = 50

function normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return []
    }
    return value
        .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        .map((entry) => entry.trim().toLowerCase())
        .slice(0, maxDomainFilters)
}

function domainMatches(hostname: string, domain: string): boolean {
    const normalizedHost = hostname.toLowerCase().replace(/\.$/, '')
    const normalizedDomain = domain.toLowerCase().replace(/^\*\./, '').replace(/\.$/, '')
    return normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`)
}

function filterResultsByDomain(input: {
    results: WebSearchResult[]
    allowedDomains: string[]
    blockedDomains: string[]
}): WebSearchResult[] {
    return input.results.filter((result) => {
        let hostname = ''
        try {
            hostname = new URL(result.url).hostname
        } catch {
            return false
        }
        if (input.blockedDomains.some((domain) => domainMatches(hostname, domain))) {
            return false
        }
        return (
            input.allowedDomains.length === 0 ||
            input.allowedDomains.some((domain) => domainMatches(hostname, domain))
        )
    })
}

function parseEngines(value: unknown): string | null {
    if (typeof value === 'string' && value.trim()) {
        return value.trim()
    }
    if (Array.isArray(value)) {
        const engines = value
            .filter(
                (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0,
            )
            .map((entry) => entry.trim())
        return engines.length > 0 ? engines.join(', ') : null
    }
    return null
}

export function normalizeSearxngSafeSearch(value: string | null | undefined): string | null {
    const normalized = value?.trim().toLowerCase()
    if (!normalized) {
        return null
    }
    if (['0', 'off', 'none', 'false'].includes(normalized)) {
        return '0'
    }
    if (['1', 'moderate', 'medium', 'true'].includes(normalized)) {
        return '1'
    }
    if (['2', 'strict', 'high'].includes(normalized)) {
        return '2'
    }
    throw new Error('safeSearch must be off, moderate, strict, 0, 1, or 2')
}

export function parseSearxngResults(value: unknown, fetchedAt: string): WebSearchResult[] {
    if (
        !value ||
        typeof value !== 'object' ||
        !Array.isArray((value as { results?: unknown }).results)
    ) {
        return []
    }

    return (value as { results: unknown[] }).results
        .map((entry, index): WebSearchResult | null => {
            if (!entry || typeof entry !== 'object') {
                return null
            }
            const record = entry as Record<string, unknown>
            const url = typeof record.url === 'string' ? record.url.trim() : ''
            const title = typeof record.title === 'string' ? record.title.trim() : ''
            if (!url || !title) {
                return null
            }
            try {
                const parsed = new URL(url)
                if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                    return null
                }
            } catch {
                return null
            }
            return {
                title,
                url,
                snippet:
                    typeof record.content === 'string'
                        ? record.content.trim()
                        : typeof record.snippet === 'string'
                          ? record.snippet.trim()
                          : '',
                engine: parseEngines(record.engine ?? record.engines),
                fetchedAt,
                rank: index + 1,
            }
        })
        .filter((entry): entry is WebSearchResult => entry !== null)
}

async function searxngSearch(input: {
    config: PiRuntimeConfig
    query: string
    count: number
    language?: string | null
    freshness?: string | null
    safeSearch?: string | null
    location?: string | null
    signal?: AbortSignal
}): Promise<WebSearchResult[]> {
    if (!input.config.search.enabled || !input.config.search.backendUrl) {
        throw new Error('Web search is not configured')
    }
    const query = input.query.trim()
    if (!query) {
        throw new Error('Search query cannot be empty')
    }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), input.config.search.timeoutMs)
    timeout.unref?.()
    input.signal?.addEventListener('abort', () => controller.abort(), { once: true })

    const url = new URL('/search', input.config.search.backendUrl)
    url.searchParams.set('q', query)
    url.searchParams.set('format', 'json')
    url.searchParams.set('categories', 'general')
    url.searchParams.set('pageno', '1')
    if (input.language?.trim()) {
        url.searchParams.set('language', input.language.trim())
    }
    if (input.freshness?.trim()) {
        url.searchParams.set('time_range', input.freshness.trim())
    }
    const safeSearch = normalizeSearxngSafeSearch(input.safeSearch)
    if (safeSearch) {
        url.searchParams.set('safesearch', safeSearch)
    }
    if (input.location?.trim()) {
        url.searchParams.set('locale', input.location.trim())
    }

    try {
        const response = await fetch(url, {
            headers: {
                accept: 'application/json',
            },
            signal: controller.signal,
        })
        if (!response.ok) {
            throw new Error(`Search backend returned ${response.status}`)
        }
        const parsed = parseSearxngResults(await response.json(), new Date().toISOString())
        return parsed.slice(0, input.count)
    } finally {
        clearTimeout(timeout)
    }
}

function parseIpv4(value: string): number | null {
    const parts = value.split('.').map((part) => Number(part))
    if (
        parts.length !== 4 ||
        parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
    ) {
        return null
    }
    return (((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!) >>> 0
}

function ipv4InRange(value: string, base: string, mask: number): boolean {
    const address = parseIpv4(value)
    const baseAddress = parseIpv4(base)
    if (address === null || baseAddress === null) {
        return false
    }
    const maskValue = mask === 0 ? 0 : (0xffffffff << (32 - mask)) >>> 0
    return (address & maskValue) === (baseAddress & maskValue)
}

function isBlockedIpv4(value: string): boolean {
    return [
        ['0.0.0.0', 8],
        ['10.0.0.0', 8],
        ['100.64.0.0', 10],
        ['127.0.0.0', 8],
        ['169.254.0.0', 16],
        ['172.16.0.0', 12],
        ['192.0.0.0', 24],
        ['192.168.0.0', 16],
        ['224.0.0.0', 4],
        ['240.0.0.0', 4],
    ].some(([base, mask]) => ipv4InRange(value, String(base), Number(mask)))
}

function isBlockedIpv6(value: string): boolean {
    const normalized = value.toLowerCase()
    return (
        normalized === '::' ||
        normalized === '::1' ||
        normalized.startsWith('fc') ||
        normalized.startsWith('fd') ||
        normalized.startsWith('fe8') ||
        normalized.startsWith('fe9') ||
        normalized.startsWith('fea') ||
        normalized.startsWith('feb') ||
        normalized.startsWith('ff')
    )
}

function ipv4FromMappedIpv6(value: string): string | null {
    const normalized = value.toLowerCase()
    const dotted = normalized.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/)
    if (dotted) {
        return dotted[1]!
    }
    const hex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
    if (!hex) {
        return null
    }
    const high = Number.parseInt(hex[1]!, 16)
    const low = Number.parseInt(hex[2]!, 16)
    if (!Number.isFinite(high) || !Number.isFinite(low)) {
        return null
    }
    return `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`
}

export function isBlockedNetworkAddress(value: string): boolean {
    if (isIP(value) === 4) {
        return isBlockedIpv4(value)
    }
    if (isIP(value) === 6) {
        const mapped = ipv4FromMappedIpv6(value)
        return mapped ? isBlockedIpv4(mapped) : isBlockedIpv6(value)
    }
    return false
}

export async function assertSafeUrl(url: URL): Promise<void> {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('Only http and https URLs can be fetched')
    }
    if (url.username || url.password) {
        throw new Error('URLs with embedded credentials cannot be fetched')
    }
    const hostname = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1')
    if (
        hostname === 'localhost' ||
        hostname.endsWith('.localhost') ||
        hostname.endsWith('.local') ||
        hostname === 'metadata' ||
        hostname === 'metadata.google.internal'
    ) {
        throw new Error('Local and metadata hostnames cannot be fetched')
    }
    if (isBlockedNetworkAddress(hostname)) {
        throw new Error('Local and private network addresses cannot be fetched')
    }
    const addresses = await lookup(hostname, {
        all: true,
        verbatim: true,
    })
    if (addresses.some((entry) => isBlockedNetworkAddress(entry.address))) {
        throw new Error('URL resolves to a local or private network address')
    }
}

export function sanitizeUrlForAudit(value: string): string {
    try {
        const url = new URL(value)
        const hadSearch = url.search.length > 0
        const hadHash = url.hash.length > 0
        url.username = ''
        url.password = ''
        url.search = ''
        url.hash = ''
        return `${url.toString()}${hadSearch ? '?[redacted]' : ''}${hadHash ? '#[redacted]' : ''}`
    } catch {
        return '[invalid-url]'
    }
}

function isAllowedContentType(contentType: string): boolean {
    const lower = contentType.toLowerCase()
    return (
        lower.startsWith('text/') ||
        lower.includes('json') ||
        lower.includes('xml') ||
        lower.includes('xhtml') ||
        lower === ''
    )
}

async function readBoundedBody(response: Response): Promise<{
    buffer: Buffer
    truncated: boolean
}> {
    if (!response.body) {
        return {
            buffer: Buffer.alloc(0),
            truncated: false,
        }
    }
    const reader = response.body.getReader()
    const chunks: Buffer[] = []
    let byteLength = 0
    let truncated = false
    while (true) {
        const next = await reader.read()
        if (next.done) {
            break
        }
        const chunk = Buffer.from(next.value)
        byteLength += chunk.byteLength
        if (byteLength > maxFetchBytes) {
            truncated = true
            const remaining = Math.max(
                0,
                maxFetchBytes - chunks.reduce((sum, item) => sum + item.byteLength, 0),
            )
            if (remaining > 0) {
                chunks.push(chunk.subarray(0, remaining))
            }
            await reader.cancel()
            break
        }
        chunks.push(chunk)
    }
    return {
        buffer: Buffer.concat(chunks),
        truncated,
    }
}

function extractTitle(html: string): string | null {
    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    return match ? decodeHtml(match[1]!.replace(/\s+/g, ' ').trim()) : null
}

function decodeHtml(value: string): string {
    return value
        .replaceAll('&amp;', '&')
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&quot;', '"')
        .replaceAll('&#39;', "'")
        .replaceAll('&nbsp;', ' ')
}

function extractText(
    content: string,
    contentType: string,
): {
    text: string
    title: string | null
} {
    if (!contentType.toLowerCase().includes('html')) {
        return {
            text: content.replace(/\s+/g, ' ').trim(),
            title: null,
        }
    }
    const withoutScripts = content
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    const title = extractTitle(withoutScripts)
    const text = decodeHtml(
        withoutScripts
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim(),
    )
    return {
        text,
        title,
    }
}

function boundReturnText(text: string): {
    text: string
    truncated: boolean
} {
    const buffer = Buffer.from(text)
    if (buffer.byteLength <= maxReturnedTextBytes) {
        return {
            text,
            truncated: false,
        }
    }
    return {
        text: buffer.subarray(0, maxReturnedTextBytes).toString('utf8'),
        truncated: true,
    }
}

async function fetchUrl(input: {
    url: string
    timeoutMs: number
    signal?: AbortSignal
}): Promise<FetchResult> {
    let current = new URL(input.url)
    await assertSafeUrl(current)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs)
    timeout.unref?.()
    input.signal?.addEventListener('abort', () => controller.abort(), { once: true })

    try {
        let response: Response | null = null
        for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
            response = await fetch(current, {
                redirect: 'manual',
                headers: {
                    accept: 'text/html, text/plain, application/json, application/xml, text/xml;q=0.9, */*;q=0.1',
                    'user-agent': 'AgentRoomBot/1.0',
                },
                signal: controller.signal,
            })
            if (response.status < 300 || response.status >= 400) {
                break
            }
            const location = response.headers.get('location')
            if (!location) {
                break
            }
            current = new URL(location, current)
            await assertSafeUrl(current)
            response = null
        }
        if (!response) {
            throw new Error('Too many redirects')
        }
        const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? ''
        if (!isAllowedContentType(contentType)) {
            throw new Error(`Content type ${contentType || 'unknown'} is not fetchable as text`)
        }
        const body = await readBoundedBody(response)
        const content = body.buffer.toString('utf8')
        const extracted = extractText(content, contentType)
        const bounded = boundReturnText(extracted.text)
        return {
            url: input.url,
            finalUrl: current.toString(),
            status: response.status,
            contentType,
            title: extracted.title,
            text: bounded.text,
            byteLength: body.buffer.byteLength,
            truncated: body.truncated || bounded.truncated,
        }
    } finally {
        clearTimeout(timeout)
    }
}

function formatSearchResults(results: WebSearchResult[]): string {
    return results
        .map((result) =>
            [
                `${result.rank}. ${result.title}`,
                `URL: ${result.url}`,
                `Source: ${result.engine ?? 'unknown'}`,
                `Fetched: ${result.fetchedAt}`,
                result.snippet ? `Snippet: ${result.snippet}` : null,
            ]
                .filter((line): line is string => line !== null)
                .join('\n'),
        )
        .join('\n\n')
}

function createWebSearchTool(ctx: WebToolContext): ToolDefinition {
    return defineTool({
        name: 'agent_room_web_search',
        label: 'Web Search',
        description: 'Search the web through the configured room search backend.',
        promptSnippet:
            'agent_room_web_search returns bounded cited web results for current or external facts.',
        parameters: Type.Object({
            query: Type.String(),
            count: Type.Optional(Type.Number()),
            language: Type.Optional(Type.String()),
            freshness: Type.Optional(Type.String()),
            safeSearch: Type.Optional(Type.String()),
            allowedDomains: Type.Optional(Type.Array(Type.String())),
            blockedDomains: Type.Optional(Type.Array(Type.String())),
            location: Type.Optional(Type.String()),
        }),
        execute: async (_toolCallId, input, signal) => {
            const count = clampPositiveInteger(
                input.count,
                ctx.config.search.defaultResultCount,
                20,
            )
            try {
                const results = filterResultsByDomain({
                    results: await searxngSearch({
                        config: ctx.config,
                        query: input.query,
                        count: Math.min(20, count + 20),
                        language: input.language,
                        freshness: input.freshness,
                        safeSearch: input.safeSearch,
                        location: input.location,
                        signal,
                    }),
                    allowedDomains: normalizeStringArray(input.allowedDomains),
                    blockedDomains: normalizeStringArray(input.blockedDomains),
                }).slice(0, count)
                await ctx.audit('tool.web_search', {
                    query: input.query,
                    resultCount: results.length,
                    status: 'complete',
                })
                return textToolResult<WebToolDetails>(formatSearchResults(results), {
                    resultCount: results.length,
                })
            } catch (error) {
                await ctx.audit('tool.web_search', {
                    query: input.query,
                    resultCount: 0,
                    status: 'failed',
                    error: error instanceof Error ? error.message : 'Unknown web search error',
                })
                throw error
            }
        },
    })
}

function createFetchUrlTool(ctx: WebToolContext): ToolDefinition {
    return defineTool({
        name: 'agent_room_fetch_url',
        label: 'Fetch URL',
        description: 'Fetch and extract bounded text from a public http or https URL.',
        promptSnippet:
            'agent_room_fetch_url fetches known public URLs with SSRF protections and text caps.',
        parameters: Type.Object({
            url: Type.String(),
            timeoutMs: Type.Optional(Type.Number()),
        }),
        execute: async (_toolCallId, input, signal) => {
            try {
                const result = await fetchUrl({
                    url: input.url,
                    timeoutMs: clampPositiveInteger(
                        input.timeoutMs,
                        ctx.config.budgets.webFetchMs,
                        ctx.config.budgets.webFetchMs,
                    ),
                    signal,
                })
                const loggedUrl = sanitizeUrlForAudit(result.url)
                const loggedFinalUrl = sanitizeUrlForAudit(result.finalUrl)
                await ctx.audit('tool.fetch_url', {
                    url: loggedUrl,
                    finalUrl: loggedFinalUrl,
                    status: result.status,
                    contentType: result.contentType,
                    byteLength: result.byteLength,
                    truncated: result.truncated,
                })
                const header = [
                    `URL: ${loggedUrl}`,
                    `Final URL: ${loggedFinalUrl}`,
                    `Status: ${result.status}`,
                    `Content-Type: ${result.contentType || 'unknown'}`,
                    result.title ? `Title: ${result.title}` : null,
                    `Truncated: ${result.truncated}`,
                ]
                    .filter((line): line is string => line !== null)
                    .join('\n')
                return textToolResult<WebToolDetails>(`${header}\n\n${result.text}`, {
                    url: loggedUrl,
                    finalUrl: loggedFinalUrl,
                    status: result.status,
                    contentType: result.contentType,
                    byteLength: result.byteLength,
                    truncated: result.truncated,
                })
            } catch (error) {
                await ctx.audit('tool.fetch_url', {
                    url: sanitizeUrlForAudit(input.url),
                    status: 'failed',
                    error: error instanceof Error ? error.message : 'Unknown URL fetch error',
                })
                throw error
            }
        },
    })
}

export function createWebTools(ctx: WebToolContext): ToolDefinition[] {
    const tools: ToolDefinition[] = []
    if (ctx.config.capabilities.webSearch) {
        tools.push(createWebSearchTool(ctx))
    }
    if (ctx.config.capabilities.urlFetch) {
        tools.push(createFetchUrlTool(ctx))
    }
    return tools
}
