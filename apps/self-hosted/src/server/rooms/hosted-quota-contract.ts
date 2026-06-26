export const hostedQuotaScopes = [
    'workspace',
    'user',
    'ip',
    'room',
    'session',
    'job',
    'runtime',
    'provider',
] as const

export const hostedQuotaActions = [
    'runtime_start',
    'run_start',
    'provider_openrouter',
    'provider_brave',
    'provider_browserbase',
    'provider_fetch_url',
    'browserbase_session_start',
    'file_upload',
    'runtime_file_sync',
    'runtime_state_sync',
    'scheduled_job_claim',
    'shell_command',
    'document_worker',
    'image_generation',
] as const

export const hostedRuntimeQuotaActions = [
    'run_start',
    'scheduled_job_claim',
    'shell_command',
    'document_worker',
    'image_generation',
] as const satisfies readonly HostedQuotaAction[]

export type HostedQuotaScope = (typeof hostedQuotaScopes)[number]
export type HostedQuotaAction = (typeof hostedQuotaActions)[number]
export type HostedRuntimeQuotaAction = (typeof hostedRuntimeQuotaActions)[number]

export interface HostedQuotaAmount {
    count?: number
    bytes?: number
    storageBytes?: number
    cents?: number
}

export function parseHostedRuntimeQuotaAction(value: unknown): HostedRuntimeQuotaAction | null {
    return typeof value === 'string' &&
        hostedRuntimeQuotaActions.includes(value as HostedRuntimeQuotaAction)
        ? (value as HostedRuntimeQuotaAction)
        : null
}
