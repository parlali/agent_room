import { createHash, randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { access, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import {
    defineTool,
    type AgentToolResult,
    type ToolDefinition,
} from '@mariozechner/pi-coding-agent'
import { Type } from '@mariozechner/pi-ai'
import type { ImageProviderId } from '../domain/types'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import { ensureShellWritableDirectory, ensureShellWritableFile } from './shell-sandbox'
import { currentToolRunContext } from './tool-run-context'

interface ImageToolContext {
    config: PiRuntimeConfig
    audit: (event: string, payload: unknown) => Promise<void>
}

interface ImageToolDetails {
    path?: string
    artifactId?: string
    sha256?: string
    byteLength?: number
    provider?: string
    model?: string
    imageCount?: number
    latencyMs?: number
}

interface GeneratedImage {
    bytes: Buffer
    mediaType: string
    provider: ImageProviderId
    model: string
    index: number
    metadata: Record<string, unknown>
}

const openAiEndpoint = 'https://api.openai.com/v1/images/generations'
const geminiEndpointBase = 'https://generativelanguage.googleapis.com/v1beta/models'

function textResult(
    text: string,
    details: ImageToolDetails = {},
): AgentToolResult<ImageToolDetails> {
    return {
        content: [
            {
                type: 'text',
                text,
            },
        ],
        details,
    }
}

function clampPositiveInteger(value: unknown, fallback: number, max: number): number {
    const number =
        typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
    return Math.min(max, Math.max(1, number))
}

function sha256Buffer(buffer: Buffer | string): string {
    return createHash('sha256').update(buffer).digest('hex')
}

function extensionForMediaType(mediaType: string): string {
    if (mediaType === 'image/jpeg') {
        return '.jpg'
    }
    if (mediaType === 'image/webp') {
        return '.webp'
    }
    return '.png'
}

function artifactIdFor(path: string, sha256: string): string {
    const base = basename(path, extname(path))
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
    return `${base || 'image'}-${sha256.slice(0, 16)}`
}

function assertInside(candidate: string, root: string): string {
    const normalizedRoot = resolve(root)
    const normalizedCandidate = resolve(candidate)
    const diff = relative(normalizedRoot, normalizedCandidate)
    if (diff === '' || (!diff.startsWith('..') && !isAbsolute(diff))) {
        return normalizedCandidate
    }
    throw new Error(`Path escapes allowed root: ${candidate}`)
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
    ctx: ImageToolContext,
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
    const buffer = await readFile(input.path)
    const sha256 = sha256Buffer(buffer)
    const artifactId = artifactIdFor(input.path, sha256)
    const blobPath = join(ctx.config.paths.storeDir, 'blobs', sha256)
    const manifestPath = join(ctx.config.paths.storeDir, 'manifests', `${artifactId}.json`)
    const runContext = currentToolRunContext()
    await ensureShellWritableDirectory(dirname(blobPath))
    await ensureShellWritableDirectory(dirname(manifestPath))
    await writeFile(blobPath, buffer)
    await ensureShellWritableFile(blobPath)
    await writeFile(
        manifestPath,
        JSON.stringify(
            {
                artifactId,
                sha256,
                byteLength: buffer.byteLength,
                mediaType: input.mediaType,
                sourcePath: relative(ctx.config.paths.workspaceDir, input.path),
                provider: input.provider,
                model: input.model,
                metadata: input.metadata,
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
    }
}

function configuredProvider(
    ctx: ImageToolContext,
    model?: string | null,
): {
    provider: ImageProviderId
    model: string
    apiKey: string
} {
    const provider = ctx.config.image.provider
    const selectedModel = model?.trim() || ctx.config.image.model
    const envKey = ctx.config.image.envKey
    if (!ctx.config.image.enabled || !provider || !selectedModel || !envKey) {
        throw new Error('Image generation is not configured for this room')
    }
    const apiKey = process.env[envKey]
    if (!apiKey) {
        throw new Error(`Image provider credential ${envKey} is not materialized`)
    }
    return {
        provider,
        model: selectedModel,
        apiKey,
    }
}

async function fetchImageUrl(url: string, signal?: AbortSignal): Promise<Buffer> {
    const response = await fetch(url, {
        signal,
    })
    if (!response.ok) {
        throw new Error(`Image URL fetch returned ${response.status}`)
    }
    return Buffer.from(await response.arrayBuffer())
}

async function generateOpenAiImages(input: {
    apiKey: string
    model: string
    prompt: string
    size: string
    quality: string
    count: number
    signal?: AbortSignal
}): Promise<GeneratedImage[]> {
    const response = await fetch(openAiEndpoint, {
        method: 'POST',
        headers: {
            authorization: `Bearer ${input.apiKey}`,
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            model: input.model,
            prompt: input.prompt,
            n: input.count,
            size: input.size,
            quality: input.quality,
        }),
        signal: input.signal,
    })
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null
    if (!response.ok || !payload) {
        throw new Error(`OpenAI image generation failed with ${response.status}`)
    }
    const data = Array.isArray(payload.data) ? payload.data : []
    const images: GeneratedImage[] = []
    for (const [index, entry] of data.entries()) {
        if (!entry || typeof entry !== 'object') {
            continue
        }
        const record = entry as Record<string, unknown>
        const bytes =
            typeof record.b64_json === 'string'
                ? Buffer.from(record.b64_json, 'base64')
                : typeof record.url === 'string'
                  ? await fetchImageUrl(record.url, input.signal)
                  : null
        if (!bytes) {
            continue
        }
        images.push({
            bytes,
            mediaType: 'image/png',
            provider: 'openai',
            model: input.model,
            index,
            metadata: {
                usage: payload.usage ?? null,
                revisedPrompt: record.revised_prompt ?? null,
            },
        })
    }
    if (images.length === 0) {
        throw new Error('OpenAI returned no image data')
    }
    return images
}

async function generateGeminiImages(input: {
    apiKey: string
    model: string
    prompt: string
    size: string
    aspectRatio: string
    count: number
    signal?: AbortSignal
}): Promise<GeneratedImage[]> {
    const images: GeneratedImage[] = []
    for (let index = 0; index < input.count; index += 1) {
        const url = new URL(
            `${geminiEndpointBase}/${encodeURIComponent(input.model)}:generateContent`,
        )
        const imageConfig: Record<string, string> = {
            aspectRatio: input.aspectRatio,
        }
        const imageSize = geminiImageSizeForModel(input.model, input.size)
        if (imageSize) {
            imageConfig.imageSize = imageSize
        }
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-goog-api-key': input.apiKey,
            },
            body: JSON.stringify({
                contents: [
                    {
                        parts: [
                            {
                                text: input.prompt,
                            },
                        ],
                    },
                ],
                generationConfig: {
                    imageConfig,
                },
            }),
            signal: input.signal,
        })
        const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null
        if (!response.ok || !payload) {
            throw new Error(
                `Gemini image generation failed with ${response.status}: ${geminiErrorMessage(payload)}`,
            )
        }
        const candidates = Array.isArray(payload.candidates) ? payload.candidates : []
        for (const candidate of candidates) {
            if (!candidate || typeof candidate !== 'object') {
                continue
            }
            const parts = (
                (candidate as Record<string, unknown>).content as
                    | Record<string, unknown>
                    | undefined
            )?.parts
            if (!Array.isArray(parts)) {
                continue
            }
            for (const part of parts) {
                if (!part || typeof part !== 'object') {
                    continue
                }
                const inlineData = (part as Record<string, unknown>).inlineData as
                    | Record<string, unknown>
                    | undefined
                const data = inlineData?.data
                if (typeof data !== 'string') {
                    continue
                }
                images.push({
                    bytes: Buffer.from(data, 'base64'),
                    mediaType:
                        typeof inlineData?.mimeType === 'string'
                            ? inlineData.mimeType
                            : 'image/png',
                    provider: 'gemini',
                    model: input.model,
                    index: images.length,
                    metadata: {
                        usageMetadata: payload.usageMetadata ?? null,
                    },
                })
            }
        }
    }
    if (images.length === 0) {
        throw new Error('Gemini returned no image data')
    }
    return images
}

