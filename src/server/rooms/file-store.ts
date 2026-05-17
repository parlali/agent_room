import { lstat, mkdir, readdir, realpath, writeFile } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'
import type {
    RoomDirectoryListing,
    RoomFileEntry,
    RoomFileSurface,
    RoomFileTree,
    RoomFileTreeNode,
} from '#/lib/room-file-types'
import { assertPathInsideRoot } from '../security/path-boundary'
import { getRoomPaths } from './room-paths'
import {
    ensureMaterializedRuntimeSandboxDirectory,
    ensureMaterializedRuntimeSandboxFile,
} from './runtime-sandbox-identity'

export type {
    RoomDirectoryListing,
    RoomFileEntry,
    RoomFilePreview,
    RoomFilePreviewAsset,
    RoomFileResolvedAsset,
    RoomFileSurface,
    RoomFileTree,
    RoomFileTreeNode,
} from '#/lib/room-file-types'

const maxDirectoryEntries = 1000
const maxTreeEntries = 500
const maxTreeDepth = 6
const maxUploadBytes = 50 * 1024 * 1024
const internalStoreRoots = new Set(['blobs', 'manifests', 'previews'])

export function rootPath(roomId: string, surface: RoomFileSurface): string {
    const paths = getRoomPaths(roomId)
    return surface === 'workspace' ? paths.workspaceDir : paths.storeDir
}

function toDisplayPath(path: string): string {
    return path.split(sep).join('/')
}

function normalizeInputPath(path: string | null | undefined): string {
    const value = path?.trim() ?? ''
    return value === '.' ? '' : value
}

function pathParts(relativePath: string): string[] {
    return relativePath.split(/[\\/]+/).filter(Boolean)
}

function parentRelativePath(relativePath: string): string | null {
    const parts = pathParts(relativePath)
    if (parts.length === 0) return null
    return parts.slice(0, -1).join('/')
}

function sanitizeUploadName(name: string): string {
    const cleaned = basename(name.replace(/\\/g, '/'))
        .split('')
        .filter((char) => {
            const code = char.charCodeAt(0)
            return code >= 32 && code !== 127
        })
        .join('')
        .trim()
    if (!cleaned || cleaned === '.' || cleaned === '..') {
        throw new Error('Uploaded file name is invalid')
    }
    if (cleaned.includes('/') || cleaned.includes('\\')) {
        throw new Error('Uploaded file name is invalid')
    }
    return cleaned
}

function breadcrumbsFor(relativePath: string): RoomDirectoryListing['breadcrumbs'] {
    const parts = pathParts(relativePath)
    return parts.map((name, index) => ({
        name,
        relativePath: parts.slice(0, index + 1).join('/'),
    }))
}

function shouldExposeRoomFile(input: { surface: RoomFileSurface; relativePath: string }) {
    if (input.surface !== 'store') {
        return true
    }
    const root = input.relativePath.split('/')[0] ?? input.relativePath
    return !internalStoreRoots.has(root)
}

function assertInside(candidate: string, root: string): string {
    return assertPathInsideRoot(candidate, root, 'File path escapes the room boundary')
}

async function resolveRoot(roomId: string, surface: RoomFileSurface): Promise<string> {
    const root = rootPath(roomId, surface)
    await mkdir(root, { recursive: true })
    return realpath(root)
}

export async function resolveExistingPath(input: {
    roomId: string
    surface: RoomFileSurface
    relativePath: string
}): Promise<{
    root: string
    path: string
    relativePath: string
}> {
    const root = await resolveRoot(input.roomId, input.surface)
    const requested = assertInside(join(root, normalizeInputPath(input.relativePath)), root)
    const path = assertInside(await realpath(requested), root)
    const relativePath = toDisplayPath(relative(root, path))
    if (!shouldExposeRoomFile({ surface: input.surface, relativePath })) {
        throw new Error('File path is internal and cannot be read through the file API')
    }
    return {
        root,
        path,
        relativePath,
    }
}

