import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import { assertSafeRoomPathId } from '../rooms/room-filesystem-id'
import { shouldExposeStoreRelativePath } from '../rooms/room-store-visibility'

export type RoomVisibleSurface = 'workspace' | 'store'

function rootPath(config: PiRuntimeConfig, surface: RoomVisibleSurface): string {
    return surface === 'store' ? config.paths.storeDir : config.paths.workspaceDir
}

function legacyRootPath(config: PiRuntimeConfig, surface: RoomVisibleSurface): string | null {
    try {
        assertSafeRoomPathId(config.runtime.roomId)
    } catch {
        return null
    }
    return join(
        dirname(config.paths.roomRootDir),
        config.runtime.roomId,
        basename(rootPath(config, surface)),
    )
}

function pathAliases(path: string): string[] {
    const resolved = resolve(path)
    if (resolved.startsWith('/var/')) {
        return [resolved, `/private${resolved}`]
    }
    if (resolved.startsWith('/private/var/')) {
        return [resolved, resolved.replace(/^\/private/, '')]
    }
    return [resolved]
}

function rootCandidates(config: PiRuntimeConfig, surface: RoomVisibleSurface): string[] {
    return [rootPath(config, surface), legacyRootPath(config, surface)].flatMap((path) =>
        path ? pathAliases(path) : [],
    )
}

function normalizePath(path: string): string {
    return path
        .split(/[\\/]+/)
        .join('/')
        .replace(/^\.\/+/, '')
}

function hasParentTraversal(path: string): boolean {
    return path.split('/').includes('..')
}

function relativePathInsideRoot(path: string, root: string): string | null {
    const display = relative(root, path)
    if (display === '..' || display.startsWith(`..${sep}`) || isAbsolute(display)) {
        return null
    }
    return display
}

export function visibleRoomRelativePath(input: {
    config: PiRuntimeConfig
    surface: RoomVisibleSurface
    path: unknown
}): string | null {
    if (typeof input.path !== 'string' || !input.path.trim()) {
        return null
    }

    const trimmed = input.path.trim()
    let relativePath = trimmed
    if (isAbsolute(trimmed)) {
        const absolutePath = resolve(trimmed)
        const match = rootCandidates(input.config, input.surface)
            .map((root) => relativePathInsideRoot(absolutePath, root))
            .find((path) => path !== null)
        if (match === undefined || match === null) {
            return null
        }
        relativePath = match
    }

    relativePath = normalizePath(relativePath)
    if (!relativePath || relativePath === '.' || hasParentTraversal(relativePath)) {
        return null
    }
    if (input.surface === 'store' && !shouldExposeStoreRelativePath(relativePath)) {
        return null
    }
    return relativePath
}
