import { resolve } from 'node:path'
import type { RoomDirectoryListing } from '#/domain/room-file-types'
import { assertPathInsideRoot } from '../security/path-boundary'

export function roomFilePathParts(relativePath: string): string[] {
    return relativePath.split(/[\\/]+/).filter(Boolean)
}

export function parentRoomFilePath(relativePath: string): string | null {
    const parts = roomFilePathParts(relativePath)
    if (parts.length === 0) {
        return null
    }
    return parts.slice(0, -1).join('/')
}

export function roomFileBreadcrumbs(relativePath: string): RoomDirectoryListing['breadcrumbs'] {
    const parts = roomFilePathParts(relativePath)
    return parts.map((name, index) => ({
        name,
        relativePath: parts.slice(0, index + 1).join('/'),
    }))
}

export function normalizeRoomFileRelativePath(path: string | null | undefined): string {
    const trimmed = (path ?? '').trim().replace(/\\/g, '/')
    if (trimmed.startsWith('/')) {
        throw new Error('File path escapes the room boundary')
    }
    const parts = trimmed.split('/').filter((part) => part && part !== '.')
    if (parts.some((part) => part === '..')) {
        throw new Error('File path escapes the room boundary')
    }
    return parts.join('/')
}

export function joinRoomFileRelativePath(left: string | null | undefined, right: string): string {
    const joined = [normalizeRoomFileRelativePath(left), normalizeRoomFileRelativePath(right)]
        .filter(Boolean)
        .join('/')
    return normalizeRoomFileRelativePath(joined)
}

export function resolveRoomFilePathInsideRoot(input: {
    root: string
    relativePath: string
    boundaryErrorMessage?: string
}): string {
    const root = resolve(input.root)
    const target = resolve(root, input.relativePath)
    return assertPathInsideRoot(
        target,
        root,
        input.boundaryErrorMessage ?? 'File path escapes the room boundary',
    )
}
