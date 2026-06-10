export function selectSnapshotThreadKey(input: {
    requestedThreadKey?: string | null
    orderedThreadKeys: string[]
}): string | null {
    if (!input.requestedThreadKey) {
        return input.orderedThreadKeys[0] ?? null
    }
    return input.orderedThreadKeys.includes(input.requestedThreadKey)
        ? input.requestedThreadKey
        : null
}
