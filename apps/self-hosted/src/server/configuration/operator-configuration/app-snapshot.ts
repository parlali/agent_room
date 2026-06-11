import {
    appMcpConnectionRepository,
    appProviderConnectionRepository,
    appSettingsRepository,
} from '../../db/repositories'
import { getGitHubIntegrationSummary } from '../github-app'
import { inspectCodexAppAuthStatusSync } from '../codex-auth'
import { providerCatalog } from '../provider-config'
import type { OperatorConfigSnapshot } from './contracts'
import { summarizeMcp, summarizeProvider, summarizeSettings } from './helpers'
import { listReadyProviders } from './provider-resolution'

export async function getOperatorConfigSnapshot(): Promise<OperatorConfigSnapshot> {
    const [settings, providers, mcpConnections, github] = await Promise.all([
        appSettingsRepository.getOrCreate(),
        appProviderConnectionRepository.list(),
        appMcpConnectionRepository.list(),
        getGitHubIntegrationSummary(),
    ])
    const codexAuth = inspectCodexAppAuthStatusSync()
    const readyProviders = listReadyProviders(providers, codexAuth)

    return {
        settings: summarizeSettings(settings),
        codexAuth,
        providerCatalog,
        providers: providers.map(summarizeProvider),
        mcpConnections: mcpConnections.map(summarizeMcp),
        github,
        onboarding: {
            completed: settings.onboardingCompletedAt !== null,
            hasProvider: readyProviders.length > 0,
            hasDefaultProvider:
                readyProviders.length === 1 || settings.defaultProviderConnectionId !== null,
        },
    }
}
