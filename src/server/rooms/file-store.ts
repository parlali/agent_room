import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
    access,
    lstat,
    mkdir,
    mkdtemp,
    open,
    readdir,
    readFile,
    realpath,
    rename,
    rm,
    stat,
    writeFile,
} from 'node:fs/promises'
import { basename, extname, join, relative, sep } from 'node:path'
import { assertPathInsideRoot } from '../security/path-boundary'
import { getRoomPaths } from './room-paths'

export type RoomFileSurface = 'workspace' | 'store'

export interface RoomFileEntry {
    name: string
    relativePath: string
    surface: RoomFileSurface
    kind: 'file' | 'directory'
    byteLength: number | null
    updatedAt: string | null
}

export interface RoomDirectoryListing {
    surface: RoomFileSurface
    relativePath: string
    parentPath: string | null
    breadcrumbs: Array<{
        name: string
        relativePath: string
    }>
    entries: RoomFileEntry[]
}

export interface RoomFileTreeNode {
    name: string
    relativePath: string
    surface: RoomFileSurface
    children: RoomFileTreeNode[]
    truncated: boolean
}

export interface RoomFileTree {
    roots: RoomFileTreeNode[]
}

export type RoomFilePreview =
    | {
          kind: 'text'
          name: string
          relativePath: string
          surface: RoomFileSurface
          mediaType: string
          encoding: 'utf8'
          content: string
          byteLength: number
          truncated: boolean
          generated: false
      }
    | {
          kind: 'image' | 'pdf'
          name: string
          relativePath: string
          surface: RoomFileSurface
          mediaType: string
          byteLength: number
          truncated: false
          generated: boolean
      }
    | {
          kind: 'unsupported'
          name: string
          relativePath: string
          surface: RoomFileSurface
          mediaType: string
          byteLength: number
          reason: string
      }

export interface RoomFilePreviewAsset {
    name: string
    relativePath: string
    surface: RoomFileSurface
    mediaType: string
    byteLength: number
    content: Buffer
    generated: boolean
}

const maxPreviewBytes = 512000
const maxBinaryPreviewBytes = 8 * 1024 * 1024
const maxDirectoryEntries = 1000
const maxTreeEntries = 500
const maxTreeDepth = 6
const previewTimeoutMs = 60000
const maxUploadBytes = 50 * 1024 * 1024
const internalStoreRoots = new Set(['blobs', 'manifests', 'previews'])
const officeExtensions = new Set([
    '.doc',
    '.docx',
    '.xls',
    '.xlsx',
    '.ppt',
    '.pptx',
    '.odt',
    '.ods',
    '.odp',
])

function rootPath(roomId: string, surface: RoomFileSurface): string {
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

async function resolveExistingPath(input: {
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
}> {
    const root = await resolveRoot(input.roomId, input.surface)
    const requested = assertInside(join(root, normalizeInputPath(input.relativePath)), root)
    const relativePath = toDisplayPath(relative(root, requested))
    if (relativePath && input.surface === 'store') {
        if (!shouldExposeRoomFile({ surface: input.surface, relativePath })) {
            throw new Error('Uploads cannot target internal store paths')
        }
    }

    let currentPath = root
    for (const part of pathParts(relativePath)) {
        currentPath = assertInside(join(currentPath, part), root)
        const directoryStat = await lstat(currentPath).catch((error: unknown) => {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
                return null
            }
            throw error
        })
        if (!directoryStat) {
            await mkdir(currentPath, { mode: 0o700 })
            continue
        }
        if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
            throw new Error('Upload target is not a directory')
        }
    }

    return {
        root,
        path: currentPath,
        relativePath,
    }
}

