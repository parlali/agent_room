export const internalStoreRootNames = new Set(['blobs', 'manifests', 'previews'])

export function isInternalStoreRelativePath(relativePath: string): boolean {
    const root = relativePath.split('/')[0] ?? relativePath
    return internalStoreRootNames.has(root)
}

export function shouldExposeStoreRelativePath(relativePath: string): boolean {
    return !isInternalStoreRelativePath(relativePath)
}
