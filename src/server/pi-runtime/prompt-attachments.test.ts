import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Api, Model } from '@mariozechner/pi-ai'
import { describe, expect, it } from 'vitest'
import { formatMessageWithAttachments, type RoomAttachment } from '#/lib/room-attachments'
import {
    displayTextWithPromptAttachments,
    preparePromptWithAttachments,
    promptAttachmentMetadataByEntryId,
    promptAttachmentMetadataType,
} from './prompt-attachments'
import { createTestPiRuntimeConfig, ensureTestPiRuntimeDirectories } from './test-runtime-defaults'

const pngBytes = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
])

function model(input: Array<'text' | 'image'>): Model<Api> {
    return {
        id: 'model',
        name: 'Model',
        provider: 'provider',
        api: 'openai-responses',
        baseUrl: 'https://example.test',
        reasoning: false,
        input,
        cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
        },
        contextWindow: 128000,
        maxTokens: 4096,
    }
}

async function withConfig<T>(fn: (root: string) => Promise<T>): Promise<T> {
    const root = await mkdtemp(join(tmpdir(), 'agent-room-attachments-'))
    try {
        return await fn(root)
    } finally {
        await rm(root, {
            recursive: true,
            force: true,
        })
    }
}

function attachment(path: string, name = 'screenshot.png'): RoomAttachment {
    return {
        id: `store:${path}`,
        name,
        surface: 'store',
        relativePath: path,
        byteLength: pngBytes.byteLength,
        sizeLabel: null,
    }
}

describe('prompt attachments', () => {
    it('materializes uploaded images as Pi image content without exposing storage paths', async () => {
        await withConfig(async (root) => {
            const config = createTestPiRuntimeConfig({ root })
            await ensureTestPiRuntimeDirectories(config)
            const relativePath = 'attachments/session/image.png'
            await mkdir(join(config.paths.storeDir, 'attachments/session'), {
                recursive: true,
            })
            await writeFile(join(config.paths.storeDir, relativePath), pngBytes)

            const prepared = await preparePromptWithAttachments({
                config,
                model: model(['text', 'image']),
                message: formatMessageWithAttachments('What is in this?', [
                    attachment(relativePath),
                ]),
            })

            expect(prepared.images).toHaveLength(1)
            expect(prepared.images?.[0]?.mimeType).toBe('image/png')
            expect(prepared.text).toContain('Image attachment 1: screenshot.png')
            expect(prepared.text).toContain('provided as direct image input')
            expect(prepared.text).not.toContain('root=store')
            expect(prepared.text).not.toContain(relativePath)
            expect(prepared.metadata?.attachments[0]?.relativePath).toBe(relativePath)
        })
    })

    it('rejects images for text-only models before Pi can silently ignore them', async () => {
        await withConfig(async (root) => {
            const config = createTestPiRuntimeConfig({ root })
            await ensureTestPiRuntimeDirectories(config)
            const relativePath = 'attachments/session/image.png'
            await mkdir(join(config.paths.storeDir, 'attachments/session'), {
                recursive: true,
            })
            await writeFile(join(config.paths.storeDir, relativePath), pngBytes)

            await expect(
                preparePromptWithAttachments({
                    config,
                    model: model(['text']),
                    message: formatMessageWithAttachments('What is in this?', [
                        attachment(relativePath),
                    ]),
                }),
            ).rejects.toThrow(/multimodal model/)
        })
    })

    it('keeps non-image uploads as room-local file references', async () => {
        await withConfig(async (root) => {
            const config = createTestPiRuntimeConfig({ root })
            await ensureTestPiRuntimeDirectories(config)
            const relativePath = 'attachments/session/spec.pdf'
            await mkdir(join(config.paths.storeDir, 'attachments/session'), {
                recursive: true,
            })
            await writeFile(join(config.paths.storeDir, relativePath), Buffer.from('%PDF-1.7'))

            const prepared = await preparePromptWithAttachments({
                config,
                model: model(['text', 'image']),
                message: formatMessageWithAttachments('Read this', [
                    {
                        ...attachment(relativePath, 'spec.pdf'),
                        byteLength: 8,
                    },
                ]),
            })

            expect(prepared.images).toHaveLength(0)
            expect(prepared.text).toContain('File attachment 1: spec.pdf')
            expect(prepared.text).toContain('available as room-local file')
            expect(prepared.text).toContain('root=store path="attachments/session/spec.pdf"')
            expect(prepared.text).toContain(
                'shellPath="$AGENT_ROOM_STORE_DIR/attachments/session/spec.pdf"',
            )
        })
    })

    it('rejects image uploads that cannot be passed as direct image input', async () => {
        await withConfig(async (root) => {
            const config = createTestPiRuntimeConfig({ root })
            await ensureTestPiRuntimeDirectories(config)
            const relativePath = 'attachments/session/image.tiff'
            await mkdir(join(config.paths.storeDir, 'attachments/session'), {
                recursive: true,
            })
            await writeFile(join(config.paths.storeDir, relativePath), Buffer.from('not-tiff'))

            await expect(
                preparePromptWithAttachments({
                    config,
                    model: model(['text', 'image']),
                    message: formatMessageWithAttachments('What is in this?', [
                        attachment(relativePath, 'image.tiff'),
                    ]),
                }),
            ).rejects.toThrow(/direct image input/)
        })
    })

    it('keeps attachment card metadata outside the LLM message text', () => {
        const metadata = {
            text: 'Look at this',
            attachments: [attachment('attachments/session/image.png')],
        }
        const map = promptAttachmentMetadataByEntryId([
            {
                type: 'custom',
                customType: promptAttachmentMetadataType,
                data: metadata,
                id: 'metadata-1',
                parentId: null,
                timestamp: new Date(0).toISOString(),
            },
        ])

        expect(
            displayTextWithPromptAttachments('Look at this', map.get('metadata-1') ?? null),
        ).toContain('root=store path="attachments/session/image.png"')
    })
})
