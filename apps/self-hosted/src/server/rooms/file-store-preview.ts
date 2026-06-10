import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, lstat, mkdir, mkdtemp, open, readFile, rename, rm, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type {
    RoomFilePreview,
    RoomFilePreviewAsset,
    RoomFileResolvedAsset,
    RoomFileSurface,
} from '#/domain/room-file-types'
import { getRoomPaths } from './room-paths'
import { resolveExistingPath, rootPath } from './file-store'

const maxPreviewBytes = 512000
const maxBinaryPreviewBytes = 8 * 1024 * 1024
const previewTimeoutMs = 60000
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

function pdfPreviewName(path: string): string {
    return `${basename(path, extname(path))}.pdf`
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
    const asset = await resolveRoomFilePreviewAsset(input)
    const read = await readWholePreviewFile(asset.path)
    return {
        name: asset.name,
        relativePath: asset.relativePath,
        surface: asset.surface,
        mediaType: asset.mediaType,
        byteLength: read.byteLength,
        content: read.buffer,
        generated: asset.generated,
    }
}

export async function resolveRoomFilePreviewAsset(input: {
    roomId: string
    surface: RoomFileSurface
    relativePath: string
}): Promise<RoomFileResolvedAsset> {
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
        const pdfStat = await stat(pdfPath)
        return {
            name: pdfPreviewName(name),
            relativePath: resolved.relativePath,
            surface: input.surface,
            mediaType: 'application/pdf',
            byteLength: pdfStat.size,
            path: pdfPath,
            generated: true,
        }
    }

    if (mediaType === 'application/pdf') {
        return {
            name,
            relativePath: resolved.relativePath,
            surface: input.surface,
            mediaType,
            byteLength: fileStat.size,
            path: resolved.path,
            generated: false,
        }
    }

    if (isImageMediaType(mediaType)) {
        return {
            name,
            relativePath: resolved.relativePath,
            surface: input.surface,
            mediaType,
            byteLength: fileStat.size,
            path: resolved.path,
            generated: false,
        }
    }

    if (isTextMediaType(mediaType)) {
        return {
            name,
            relativePath: resolved.relativePath,
            surface: input.surface,
            mediaType,
            byteLength: fileStat.size,
            path: resolved.path,
            generated: false,
        }
    }

    throw new Error('Preview is not available for this file type')
}

export async function resolveRoomFileDownloadAsset(input: {
    roomId: string
    surface: RoomFileSurface
    relativePath: string
}): Promise<RoomFileResolvedAsset> {
    const resolved = await resolveExistingPath(input)
    const fileStat = await lstat(resolved.path)
    if (!fileStat.isFile()) {
        throw new Error('File download only supports regular files')
    }
    return {
        name: resolved.relativePath.split('/').at(-1) ?? resolved.relativePath,
        relativePath: resolved.relativePath,
        surface: input.surface,
        mediaType: mediaTypeFor(resolved.path),
        byteLength: fileStat.size,
        path: resolved.path,
        generated: false,
    }
}
