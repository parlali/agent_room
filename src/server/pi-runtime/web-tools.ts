import { defineTool, type ToolDefinition } from '@mariozechner/pi-coding-agent'
import { Type } from '@mariozechner/pi-ai'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import { boundToolOutput, type ToolOutputArtifact } from './tool-output-bounds'
import { clampPositiveInteger, textToolResult } from './tool-helpers'
import { fetchUrl } from './web-fetch'
import {
    filterResultsByDomain,
    formatSearchResults,
    normalizeStringArray,
    SearchRouter,
    type SearchBackendFormat,
    type SearchFallbackStep,
} from './web-search'
import { sanitizeUrlForAudit } from './web-url-safety'

export {
    normalizeSearxngSafeSearch,
    parseBraveSearchResults,
    parseBrowserExtractedSearchResults,
    parseSearxngResults,
    type WebSearchResult,
} from './web-search'
export { assertSafeUrl, isBlockedNetworkAddress, sanitizeUrlForAudit } from './web-url-safety'

interface WebToolContext {
    config: PiRuntimeConfig
    audit: (event: string, payload: unknown) => Promise<void>
}

interface WebToolDetails {
    url?: string
    finalUrl?: string
    status?: number
    contentType?: string
    byteLength?: number
    truncated?: boolean
    modelVisibleTruncated?: boolean
    outputArtifact?: ToolOutputArtifact
    resultCount?: number
    backend?: string
    backendLabel?: string
    backendFormat?: SearchBackendFormat
    fallbackChain?: SearchFallbackStep[]
    degraded?: boolean
    degradedReason?: string | null
    fallbackReason?: string | null
    browserMediated?: boolean
}

function createWebSearchTool(ctx: WebToolContext, router: SearchRouter): ToolDefinition {
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
                const search = await router.search({
                    config: ctx.config,
                    query: input.query,
                    count: Math.min(20, count + 20),
                    language: input.language,
                    freshness: input.freshness,
                    safeSearch: input.safeSearch,
                    location: input.location,
                    signal,
                    audit: ctx.audit,
                })
                const results = filterResultsByDomain({
                    results: search.results,
                    allowedDomains: normalizeStringArray(input.allowedDomains),
                    blockedDomains: normalizeStringArray(input.blockedDomains),
                }).slice(0, count)
                await ctx.audit('tool.web_search', {
                    query: input.query,
                    resultCount: results.length,
                    backend: search.backend,
                    backendLabel: search.backendLabel,
                    backendFormat: search.backendFormat,
                    fallbackChain: search.fallbackChain,
                    degraded: search.degraded,
                    degradedReason: search.degradedReason,
                    fallbackReason: search.fallbackReason,
                    browserMediated: search.browserMediated,
                    status: 'complete',
                })
                return textToolResult<WebToolDetails>(formatSearchResults(results), {
                    resultCount: results.length,
                    backend: search.backend,
                    backendLabel: search.backendLabel,
                    backendFormat: search.backendFormat,
                    fallbackChain: search.fallbackChain,
                    degraded: search.degraded,
                    degradedReason: search.degradedReason,
                    fallbackReason: search.fallbackReason,
                    browserMediated: search.browserMediated,
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
                const bounded = await boundToolOutput({
                    config: ctx.config,
                    text: `${header}\n\n${result.text}`,
                    label: `fetch-${loggedFinalUrl}`,
                    extension: 'txt',
                    previewMode: 'head',
                })
                return textToolResult<WebToolDetails>(bounded.text, {
                    url: loggedUrl,
                    finalUrl: loggedFinalUrl,
                    status: result.status,
                    contentType: result.contentType,
                    byteLength: result.byteLength,
                    truncated: result.truncated,
                    modelVisibleTruncated: bounded.modelVisibleTruncated,
                    ...(bounded.outputArtifact
                        ? {
                              outputArtifact: bounded.outputArtifact,
                          }
                        : {}),
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
        tools.push(createWebSearchTool(ctx, new SearchRouter()))
    }
    if (ctx.config.capabilities.urlFetch) {
        tools.push(createFetchUrlTool(ctx))
    }
    return tools
}
