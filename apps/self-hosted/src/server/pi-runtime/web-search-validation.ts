import type { SearchProviderId } from '#/domain/domain-types'
import { BraveSearchProvider } from './web-search-brave'
import { BrowserbaseSearchProvider } from './web-search-browserbase'
import {
    SearchProviderError,
    type SearchProvider,
    type SearchRuntimeConfigScope,
} from './web-search'

export type ValidatedWebSearchProviderId = Exclude<SearchProviderId, 'searxng'>

const validationProviders: Record<ValidatedWebSearchProviderId, SearchProvider> = {
    brave: new BraveSearchProvider(),
    browserbase: new BrowserbaseSearchProvider(),
}

let webSearchValidationEnvQueue: Promise<void> = Promise.resolve()

export async function withIsolatedWebSearchProviderEnv<T>(input: {
    isolatedEnvKeys: Iterable<string>
    env: Record<string, string>
    run: () => Promise<T>
}): Promise<T> {
    const previousValidation = webSearchValidationEnvQueue
    let releaseValidation = () => {}
    webSearchValidationEnvQueue = new Promise<void>((resolve) => {
        releaseValidation = resolve
    })
    await previousValidation.catch(() => {})
    const previousEnv = new Map<string, string | undefined>()
    const isolatedEnvKeys = new Set([...input.isolatedEnvKeys, ...Object.keys(input.env)])
    try {
        for (const key of isolatedEnvKeys) {
            previousEnv.set(key, process.env[key])
            delete process.env[key]
        }
        for (const [key, value] of Object.entries(input.env)) {
            process.env[key] = value
        }
        return await input.run()
    } finally {
        for (const [key, value] of previousEnv) {
            if (value === undefined) {
                delete process.env[key]
            } else {
                process.env[key] = value
            }
        }
        releaseValidation()
    }
}

export async function validateWebSearchRuntimeProviders(input: {
    config: SearchRuntimeConfigScope
    providers: ValidatedWebSearchProviderId[]
    query?: string
    count?: number
}): Promise<void> {
    for (const providerId of input.providers) {
        const provider = validationProviders[providerId]
        if (!provider.isConfigured(input.config)) {
            throw new Error(`${provider.label} credential was not materialized`)
        }
        try {
            await provider.search({
                config: input.config,
                query: input.query ?? 'agent room search validation',
                count: input.count ?? 1,
            })
        } catch (error) {
            const message =
                error instanceof SearchProviderError || error instanceof Error
                    ? error.message
                    : `${provider.label} validation failed`
            throw new Error(`${provider.label} validation failed: ${message}`)
        }
    }
}
