import { lstat, open, readdir, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { getRoomPaths } from './room-paths'

export interface RoomFileEntry {
    name: string
    relativePath: string
    surface: 'workspace' | 'store'
    kind: 'file' | 'directory'
    byteLength: number | null
    updatedAt: string | null
}

export interface RoomFileContent {
    name: string
    relativePath: string
    surface: 'workspace' | 'store'
    mediaType: string
    encoding: 'utf8' | 'base64'
    content: string
    byteLength: number
    truncated: boolean
}

const maxPreviewBytes = 512000
const internalStoreRoots = new Set(['blobs', 'manifests'])

function shouldExposeRoomFile(input: { surface: 'workspace' | 'store'; relativePath: string }) {
    if (input.surface !== 'store') {
        return true
    }
    const root = input.relativePath.split('/')[0] ?? input.relativePath
    return !internalStoreRoots.has(root)
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
            if (child.isSymbolicLink()) {
                continue
            }

            const absolutePath = join(current, child.name)
            const relativePath = relative(input.root, absolutePath)
            if (!shouldExposeRoomFile({ surface: input.surface, relativePath })) {
                continue
            }
            const childStat = await lstat(absolutePath).catch(() => null)
            const kind = child.isDirectory() ? 'directory' : 'file'
            entries.push({
                name: child.name,
                relativePath,
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

function assertInside(candidate: string, root: string): string {
    const normalizedRoot = resolve(root)
    const normalizedCandidate = resolve(candidate)
    const diff = relative(normalizedRoot, normalizedCandidate)
    if (diff === '' || (!diff.startsWith('..') && !isAbsolute(diff))) {
        return normalizedCandidate
    }
    throw new Error('File path escapes the room boundary')
}

function mediaTypeFor(path: string): string {
    const lower = path.toLowerCase()
    if (lower.endsWith('.png')) return 'image/png'
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
    if (lower.endsWith('.webp')) return 'image/webp'
    if (lower.endsWith('.gif')) return 'image/gif'
    if (lower.endsWith('.svg')) return 'image/svg+xml'
    if (lower.endsWith('.pdf')) return 'application/pdf'
    if (lower.endsWith('.json')) return 'application/json'
    if (lower.endsWith('.html')) return 'text/html'
    if (lower.endsWith('.csv')) return 'text/csv'
    if (lower.endsWith('.md')) return 'text/markdown'
    if (lower.endsWith('.txt') || lower.endsWith('.log')) return 'text/plain'
    return 'application/octet-stream'
}

function isTextMediaType(mediaType: string): boolean {
    return mediaType.startsWith('text/') || mediaType.includes('json') || mediaType.includes('xml')
}

export async function readRoomFileContent(input: {
    roomId: string
    surface: 'workspace' | 'store'
    relativePath: string
}): Promise<RoomFileContent> {
    if (!shouldExposeRoomFile({ surface: input.surface, relativePath: input.relativePath })) {
        throw new Error('File path is internal and cannot be read through the file preview API')
    }
    const paths = getRoomPaths(input.roomId)
    const root = await realpath(input.surface === 'workspace' ? paths.workspaceDir : paths.storeDir)
    const requested = assertInside(join(root, input.relativePath), root)
    const path = assertInside(await realpath(requested), root)
    const fileStat = await lstat(path)
    if (!fileStat.isFile()) {
        throw new Error('File preview only supports regular files')
    }
    const readLength = Math.min(fileStat.size, maxPreviewBytes)
    const handle = await open(path, 'r')
    let buffer: Buffer
    try {
        const target = Buffer.alloc(readLength)
        const result = await handle.read(target, 0, readLength, 0)
        buffer = target.subarray(0, result.bytesRead)
    } finally {
        await handle.close()
    }
    const mediaType = mediaTypeFor(path)
    const truncated = fileStat.size > maxPreviewBytes
    const encoding = isTextMediaType(mediaType) ? 'utf8' : 'base64'
    return {
        name: input.relativePath.split('/').at(-1) ?? input.relativePath,
        relativePath: input.relativePath,
        surface: input.surface,
        mediaType,
        encoding,
        content: encoding === 'utf8' ? buffer.toString('utf8') : buffer.toString('base64'),
        byteLength: fileStat.size,
        truncated,
    }
}
