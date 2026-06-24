export const maxHostedRuntimeStateFileBytes = 5 * 1024 * 1024

export const hostedRuntimeStateOperations = ['upsert', 'delete'] as const

export type HostedRuntimeStateOperation = (typeof hostedRuntimeStateOperations)[number]

export function parseHostedRuntimeStateOperation(
    value: unknown,
): HostedRuntimeStateOperation | null {
    return value === 'upsert' || value === 'delete' ? value : null
}

export function normalizeHostedRuntimeStateRelativePath(relativePath: string): string {
    const normalized = relativePath.replaceAll('\\', '/').split('/').filter(Boolean).join('/')
    if (
        !normalized ||
        normalized.startsWith('../') ||
        normalized.includes('/../') ||
        normalized === '..'
    ) {
        throw new Error('Hosted runtime state path is invalid')
    }
    if (
        normalized === 'threads.json' ||
        normalized === 'runtime-events.jsonl' ||
        /^sessions\/[^/]+\.jsonl$/.test(normalized) ||
        normalized === 'internal-state/memory.json' ||
        normalized === 'internal-state/commands.json' ||
        /^internal-state\/run-ledger\/[^/]+\.json$/.test(normalized)
    ) {
        return normalized
    }
    throw new Error(`Hosted runtime state path is not allowed: ${normalized}`)
}