async function resolveWritableDirectory(input: {
    roomId: string
    surface: RoomFileSurface
    relativePath?: string | null
}): Promise<{
    root: string
    path: string
    relativePath: string
    paths: ReturnType<typeof getRoomPaths>
}> {
    const paths = getRoomPaths(input.roomId)
    const surfaceRootPath = input.surface === 'workspace' ? paths.workspaceDir : paths.storeDir
    await ensureMaterializedRuntimeSandboxDirectory(paths, surfaceRootPath)
    const root = await realpath(surfaceRootPath)
    const requested = assertInside(join(root, normalizeInputPath(input.relativePath)), root)
    const relativePath = toDisplayPath(relative(root, requested))
    if (relativePath && input.surface === 'store') {
        if (!shouldExposeRoomFile({ surface: input.surface, relativePath })) {
            throw new Error('Uploads cannot target internal store paths')
        }
    }

    try {
        await ensureMaterializedRuntimeSandboxDirectory(paths, requested)
    } catch (error) {
        if (
            error instanceof Error &&
            /Shell-writable path is not a directory/.test(error.message)
        ) {
            throw new Error('Upload target is not a directory')
        }
        throw error
    }

    return {
        root,
        path: requested,
        relativePath,
        paths,
    }
}

async function entryFor(input: {
    root: string
    surface: RoomFileSurface
    absolutePath: string
    name: string
    kind: RoomFileEntry['kind']
}): Promise<RoomFileEntry | null> {
    const relativePath = toDisplayPath(relative(input.root, input.absolutePath))
    if (!shouldExposeRoomFile({ surface: input.surface, relativePath })) {
        return null
    }
    const childStat = await lstat(input.absolutePath).catch(() => null)
    return {
        name: input.name,
        relativePath,
        surface: input.surface,
        kind: input.kind,
        byteLength: input.kind === 'file' ? (childStat?.size ?? null) : null,
        updatedAt: childStat ? childStat.mtime.toISOString() : null,
    }
}

async function listSurface(input: {
    root: string
    surface: RoomFileSurface
    maxEntries: number
    maxDepth: number
}): Promise<RoomFileEntry[]> {
    const entries: RoomFileEntry[] = []

    async function visit(current: string, depth: number): Promise<void> {
        if (entries.length >= input.maxEntries || depth > input.maxDepth) {
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
            if (child.isSymbolicLink()) {
                continue
            }

            const absolutePath = join(current, child.name)
            const kind = child.isDirectory() ? 'directory' : 'file'
            const entry = await entryFor({
                root: input.root,
                surface: input.surface,
                absolutePath,
                name: child.name,
                kind,
            })
            if (entry) {
                entries.push(entry)
            }

            if (child.isDirectory()) {
                await visit(absolutePath, depth + 1)
            }
        }
    }

    await visit(input.root, 0)
    return entries
}

export async function listRoomFiles(roomId: string): Promise<RoomFileEntry[]> {
    const [workspaceRoot, storeRoot] = await Promise.all([
        resolveRoot(roomId, 'workspace'),
        resolveRoot(roomId, 'store'),
    ])
    const [workspaceFiles, storeFiles] = await Promise.all([
        listSurface({
            root: workspaceRoot,
            surface: 'workspace',
            maxEntries: maxDirectoryEntries,
            maxDepth: maxTreeDepth,
        }),
        listSurface({
            root: storeRoot,
            surface: 'store',
            maxEntries: maxDirectoryEntries,
            maxDepth: maxTreeDepth,
        }),
    ])

    return [...workspaceFiles, ...storeFiles].sort((left, right) => {
        if (left.surface !== right.surface) {
            return left.surface.localeCompare(right.surface)
        }
        return left.relativePath.localeCompare(right.relativePath)
    })
}

export async function listRoomDirectory(input: {
    roomId: string
    surface: RoomFileSurface
    relativePath?: string | null
}): Promise<RoomDirectoryListing> {
    const root = await resolveRoot(input.roomId, input.surface)
    const requested = normalizeInputPath(input.relativePath)
    const path = requested
        ? (await resolveExistingPath({ ...input, relativePath: requested })).path
        : root
    const directoryStat = await lstat(path)
    if (!directoryStat.isDirectory()) {
        throw new Error('Directory listing requires a directory path')
    }

    const rows = await readdir(path, { withFileTypes: true }).catch(() => [])
    const entries = (
        await Promise.all(
            rows
                .filter((child) => !child.isSymbolicLink())
                .map((child) =>
                    entryFor({
                        root,
                        surface: input.surface,
                        absolutePath: join(path, child.name),
                        name: child.name,
                        kind: child.isDirectory() ? 'directory' : 'file',
                    }),
                ),
        )
    )
        .filter((entry): entry is RoomFileEntry => entry !== null)
        .sort((left, right) => {
            if (left.kind !== right.kind) {
                return left.kind === 'directory' ? -1 : 1
            }
            return left.name.localeCompare(right.name)
        })

    const relativePath = toDisplayPath(relative(root, path))
    return {
        surface: input.surface,
        relativePath,
        parentPath: parentRelativePath(relativePath),
        breadcrumbs: breadcrumbsFor(relativePath),
        entries,
    }
}

