import { constants as fsConstants } from 'node:fs'
import { access, realpath, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join } from 'node:path'
import type { PiRuntimeConfig } from '../../rooms/pi-runtime-config'
import { assertPathInsideRoot } from '../../security/path-boundary'
import { ensureShellWritableDirectory, ensureShellWritableFile } from '../shell-sandbox'

function assertInside(candidate: string, root: string): string {
    return assertPathInsideRoot(candidate, root, (path) => `Path escapes allowed root: ${path}`)
}

function workspacePath(config: PiRuntimeConfig, path: string): string {
    const requested = path.trim()
    if (!requested) {
        throw new Error('Path cannot be empty')
    }
    return assertInside(
        isAbsolute(requested) ? requested : join(config.paths.workspaceDir, requested),
        config.paths.workspaceDir,
    )
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
    const root = await realpath(config.paths.workspaceDir)
    const requested = workspacePath(config, path)
    return assertInside(await realpath(requested), root)
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