function geminiErrorMessage(payload: Record<string, unknown> | null): string {
    const error = payload?.error
    if (error && typeof error === 'object' && !Array.isArray(error)) {
        const message = (error as Record<string, unknown>).message
        if (typeof message === 'string' && message.trim()) {
            return message.trim().slice(0, 500)
        }
    }
    return 'No response body'
}

function geminiImageSizeForModel(model: string, size: string): string | null {
    const normalizedModel = model.trim().toLowerCase()
    const supportsImageSize =
        normalizedModel.startsWith('gemini-3.1-flash-image') ||
        normalizedModel.startsWith('gemini-3-pro-image')
    if (!supportsImageSize) {
        return null
    }

    const normalized = size.trim().toUpperCase()
    const allowed = normalizedModel.startsWith('gemini-3.1-flash-image')
        ? new Set(['0.5K', '1K', '2K', '4K'])
        : new Set(['1K', '2K', '4K'])
    if (allowed.has(normalized)) {
        return normalized
    }

    const dimensionMatch = normalized.match(/^(\d{3,5})X(\d{3,5})$/)
    if (dimensionMatch) {
        const width = Number(dimensionMatch[1])
        const height = Number(dimensionMatch[2])
        const maxDimension = Math.max(width, height)
        if (maxDimension <= 512 && allowed.has('0.5K')) {
            return '0.5K'
        }
        if (maxDimension <= 1024) {
            return '1K'
        }
        if (maxDimension <= 2048) {
            return '2K'
        }
        return '4K'
    }

    return '1K'
}