async function listChildDirectories(input: {
    root: string
    surface: RoomFileSurface
    absolutePath: string
    remainingDepth: number
    counter: { value: number }
}): Promise<RoomFileTreeNode[]> {
    if (input.remainingDepth <= 0 || input.counter.value >= maxTreeEntries) {
        return []
    }
    const rows = await readdir(input.absolutePath, { withFileTypes: true }).catch(() => [])
    const children: RoomFileTreeNode[] = []
    for (const child of rows.sort((left, right) => left.name.localeCompare(right.name))) {
        if (input.counter.value >= maxTreeEntries) {
            break
        }
        if (!child.isDirectory() || child.isSymbolicLink()) {
            continue
        }
        const absolutePath = join(input.absolutePath, child.name)
        const relativePath = toDisplayPath(relative(input.root, absolutePath))
        if (!shouldExposeRoomFile({ surface: input.surface, relativePath })) {
            continue
        }
        input.counter.value += 1
        children.push({
            name: child.name,
            relativePath,
            surface: input.surface,
            children: await listChildDirectories({
                ...input,
                absolutePath,
                remainingDepth: input.remainingDepth - 1,
            }),
            truncated: input.counter.value >= maxTreeEntries,
        })
    }
    return children
}

export async function listRoomFileTree(roomId: string): Promise<RoomFileTree> {
    const [workspaceRoot, storeRoot] = await Promise.all([
        resolveRoot(roomId, 'workspace'),
        resolveRoot(roomId, 'store'),
    ])
    const workspaceCounter = { value: 0 }
    const storeCounter = { value: 0 }
    const roots = await Promise.all([
        listChildDirectories({
            root: workspaceRoot,
            surface: 'workspace',
            absolutePath: workspaceRoot,
            remainingDepth: maxTreeDepth,
            counter: workspaceCounter,
        }),
        listChildDirectories({
            root: storeRoot,
            surface: 'store',
            absolutePath: storeRoot,
            remainingDepth: maxTreeDepth,
            counter: storeCounter,
        }),
    ])
    return {
        roots: [
            {
                name: 'Workspace',
                relativePath: '',
                surface: 'workspace',
                children: roots[0],
                truncated: workspaceCounter.value >= maxTreeEntries,
            },
            {
                name: 'Uploads',
                relativePath: '',
                surface: 'store',
                children: roots[1],
                truncated: storeCounter.value >= maxTreeEntries,
            },
        ],
    }
}

export async function writeRoomUploadedFile(input: {
    roomId: string
    surface: RoomFileSurface
    relativeDirectory?: string | null
    fileName: string
    content: Buffer
}): Promise<RoomFileEntry> {
    if (input.content.byteLength > maxUploadBytes) {
        throw new Error(`Uploads are limited to ${maxUploadBytes} bytes per file`)
    }

    const directory = await resolveWritableDirectory({
        roomId: input.roomId,
        surface: input.surface,
        relativePath: input.relativeDirectory,
    })
    const name = sanitizeUploadName(input.fileName)
    const path = assertInside(join(directory.path, name), directory.root)
    try {
        await lstat(path)
        throw new Error(`File already exists: ${toDisplayPath(relative(directory.root, path))}`)
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            await writeFile(path, input.content, {
                flag: 'wx',
                mode: 0o600,
            })
            await ensureMaterializedRuntimeSandboxFile(directory.paths, path)
        } else {
            throw error
        }
    }

    const entry = await entryFor({
        root: directory.root,
        surface: input.surface,
        absolutePath: path,
        name,
        kind: 'file',
    })
    if (!entry) {
        throw new Error('Uploaded file is not visible in the room file store')
    }
    return entry
}
