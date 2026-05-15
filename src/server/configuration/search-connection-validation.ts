import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { JsonValue, SearchProviderId } from '../domain/types'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import { getAppEnv } from '../config/env'
import { SearchProviderError, type SearchProvider } from '../pi-runtime/web-search'
import { BraveSearchProvider } from '../pi-runtime/web-search-brave'
import { BrowserbaseSearchProvider } from '../pi-runtime/web-search-browserbase'
import { boundedMessage, sanitizeOutput } from './connection-validation-model'
import { materializeSearchConfig } from './operator-configuration/materialization'

type ValidatedSearchProviderId = Exclude<SearchProviderId, 'searxng'>

const validationProviders: Record<ValidatedSearchProviderId, SearchProvider> = {
    brave: new BraveSearchProvider(),
    browserbase: new BrowserbaseSearchProvider(),
}

export async function validateMaterializedSearchProviders(input: {
    searchConfig: JsonValue
    providers: ValidatedSearchProviderId[]
}): Promise<void> {
    if (input.providers.length === 0) return

    const tempDir = await mkdtemp(join(tmpdir(), 'agent-room-search-validation-'))
    const runtimeSecretsDir = join(tempDir, 'secrets')
    await mkdir(runtimeSecretsDir, {
        recursive: true,
        mode: 0o700,
    })

    const env = getAppEnv()
    const materialized = await materializeSearchConfig({
        searchConfig: input.searchConfig,
        runtimeSecretsDir,
        encryptionKey: env.encryptionKey,
    })
    const previousEnv = new Map<string, string | undefined>()

    try {
        for (const [key, value] of Object.entries(materialized.entitlements.env)) {
            previousEnv.set(key, process.env[key])
            process.env[key] = value
        }
        const config = {
            runtime: {
                roomId: 'search-validation',
            },
            search: materialized.search,
        } as PiRuntimeConfig
        for (const providerId of input.providers) {
            const provider = validationProviders[providerId]
            if (!provider.isConfigured(config)) {
                throw new Error(`${provider.label} credential was not materialized`)
            }
            try {
                await provider.search({
                    config,
                    query: 'agent room search validation',
                    count: 1,
                })
            } catch (error) {
                const message =
                    error instanceof SearchProviderError || error instanceof Error
                        ? error.message
                        : `${provider.label} validation failed`
                throw new Error(
                    `${provider.label} validation failed: ${boundedMessage(
                        sanitizeOutput(message, Object.values(materialized.entitlements.env)),
                    )}`,
                )
            }
        }
    } finally {
        for (const [key, value] of previousEnv) {
            if (value === undefined) {
                delete process.env[key]
            } else {
                process.env[key] = value
            }
        }
        await rm(tempDir, {
            force: true,
            recursive: true,
        })
    }
}
