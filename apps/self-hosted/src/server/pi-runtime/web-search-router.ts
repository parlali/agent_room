import type { SearchErrorCode, SearchProviderId } from '#/domain/domain-types'
import { currentToolRunContext } from './tool-run-context'
import { BraveSearchProvider } from './web-search-brave'
import { BrowserbaseSearchProvider } from './web-search-browserbase'
import { SearxngSearchProvider } from './web-search-searxng'
import {
    delay,
    SearchProviderError,
    type RoutedWebSearchResponse,
    type SearchAudit,
    type SearchEngineFailure,
    type SearchFallbackStep,
    type SearchProvider,
    type SearchProviderSearchInput,
    type SearchRuntimeConfigScope,
} from './web-search'

const healthBackoffMs = 60_000
const maxInflightEntries = 200

interface SearchHealthEntry {
    backoffUntil: number
    code: SearchErrorCode
    reason: string
}

export class SearchRouter {
    private providers: SearchProvider[]
    private health = new Map<string, SearchHealthEntry>()
    private inFlight = new Map<string, Promise<RoutedWebSearchResponse>>()
    private runBudgets = new Map<string, { count: number; updatedAt: number }>()

    constructor(providers: SearchProvider[] = defaultSearchProviders()) {
        this.providers = [...providers].sort((left, right) => left.priority - right.priority)
    }

    async search(
        input: SearchProviderSearchInput & {
            audit?: SearchAudit
        },
    ): Promise<RoutedWebSearchResponse> {
        const runKey = searchRunKey(input.config)
        this.pruneState()
        const dedupeKey = searchDedupeKey(runKey, input)
        const existing = this.inFlight.get(dedupeKey)
        if (existing) {
            return existing
        }
        this.consumeBudget(input.config, runKey)
        const promise = this.routeSearch(input)
        this.inFlight.set(dedupeKey, promise)
        try {
            return await promise
        } finally {
            this.inFlight.delete(dedupeKey)
        }
    }

    private consumeBudget(config: SearchRuntimeConfigScope, runKey: string): void {
        const current = this.runBudgets.get(runKey) ?? { count: 0, updatedAt: Date.now() }
        if (current.count >= config.search.maxSearchesPerRun) {
            throw new SearchProviderError({
                code: 'budget_exceeded',
                providerId: null,
                message:
                    'Web search budget exhausted for this run. The agent should synthesize from gathered evidence or ask for a narrower scope before searching again.',
            })
        }
        this.runBudgets.set(runKey, {
            count: current.count + 1,
            updatedAt: Date.now(),
        })
    }

    private async routeSearch(
        input: SearchProviderSearchInput & {
            audit?: SearchAudit
        },
    ): Promise<RoutedWebSearchResponse> {
        const chain: SearchFallbackStep[] = []
        const providers = this.providers.filter((provider) => provider.isConfigured(input.config))
        let lastError: SearchProviderError | null = null
        if (providers.length === 0) {
            throw new SearchProviderError({
                code: 'misconfigured',
                providerId: null,
                message: 'No configured search provider is available',
            })
        }

        for (const provider of providers) {
            const health = this.providerHealth(provider.id)
            if (health) {
                chain.push({
                    backend: provider.id,
                    backendLabel: provider.label,
                    status: 'skipped',
                    attempts: 0,
                    errorCode: health.code,
                    reason: health.reason,
                })
                continue
            }
            const selectedStep: SearchFallbackStep = {
                backend: provider.id,
                backendLabel: provider.label,
                status: 'selected',
                attempts: 0,
                errorCode: null,
                reason: null,
            }
            chain.push(selectedStep)
            await input.audit?.('search.provider_selected', {
                backend: provider.id,
                backendLabel: provider.label,
                query: input.query,
            })
            const maxAttempts = 2
            for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
                selectedStep.attempts = attempt
                try {
                    const response = await provider.search({
                        ...input,
                        disabledEngines: this.engineBackoffEngines(provider.id),
                    })
                    this.recordEngineHealth(provider.id, response.engineFailures ?? [])
                    selectedStep.status = 'complete'
                    const priorFailures = chain.filter(
                        (step) => step.status === 'failed' || step.status === 'skipped',
                    )
                    const degradedReason =
                        response.degradedReason ??
                        (priorFailures.length > 0
                            ? `Fallback after ${priorFailures
                                  .map((step) => `${step.backend}: ${step.reason ?? step.status}`)
                                  .join('; ')}`
                            : null)
                    await input.audit?.('search.provider_completed', {
                        backend: provider.id,
                        backendLabel: provider.label,
                        resultCount: response.results.length,
                        degraded: degradedReason !== null,
                        degradedReason,
                    })
                    return {
                        ...response,
                        backend: provider.id,
                        backendLabel: provider.label,
                        fallbackChain: chain,
                        degraded: degradedReason !== null,
                        degradedReason,
                        resultCount: response.results.length,
                    }
                } catch (error) {
                    const searchError = asSearchProviderError(error, provider.id)
                    lastError = searchError
                    selectedStep.status = 'failed'
                    selectedStep.errorCode = searchError.code
                    selectedStep.reason = searchError.message
                    if (searchError.code === 'aborted') {
                        await input.audit?.('search.provider_failed', {
                            backend: provider.id,
                            backendLabel: provider.label,
                            attempts: attempt,
                            errorCode: searchError.code,
                            error: searchError.message,
                        })
                        throw searchError
                    }
                    this.recordHealth(provider.id, searchError)
                    if (attempt < maxAttempts && shouldRetry(searchError)) {
                        selectedStep.status = 'retrying'
                        await input.audit?.('search.provider_retrying', {
                            backend: provider.id,
                            backendLabel: provider.label,
                            attempt,
                            errorCode: searchError.code,
                            error: searchError.message,
                        })
                        await delay(200)
                        continue
                    }
                    await input.audit?.('search.provider_failed', {
                        backend: provider.id,
                        backendLabel: provider.label,
                        attempts: attempt,
                        errorCode: searchError.code,
                        error: searchError.message,
                    })
                    break
                }
            }
        }

