import type { ImageProviderId } from '#/domain/domain-types'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'

export interface GeneratedImage {
    bytes: Buffer
    mediaType: string
    provider: ImageProviderId
    model: string
    index: number
    metadata: Record<string, unknown>
}

const openAiEndpoint = 'https://api.openai.com/v1/images/generations'
const geminiEndpointBase = 'https://generativelanguage.googleapis.com/v1beta/models'

function configuredProvider(
    config: PiRuntimeConfig,
    model?: string | null,
): {
    provider: ImageProviderId
    model: string
    apiKey: string
} {
    const provider = config.image.provider
    const selectedModel = model?.trim() || config.image.model
    const envKey = config.image.envKey
    if (!config.image.enabled || !provider || !selectedModel || !envKey) {
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

export async function generateImages(input: {
    config: PiRuntimeConfig
    prompt: string
    model?: string | null
    size: string
    aspectRatio: string
    quality: string
    count: number
    signal?: AbortSignal
}): Promise<GeneratedImage[]> {
    const configured = configuredProvider(input.config, input.model)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), input.config.budgets.imageGenerationMs)
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
