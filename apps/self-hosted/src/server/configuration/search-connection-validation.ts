import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { JsonValue } from '#/domain/domain-types'
import { getAppEnv } from '../config/env'
import {
    type ValidatedWebSearchProviderId,
    withIsolatedWebSearchProviderEnv,
    validateWebSearchRuntimeProviders,
} from '../pi-runtime/web-search-validation'
import { searchProviderEnvKey } from './capabilities'
import { boundedMessage, sanitizeOutput } from './connection-validation-model'
import { materializeSearchConfig } from './operator-configuration/materialization'

export async function validateMaterializedSearchProviders(input: {
    searchConfig: JsonValue
    providers: ValidatedWebSearchProviderId[]
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
    const isolatedEnvKeys = new Set([
        ...input.providers.map((providerId) => searchProviderEnvKey(providerId)),
        ...Object.keys(materialized.entitlements.env),
    ])

    try {
        const selectedProviders = new Set(input.providers)
        const config = {
            runtime: {
                roomId: 'search-validation',
            },
            search: {
                ...materialized.search,
                enabled: true,
                brave: {
                    ...materialized.search.brave,
                    enabled: selectedProviders.has('brave') || materialized.search.brave.enabled,
                },
                browserbase: {
                    ...materialized.search.browserbase,
                    enabled:
                        selectedProviders.has('browserbase') ||
                        materialized.search.browserbase.enabled,
                },
            },
        }
        await withIsolatedWebSearchProviderEnv({
            isolatedEnvKeys,
            env: materialized.entitlements.env,
            run: async () => {
                for (const providerId of input.providers) {
                    try {
                        await validateWebSearchRuntimeProviders({
                            config,
                            providers: [providerId],
                        })
                    } catch (error) {
                        const message =
                            error instanceof Error
                                ? error.message
                                : 'Search provider validation failed'
                        throw new Error(
                            boundedMessage(
                                sanitizeOutput(
                                    message,
                                    Object.values(materialized.entitlements.env),
                                ),
                            ),
                        )
                    }
                }
            },
        })
    } finally {
        await rm(tempDir, {
            force: true,
            recursive: true,
        })
    }
}
