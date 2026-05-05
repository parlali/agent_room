import { createHash } from 'node:crypto'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative } from 'node:path'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import { ensureShellWritableDirectory, ensureShellWritableFile } from './shell-sandbox'
import { currentToolRunContext } from './tool-run-context'

export interface RuntimeArtifact {
    artifactId: string
    sha256: string
    byteLength: number
    blobPath: string
    manifestPath: string
}

export function sha256Buffer(buffer: Buffer | string): string {
    return createHash('sha256').update(buffer).digest('hex')
}

function artifactIdFor(path: string, sha256: string, fallbackName: string): string {
    const base = basename(path, extname(path))
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
    return `${base || fallbackName}-${sha256.slice(0, 16)}`
}

export async function promoteRuntimeArtifact(input: {
    config: PiRuntimeConfig
    path: string
    mediaType: string
    fallbackName?: string
    metadata?: Record<string, unknown>
}): Promise<RuntimeArtifact> {
    const buffer = await readFile(input.path)
    const sha256 = sha256Buffer(buffer)
    const artifactId = artifactIdFor(input.path, sha256, input.fallbackName ?? 'artifact')
    const blobPath = join(input.config.paths.storeDir, 'blobs', sha256)
    const manifestPath = join(input.config.paths.storeDir, 'manifests', `${artifactId}.json`)
    const workspaceRoot = await realpath(input.config.paths.workspaceDir)
    const sourcePath = relative(workspaceRoot, await realpath(input.path))
    const runContext = currentToolRunContext()

    await ensureShellWritableDirectory(dirname(blobPath))
    await ensureShellWritableDirectory(dirname(manifestPath))
    await writeFile(blobPath, buffer)
    await ensureShellWritableFile(blobPath)
    await writeFile(
        manifestPath,
        JSON.stringify(
            {
                ...(input.metadata ?? {}),
                artifactId,
                sha256,
                byteLength: buffer.byteLength,
                mediaType: input.mediaType,
                sourcePath,
                createdAt: new Date().toISOString(),
                sessionKey: runContext?.sessionKey ?? null,
                runId: runContext?.runId ?? null,
            },
            null,
            4,
        ),
        'utf8',
    )
    await ensureShellWritableFile(manifestPath)

    return {
        artifactId,
        sha256,
        byteLength: buffer.byteLength,
        blobPath,
        manifestPath,
    }
}
