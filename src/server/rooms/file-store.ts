import { readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { getRoomPaths } from './room-paths'

export interface RoomFileEntry {
    name: string
    relativePath: string
    surface: 'workspace' | 'store'
    kind: 'file' | 'directory'
    byteLength: number | null
    updatedAt: string | null
}

async function listSurface(input: {
    root: string
    surface: 'workspace' | 'store'
    maxEntries: number
}): Promise<RoomFileEntry[]> {
    const entries: RoomFileEntry[] = []

    async function visit(current: string, depth: number): Promise<void> {
        if (entries.length >= input.maxEntries || depth > 2) {
            return
        }

        let children
        try {
            children = await readdir(current, { withFileTypes: true })
        } catch {
            return
        }

        for (const child of children.sort((left, right) => left.name.localeCompare(right.name))) {
            if (entries.length >= input.maxEntries) {
                return
            }

            const absolutePath = join(current, child.name)
            const childStat = await stat(absolutePath).catch(() => null)
            const kind = child.isDirectory() ? 'directory' : 'file'
            entries.push({
                name: child.name,
                relativePath: relative(input.root, absolutePath),
                surface: input.surface,
                kind,
                byteLength: kind === 'file' ? (childStat?.size ?? null) : null,
                updatedAt: childStat ? childStat.mtime.toISOString() : null,
            })

            if (child.isDirectory()) {
                await visit(absolutePath, depth + 1)
            }
        }
    }

    await visit(input.root, 0)
    return entries
}

export async function listRoomFiles(roomId: string): Promise<RoomFileEntry[]> {
    const paths = getRoomPaths(roomId)
    const [workspaceFiles, storeFiles] = await Promise.all([
        listSurface({
            root: paths.workspaceDir,
            surface: 'workspace',
            maxEntries: 80,
        }),
        listSurface({
            root: paths.storeDir,
            surface: 'store',
            maxEntries: 80,
        }),
    ])

    return [...workspaceFiles, ...storeFiles].sort((left, right) => {
        if (left.surface !== right.surface) {
            return left.surface.localeCompare(right.surface)
        }
        return left.relativePath.localeCompare(right.relativePath)
    })
}
