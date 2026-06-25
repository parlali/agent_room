export type HostedProviderCandidate = 'codex' | 'user_key' | 'hosted_openrouter'
export const hostedProviderPriorityOrder: HostedProviderCandidate[] = [
    'user_key',
    'codex',
    'hosted_openrouter',
]

export interface HostedProviderPriorityInput {
    workspaceId: string
    codexAvailable: boolean
    userKeyAvailable: boolean
    managedOpenRouterAvailable: boolean
}

export async function selectHostedProviderCandidate(
    input: HostedProviderPriorityInput,
): Promise<HostedProviderCandidate | null> {
    for (const candidate of hostedProviderPriorityOrder) {
        if (candidate === 'user_key' && input.userKeyAvailable) {
            return 'user_key'
        }
        if (candidate === 'codex' && input.codexAvailable) {
            return 'codex'
        }
        if (candidate === 'hosted_openrouter' && input.managedOpenRouterAvailable) {
            return 'hosted_openrouter'
        }
    }
    return null
}