async function generateImages(
    ctx: ImageToolContext,
    input: {
        prompt: string
        model?: string | null
        size: string
        aspectRatio: string
        quality: string
        count: number
        signal?: AbortSignal
    },
): Promise<GeneratedImage[]> {
    const configured = configuredProvider(ctx, input.model)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), ctx.config.budgets.imageGenerationMs)
    timeout.unref?.()
    input.signal?.addEventListener('abort', () => controller.abort(), { once: true })
    try {
        if (configured.provider === 'openai') {
            return await generateOpenAiImages({
                apiKey: configured.apiKey,
                model: configured.model,
                prompt: input.prompt,
                size: input.size,
                quality: input.quality,
                count: input.count,
                signal: controller.signal,
            })
        }
        return await generateGeminiImages({
            apiKey: configured.apiKey,
            model: configured.model,
            prompt: input.prompt,
            size: input.size,
            aspectRatio: input.aspectRatio,
            count: input.count,
            signal: controller.signal,
        })
    } finally {
        clearTimeout(timeout)
    }
}

function safePrefix(value: string | undefined): string {
    return (value?.trim() || `image-${randomUUID()}`)
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80)
}

async function saveImages(
    ctx: ImageToolContext,
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
    const outputDir = await resolveGeneratedImageDirectory(ctx.config)
    await ensureShellWritableDirectory(outputDir)
    const saved = []
    for (const image of images) {
        const path = join(
            outputDir,
            `${prefix}-${image.index + 1}${extensionForMediaType(image.mediaType)}`,
        )
        await writeFile(path, image.bytes)
        await ensureShellWritableFile(path)
        const artifact = await promoteImageArtifact(ctx, {
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

function createImageGenerateTool(ctx: ImageToolContext): ToolDefinition {
    return defineTool({
        name: 'agent_room_image_generate',
        label: 'Generate Image',
        description: 'Generate images through the configured room image provider.',
        promptSnippet:
            'agent_room_image_generate creates provider-backed images and stores them as durable artifacts.',
        parameters: Type.Object({
            prompt: Type.String(),
            model: Type.Optional(Type.String()),
            size: Type.Optional(Type.String()),
            aspectRatio: Type.Optional(Type.String()),
            quality: Type.Optional(Type.String()),
            count: Type.Optional(Type.Number()),
            outputPrefix: Type.Optional(Type.String()),
        }),
        executionMode: 'sequential',
        execute: async (_toolCallId, input, signal) => {
            const startedAt = Date.now()
            try {
                const images = await generateImages(ctx, {
                    prompt: input.prompt,
                    model: input.model,
                    size: input.size?.trim() || '1024x1024',
                    aspectRatio: input.aspectRatio?.trim() || '1:1',
                    quality: input.quality?.trim() || 'auto',
                    count: clampPositiveInteger(input.count, 1, 4),
                    signal,
                })
                const saved = await saveImages(ctx, images, input.outputPrefix)
                const latencyMs = Date.now() - startedAt
                const provider = images[0]?.provider
                const model = images[0]?.model
                await ctx.audit('tool.image_generate', {
                    provider,
                    model,
                    imageCount: saved.length,
                    latencyMs,
                    promptLength: input.prompt.length,
                    status: 'complete',
                })
                return textResult(
                    saved
                        .map(
                            (image) =>
                                `${relative(ctx.config.paths.workspaceDir, image.path)} ${image.artifactId} ${image.sha256}`,
                        )
                        .join('\n'),
                    {
                        path: saved[0]?.path,
                        artifactId: saved[0]?.artifactId,
                        sha256: saved[0]?.sha256,
                        byteLength: saved.reduce((sum, image) => sum + image.byteLength, 0),
                        provider,
                        model,
                        imageCount: saved.length,
                        latencyMs,
                    },
                )
            } catch (error) {
                await ctx.audit('tool.image_generate', {
                    model: typeof input.model === 'string' ? input.model : ctx.config.image.model,
                    imageCount: 0,
                    latencyMs: Date.now() - startedAt,
                    promptLength: input.prompt.length,
                    status: 'failed',
                    error:
                        error instanceof Error ? error.message : 'Unknown image generation error',
                })
                throw error
            }
        },
    })
}

export function createImageTools(ctx: ImageToolContext): ToolDefinition[] {
    return ctx.config.capabilities.images ? [createImageGenerateTool(ctx)] : []
}
