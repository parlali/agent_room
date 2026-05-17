import { randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { access, mkdir, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ImageProviderId } from '../domain/types'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import { assertPathInsideRoot } from '../security/path-boundary'
import { promoteRuntimeArtifact } from './runtime-artifacts'
import { ensureShellWritableDirectory, ensureShellWritableFile } from './shell-sandbox'
import type { GeneratedImage } from './image-generation'

function extensionForMediaType(mediaType: string): string {
    if (mediaType === 'image/jpeg') {
        return '.jpg'
    }
    if (mediaType === 'image/webp') {
        return '.webp'
    }
    return '.png'
}

function assertInside(candidate: string, root: string): string {
    return assertPathInsideRoot(candidate, root, (path) => `Path escapes allowed root: ${path}`)
}

function isNotFoundFsError(error: unknown): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        String((error as { code: unknown }).code) === 'ENOENT'
    )
}

async function resolveGeneratedImageDirectory(config: PiRuntimeConfig): Promise<string> {
    const workspace = await realpath(config.paths.workspaceDir)
    const outputDir = join(workspace, 'generated-images')
    try {
        await access(outputDir, fsConstants.F_OK)
        return assertInside(await realpath(outputDir), workspace)
    } catch (error) {
        if (!isNotFoundFsError(error)) {
            throw error
        }
        await mkdir(outputDir, {
            recursive: true,
            mode: 0o700,
        })
        return assertInside(await realpath(outputDir), workspace)
    }
}

async function promoteImageArtifact(
    config: PiRuntimeConfig,
    input: {
        path: string
        mediaType: string
        provider: ImageProviderId
        model: string
        metadata: Record<string, unknown>
    },
): Promise<{
    artifactId: string
    sha256: string
    byteLength: number
}> {
    return promoteRuntimeArtifact({
        config,
        path: input.path,
        mediaType: input.mediaType,
        fallbackName: 'image',
        metadata: {
            provider: input.provider,
            model: input.model,
            metadata: input.metadata,
        },
    })
}

function safePrefix(value: string | undefined): string {
    return (value?.trim() || `image-${randomUUID()}`)
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80)
}

export async function saveImages(
    config: PiRuntimeConfig,
    images: GeneratedImage[],
    outputPrefix?: string,
): Promise<
    Array<{
        path: string
        artifactId: string
        sha256: string
        byteLength: number
    }>
> {
    const prefix = safePrefix(outputPrefix)
    const outputDir = await resolveGeneratedImageDirectory(config)
    await ensureShellWritableDirectory(config, outputDir)
    const saved = []
    for (const image of images) {
        const path = join(
            outputDir,
            `${prefix}-${image.index + 1}${extensionForMediaType(image.mediaType)}`,
        )
        await writeFile(path, image.bytes)
        await ensureShellWritableFile(config, path)
        const artifact = await promoteImageArtifact(config, {
            path,
            mediaType: image.mediaType,
            provider: image.provider,
            model: image.model,
            metadata: image.metadata,
        })
        saved.push({
            path,
            ...artifact,
        })
    }
    return saved
}
