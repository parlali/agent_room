import { relative } from 'node:path'
import { defineTool, type ToolDefinition } from '@mariozechner/pi-coding-agent'
import { Type } from '@mariozechner/pi-ai'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import { saveImages } from './image-artifacts'
import { generateImages } from './image-generation'
import { clampPositiveInteger, textToolResult } from './tool-helpers'

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

function createImageGenerateTool(ctx: ImageToolContext): ToolDefinition {
    return defineTool({
        name: 'image_generate',
        label: 'Generate Image',
        description: 'Generate images through the configured image provider.',
        promptSnippet:
            'image_generate creates provider-backed images and stores them as durable artifacts.',
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
                const images = await generateImages({
                    config: ctx.config,
                    prompt: input.prompt,
                    model: input.model,
                    size: input.size?.trim() || '1024x1024',
                    aspectRatio: input.aspectRatio?.trim() || '1:1',
                    quality: input.quality?.trim() || 'auto',
                    count: clampPositiveInteger(input.count, 1, 4),
                    signal,
                })
                const saved = await saveImages(ctx.config, images, input.outputPrefix)
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
                return textToolResult<ImageToolDetails>(
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