        const error = new SearchProviderError({
            code: lastError?.code ?? 'bad_response',
            providerId: lastError?.providerId ?? null,
            retryable: lastError?.retryable ?? false,
            status: lastError?.status ?? null,
            message: `All configured search providers failed: ${chain
                .map((step) => `${step.backend}: ${step.reason ?? step.status}`)
                .join('; ')}`,
        })
        await input.audit?.('search.final_failure', {
            error: error.message,
            fallbackChain: chain,
        })
        throw error
    }

    private providerHealth(providerId: SearchProviderId): SearchHealthEntry | null {
        const entry = this.health.get(backendHealthKey(providerId))
        if (!entry) return null
        if (entry.backoffUntil <= Date.now()) {
            this.health.delete(backendHealthKey(providerId))
            return null
        }
        return entry
    }

    private recordHealth(providerId: SearchProviderId, error: SearchProviderError): void {
        if (error.code !== 'rate_limited' && error.code !== 'captcha') return
        this.health.set(backendHealthKey(providerId), {
            backoffUntil: Date.now() + healthBackoffMs,
            code: error.code,
            reason: error.message,
        })
    }

    private recordEngineHealth(
        providerId: SearchProviderId,
        failures: SearchEngineFailure[],
    ): void {
        for (const failure of failures) {
            if (failure.code !== 'rate_limited' && failure.code !== 'captcha') continue
            this.health.set(engineHealthKey(providerId, failure.engine), {
                backoffUntil: Date.now() + healthBackoffMs,
                code: failure.code,
                reason: `${failure.engine}: ${failure.code.replaceAll('_', ' ')}`,
            })
        }
    }

    private engineBackoffEngines(providerId: SearchProviderId): string[] {
        const prefix = `${backendHealthKey(providerId)}:engine:`
        const engines: string[] = []
        for (const [key, value] of this.health) {
            if (value.backoffUntil <= Date.now()) continue
            if (key.startsWith(prefix)) {
                engines.push(key.slice(prefix.length))
            }
        }
        return engines
    }

    private pruneState(): void {
        const now = Date.now()
        for (const [key, entry] of this.health) {
            if (entry.backoffUntil <= now) {
                this.health.delete(key)
            }
        }
        for (const [key, entry] of this.runBudgets) {
            if (now - entry.updatedAt > 2 * 60 * 60 * 1000) {
                this.runBudgets.delete(key)
            }
        }
        if (this.inFlight.size <= maxInflightEntries) return
        for (const key of this.inFlight.keys()) {
            this.inFlight.delete(key)
            if (this.inFlight.size <= maxInflightEntries) break
        }
    }
}

function defaultSearchProviders(): SearchProvider[] {
    return [new BraveSearchProvider(), new BrowserbaseSearchProvider(), new SearxngSearchProvider()]
}

function backendHealthKey(providerId: SearchProviderId): string {
    return `backend:${providerId}`
}

function engineHealthKey(providerId: SearchProviderId, engine: string): string {
    return `${backendHealthKey(providerId)}:engine:${engine}`
}

function asSearchProviderError(error: unknown, providerId: SearchProviderId): SearchProviderError {
    if (error instanceof SearchProviderError) return error
    return new SearchProviderError({
        code: 'bad_response',
        providerId,
        retryable: true,
        message: `${providerId} search failed`,
    })
}

function shouldRetry(error: SearchProviderError): boolean {
    return error.retryable && (error.code === 'timeout' || error.code === 'bad_response')
}

function searchRunKey(config: SearchRuntimeConfigScope): string {
    const context = currentToolRunContext()
    if (!context) return `${config.runtime.roomId}:adhoc`
    return `${config.runtime.roomId}:${context.sessionKey}:${context.runId}`
}

function searchDedupeKey(runKey: string, input: SearchProviderSearchInput): string {
    return JSON.stringify({
        runKey,
        query: input.query.trim().toLowerCase(),
        count: input.count,
        language: input.language?.trim() ?? null,
        freshness: input.freshness?.trim() ?? null,
        safeSearch: input.safeSearch?.trim() ?? null,
        location: input.location?.trim() ?? null,
    })
}