function mediaTypeFor(path: string): string {
    const lower = path.toLowerCase()
    if (lower.endsWith('.png')) return 'image/png'
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
    if (lower.endsWith('.webp')) return 'image/webp'
    if (lower.endsWith('.gif')) return 'image/gif'
    if (lower.endsWith('.svg')) return 'image/svg+xml'
    if (lower.endsWith('.pdf')) return 'application/pdf'
    if (lower.endsWith('.docx')) {
        return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    }
    if (lower.endsWith('.xlsx')) {
        return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }
    if (lower.endsWith('.pptx')) {
        return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    }
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

function isImageMediaType(mediaType: string): boolean {
    return mediaType.startsWith('image/')
}

function isOfficePath(path: string): boolean {
    return officeExtensions.has(extname(path).toLowerCase())
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

async function readBoundedPreviewFile(
    path: string,
    maxBytes: number,
): Promise<{
    buffer: Buffer
    byteLength: number
    truncated: boolean
}> {
    const fileStat = await stat(path)
    const readLength = Math.min(fileStat.size, maxBytes)
    const handle = await open(path, 'r')
    let buffer: Buffer
    try {
        const target = Buffer.alloc(readLength)
        const result = await handle.read(target, 0, readLength, 0)
        buffer = target.subarray(0, result.bytesRead)
    } finally {
        await handle.close()
    }
    return {
        buffer,
        byteLength: fileStat.size,
        truncated: fileStat.size > maxBytes,
    }
}

async function readWholePreviewFile(path: string): Promise<{
    buffer: Buffer
    byteLength: number
}> {
    const fileStat = await stat(path)
    if (fileStat.size > maxBinaryPreviewBytes) {
        throw new Error(`Preview is limited to ${maxBinaryPreviewBytes} bytes`)
    }
    return {
        buffer: await readFile(path),
        byteLength: fileStat.size,
    }
}

async function hashFile(path: string): Promise<string> {
    const hash = createHash('sha256')
    await new Promise<void>((resolvePromise, reject) => {
        const stream = createReadStream(path)
        stream.on('data', (chunk) => hash.update(chunk))
        stream.on('error', reject)
        stream.on('end', () => resolvePromise())
    })
    return hash.digest('hex')
}

async function runPreviewProcess(input: {
    command: string
    args: string[]
    cwd: string
}): Promise<void> {
    await new Promise<void>((resolvePromise, reject) => {
        let settled = false
        let output = ''
        const child = spawn(input.command, input.args, {
            cwd: input.cwd,
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        })
        const finish = (error: Error | null) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            if (error) reject(error)
            else resolvePromise()
        }
        const terminate = () => {
            if (child.pid) {
                try {
                    process.kill(-child.pid, 'SIGTERM')
                } catch {
                    child.kill('SIGTERM')
                }
            }
        }
        const timer = setTimeout(() => {
            terminate()
            finish(new Error(`${input.command} timed out`))
        }, previewTimeoutMs)
        timer.unref()
        const append = (chunk: Buffer) => {
            output = `${output}${chunk.toString('utf8')}`.slice(-8000)
        }
        child.stdout.on('data', append)
        child.stderr.on('data', append)
        child.on('error', finish)
        child.on('close', (exitCode) => {
            if (exitCode === 0) finish(null)
            else finish(new Error(`${input.command} failed with exit code ${exitCode}: ${output}`))
        })
    })
}

async function previewCachePath(input: {
    roomId: string
    surface: RoomFileSurface
    relativePath: string
    path: string
    extension: string
    version: string
}): Promise<string> {
    const paths = getRoomPaths(input.roomId)
    const fileHash = await hashFile(input.path)
    const cacheHash = createHash('sha256')
        .update(`${input.surface}:${input.relativePath}:${fileHash}:${input.version}`)
        .digest('hex')
    const previewDir = join(paths.storeDir, 'previews')
    await mkdir(previewDir, { recursive: true })
    return join(previewDir, `${cacheHash}.${input.extension}`)
}

async function ensureOfficePdfPreview(input: {
    roomId: string
    surface: RoomFileSurface
    relativePath: string
    path: string
}): Promise<string> {
    const cachedPath = await previewCachePath({
        ...input,
        extension: 'pdf',
        version: 'office-pdf-preview-v1',
    })
    try {
        await access(cachedPath)
        return cachedPath
    } catch {}

    const paths = getRoomPaths(input.roomId)
    const tempDir = await mkdtemp(join(paths.storeDir, 'previews', `${randomUUID()}-`))
    try {
        await runPreviewProcess({
            command: 'soffice',
            args: [
                '--headless',
                '--nologo',
                '--nofirststartwizard',
                '--convert-to',
                'pdf',
                '--outdir',
                tempDir,
                input.path,
            ],
            cwd: rootPath(input.roomId, input.surface),
        })
        const generatedPath = join(tempDir, `${basename(input.path, extname(input.path))}.pdf`)
        await rename(generatedPath, cachedPath)
        return cachedPath
    } finally {
        await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
}

async function ensurePdfImagePreview(input: {
    roomId: string
    surface: RoomFileSurface
    relativePath: string
    path: string
}): Promise<string> {
    const cachedPath = await previewCachePath({
        ...input,
        extension: 'png',
        version: 'pdf-page-image-preview-v1',
    })
    try {
        await access(cachedPath)
        return cachedPath
    } catch {}

    const paths = getRoomPaths(input.roomId)
    const tempDir = await mkdtemp(join(paths.storeDir, 'previews', `${randomUUID()}-`))
    try {
        const outputBase = join(tempDir, 'preview')
        await runPreviewProcess({
            command: 'pdftoppm',
            args: ['-png', '-f', '1', '-singlefile', input.path, outputBase],
            cwd: rootPath(input.roomId, input.surface),
        })
        await rename(`${outputBase}.png`, cachedPath)
        return cachedPath
    } finally {
        await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
}

export async function readRoomFileContent(input: {
    roomId: string
    surface: RoomFileSurface
    relativePath: string
}): Promise<RoomFilePreview> {
    const resolved = await resolveExistingPath(input)
    const fileStat = await lstat(resolved.path)
    if (!fileStat.isFile()) {
        throw new Error('File preview only supports regular files')
    }
    const name = resolved.relativePath.split('/').at(-1) ?? resolved.relativePath
    const mediaType = mediaTypeFor(resolved.path)

    if (isOfficePath(resolved.path)) {
        try {
            const pdfPath = await ensureOfficePdfPreview({
                roomId: input.roomId,
                surface: input.surface,
                relativePath: resolved.relativePath,
                path: resolved.path,
            })
            const pdfStat = await stat(pdfPath)
            return {
                kind: 'pdf',
                name,
                relativePath: resolved.relativePath,
                surface: input.surface,
                mediaType: 'application/pdf',
                byteLength: pdfStat.size,
                truncated: false,
                generated: true,
            }
        } catch (error) {
            return {
                kind: 'unsupported',
                name,
                relativePath: resolved.relativePath,
                surface: input.surface,
                mediaType,
                byteLength: fileStat.size,
                reason:
                    error instanceof Error
                        ? `Office preview failed: ${error.message}`
                        : 'Office preview failed',
            }
        }
    }

    if (isTextMediaType(mediaType)) {
        const read = await readBoundedPreviewFile(resolved.path, maxPreviewBytes)
        return {
            kind: 'text',
            name,
            relativePath: resolved.relativePath,
            surface: input.surface,
            mediaType,
            encoding: 'utf8',
            content: read.buffer.toString('utf8'),
            byteLength: read.byteLength,
            truncated: read.truncated,
            generated: false,
        }
    }

    if (isImageMediaType(mediaType) || mediaType === 'application/pdf') {
        return {
            kind: mediaType === 'application/pdf' ? 'pdf' : 'image',
            name,
            relativePath: resolved.relativePath,
            surface: input.surface,
            mediaType,
            byteLength: fileStat.size,
            truncated: false,
            generated: false,
        }
    }

    return {
        kind: 'unsupported',
        name,
        relativePath: resolved.relativePath,
        surface: input.surface,
        mediaType,
        byteLength: fileStat.size,
        reason: 'Preview is not available for this file type',
    }
}

export async function readRoomFilePreviewAsset(input: {
    roomId: string
    surface: RoomFileSurface
    relativePath: string
}): Promise<RoomFilePreviewAsset> {
    const resolved = await resolveExistingPath(input)
    const fileStat = await lstat(resolved.path)
    if (!fileStat.isFile()) {
        throw new Error('File preview only supports regular files')
    }

    const name = resolved.relativePath.split('/').at(-1) ?? resolved.relativePath
    const mediaType = mediaTypeFor(resolved.path)

    if (isOfficePath(resolved.path)) {
        const pdfPath = await ensureOfficePdfPreview({
            roomId: input.roomId,
            surface: input.surface,
            relativePath: resolved.relativePath,
            path: resolved.path,
        })
        const previewPath = await ensurePdfImagePreview({
            roomId: input.roomId,
            surface: input.surface,
            relativePath: resolved.relativePath,
            path: pdfPath,
        })
        const read = await readWholePreviewFile(previewPath)
        return {
            name,
            relativePath: resolved.relativePath,
            surface: input.surface,
            mediaType: 'image/png',
            byteLength: read.byteLength,
            content: read.buffer,
            generated: true,
        }
    }

    if (mediaType === 'application/pdf') {
        const previewPath = await ensurePdfImagePreview({
            roomId: input.roomId,
            surface: input.surface,
            relativePath: resolved.relativePath,
            path: resolved.path,
        })
        const read = await readWholePreviewFile(previewPath)
        return {
            name,
            relativePath: resolved.relativePath,
            surface: input.surface,
            mediaType: 'image/png',
            byteLength: read.byteLength,
            content: read.buffer,
            generated: true,
        }
    }

    if (isImageMediaType(mediaType)) {
        const read = await readWholePreviewFile(resolved.path)
        return {
            name,
            relativePath: resolved.relativePath,
            surface: input.surface,
            mediaType,
            byteLength: read.buffer.byteLength,
            content: read.buffer,
            generated: false,
        }
    }

    if (isTextMediaType(mediaType)) {
        const read = await readBoundedPreviewFile(resolved.path, maxPreviewBytes)
        return {
            name,
            relativePath: resolved.relativePath,
            surface: input.surface,
            mediaType,
            byteLength: read.byteLength,
            content: read.buffer,
            generated: false,
        }
    }

    throw new Error('Preview is not available for this file type')
}
