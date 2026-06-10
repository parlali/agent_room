const internalStoreRootNames: ReadonlySet<string> = new Set(['blobs', 'manifests', 'previews'])

function normalizedStoreRelativePath(relativePath: string): string | null {
    const slashNormalized = relativePath.replaceAll('\\', '/')
    if (slashNormalized.startsWith('/')) {
        return null
    }
    const parts = slashNormalized.split('/').filter((part) => part && part !== '.')
    if (parts.some((part) => part === '..')) {
        return null
    }
    return parts.join('/')
}

function normalizedStoreRoot(relativePath: string): string | null {
    const normalized = normalizedStoreRelativePath(relativePath)
    if (normalized === null || !normalized) {
        return null
    }
    return normalized.split('/')[0] ?? null
}

export function isInternalStoreRelativePath(relativePath: string): boolean {
    const root = normalizedStoreRoot(relativePath)
    return root !== null && internalStoreRootNames.has(root)
}

export function shouldExposeStoreRelativePath(relativePath: string): boolean {
    const normalized = normalizedStoreRelativePath(relativePath)
    if (normalized === null) {
        return false
    }
    const root = normalized ? (normalized.split('/')[0] ?? null) : null
    return root === null || !internalStoreRootNames.has(root)
}
