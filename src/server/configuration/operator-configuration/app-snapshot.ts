import {
    appMcpConnectionRepository,
    appProviderConnectionRepository,
    appSettingsRepository,
} from '../../db/repositories'
import { getGitHubIntegrationSummary } from '../github-app'
import { providerCatalog, providerRequiresStoredCredential } from '../provider-config'
import type { OperatorConfigSnapshot } from './contracts'
import { summarizeMcp, summarizeProvider, summarizeSettings } from './helpers'

export async function getOperatorConfigSnapshot(): Promise<OperatorConfigSnapshot> {
    const [settings, providers, mcpConnections, github] = await Promise.all([
        appSettingsRepository.getOrCreate(),
        appProviderConnectionRepository.list(),
        appMcpConnectionRepository.list(),
        getGitHubIntegrationSummary(),
    ])

    return {
        settings: summarizeSettings(settings),
        providerCatalog,
        providers: providers.map(summarizeProvider),
        mcpConnections: mcpConnections.map(summarizeMcp),
        github,
        onboarding: {
            completed: settings.onboardingCompletedAt !== null,
            hasProvider: providers.some((provider) => {
                const requiresCredential = providerRequiresStoredCredential({
                    provider: provider.provider,
                    authMode: provider.authMode,
                })
                return !requiresCredential || provider.credentialSecretId !== null
            }),
            hasDefaultProvider: settings.defaultProviderConnectionId !== null,
        },
    }
}
