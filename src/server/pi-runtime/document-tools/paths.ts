import { randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { access, realpath, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join } from 'node:path'
import type { PiRuntimeConfig } from '../../rooms/pi-runtime-config'
import { assertPathInsideRoot } from '../../security/path-boundary'
import { ensureShellWritableDirectory, ensureShellWritableFile } from '../shell-sandbox'
import { resolveExistingToolPath } from '../room-tools/file-helpers'
import type { ToolRoot } from '../room-tools/shared'

function assertInside(candidate: string, root: string): string {
    return assertPathInsideRoot(candidate, root, (path) => `Path escapes allowed root: ${path}`)
}

function workspacePath(config: PiRuntimeConfig, path: string): string {
    const requested = documentPath(path)
    const base = config.paths.workspaceDir
    return assertInside(isAbsolute(requested) ? requested : join(base, requested), base)
}

function documentPath(path: string): string {
    const requested = path.trim()
    if (!requested) {
        throw new Error('Path cannot be empty')
    }
    return requested
}

function isNotFoundFsError(error: unknown): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        String((error as { code: unknown }).code) === 'ENOENT'
    )
}

async function nearestExistingParent(path: string, root: string): Promise<string> {
    let current = dirname(path)
    while (true) {
        assertInside(current, root)
        try {
            await access(current, fsConstants.F_OK)
            return current
        } catch (error) {
            if (!isNotFoundFsError(error)) {
                throw error
            }
            const next = dirname(current)
            if (next === current) {
                throw new Error(`No existing parent for ${path}`)
            }
            current = next
        }
    }
}

export async function existingWorkspacePath(
    config: PiRuntimeConfig,
    path: string,
): Promise<string> {
    const base = await realpath(config.paths.workspaceDir)
    const requested = workspacePath(config, path)
    return assertInside(await realpath(requested), base)
}

export async function existingDocumentPath(
    config: PiRuntimeConfig,
    root: ToolRoot,
    path: string,
): Promise<string> {
    return resolveExistingToolPath(config, root, documentPath(path))
}

export async function writableWorkspacePath(
    config: PiRuntimeConfig,
    path: string,
): Promise<string> {
    const root = await realpath(config.paths.workspaceDir)
    const requested = workspacePath(config, path)
    try {
        return assertInside(await realpath(requested), root)
    } catch (error) {
        if (!isNotFoundFsError(error)) {
            throw error
        }
    }
    const parent = await nearestExistingParent(requested, config.paths.workspaceDir)
    assertInside(await realpath(parent), root)
    return requested
}

function safeGeneratedName(path: string): string {
    return (
        basename(path, extname(path))
            .replace(/[^a-zA-Z0-9_-]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 80) || 'preview'
    )
}

export async function writableInternalPreviewPath(
    config: PiRuntimeConfig,
    sourcePath: string,
    extension: string,
): Promise<string> {
    const tmpRoot = await realpath(config.paths.tmpDir)
    const previewDir = assertInside(join(tmpRoot, 'previews'), tmpRoot)
    await ensureShellWritableDirectory(previewDir)
    const extensionName = extension.replace(/^\.+/, '') || 'bin'
    const filename = `${safeGeneratedName(sourcePath)}-${randomUUID()}.${extensionName}`
    return assertInside(join(previewDir, filename), tmpRoot)
}

export async function assertExists(path: string): Promise<void> {
    await access(path, fsConstants.F_OK)
}

export function mediaTypeFor(path: string): string {
    const extension = extname(path).toLowerCase()
    if (extension === '.docx') {
        return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    }
    if (extension === '.xlsx') {
        return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }
    if (extension === '.pptx') {
        return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    }
    if (extension === '.pdf') {
        return 'application/pdf'
    }
    if (extension === '.png') {
        return 'image/png'
    }
    return 'application/octet-stream'
}

export async function writeWorkspaceFile(path: string, buffer: Buffer): Promise<void> {
    await ensureShellWritableDirectory(dirname(path))
    await writeFile(path, buffer)
    await ensureShellWritableFile(path)
}
