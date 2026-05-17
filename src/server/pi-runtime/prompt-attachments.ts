import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { SessionEntry } from '@mariozechner/pi-coding-agent'
import type { Api, ImageContent, Model } from '@mariozechner/pi-ai'
import {
    formatMessageWithAttachments,
    parseRoomMessageAttachments,
    type RoomAttachment,
} from '#/lib/room-attachments'
import type { RoomFileSurface } from '#/lib/room-file-types'
import { formatBytes } from '#/lib/format'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import { assertPathInsideRoot } from '../security/path-boundary'
import { shellVisibleStoreDirEnvKey, shellVisibleWorkspaceDirEnvKey } from '../security/process-env'
import {
    isPdfMediaType,
    materializePdfRead,
    modelAcceptsImages,
    renderPdfPageImages,
    type PdfIngestionRecord,
} from './pdf-ingestion'
import { isRecord } from './runtime-redaction'

export const promptAttachmentMetadataType = 'agent_room.prompt_attachments.v1'

export interface PromptAttachmentMetadata {
    text: string
    attachments: RoomAttachment[]
    ingestions: PdfIngestionRecord[]
}

export interface PreparedPrompt {
    text: string
    images?: ImageContent[]
    metadata?: PromptAttachmentMetadata
}

type RenderPdfPageImages = typeof renderPdfPageImages

interface MaterializedAttachment {
    attachment: RoomAttachment
    path: string
    byteLength: number
    mediaType: string
    sha256: string
    content: ImageContent[]
    ingestion?: PdfIngestionRecord
}

const supportedImageTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

function rootPath(config: PiRuntimeConfig, surface: RoomFileSurface): string {
    return surface === 'store' ? config.paths.storeDir : config.paths.workspaceDir
}

function assertAttachmentReference(attachment: RoomAttachment): void {
    if (attachment.surface === 'workspace') {
        return
    }
    if (attachment.surface !== 'store' || !attachment.relativePath.startsWith('attachments/')) {
        throw new Error(`Attached file "${attachment.name}" is not a canonical upload attachment`)
    }
}

async function resolveAttachmentPath(
    config: PiRuntimeConfig,
    attachment: RoomAttachment,
): Promise<string> {
    assertAttachmentReference(attachment)
    const root = await realpath(rootPath(config, attachment.surface))
    const requested = assertPathInsideRoot(
        join(root, attachment.relativePath),
        root,
        (path) => `Attachment path escapes room storage: ${path}`,
    )
    const path = assertPathInsideRoot(
        await realpath(requested),
        root,
        (candidate) => `Attachment path escapes room storage: ${candidate}`,
    )
    return path
}

function sniffSupportedImageMediaType(bytes: Buffer): string | null {
    if (
        bytes.length >= 8 &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47 &&
        bytes[4] === 0x0d &&
        bytes[5] === 0x0a &&
        bytes[6] === 0x1a &&
        bytes[7] === 0x0a
    ) {
        return 'image/png'
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return 'image/jpeg'
    }
    const header = bytes.subarray(0, 12).toString('ascii')
    if (header.startsWith('GIF87a') || header.startsWith('GIF89a')) {
        return 'image/gif'
    }
    if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') {
        return 'image/webp'
    }
    return null
}

function inferMediaType(path: string, bytes: Buffer): string {
    const imageType = sniffSupportedImageMediaType(bytes)
    if (imageType) return imageType
    const lower = path.toLowerCase()
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
    if (lower.endsWith('.txt')) return 'text/plain'
    if (lower.endsWith('.md')) return 'text/markdown'
    if (lower.endsWith('.json')) return 'application/json'
    return 'application/octet-stream'
}

function looksLikeImageAttachment(attachment: RoomAttachment, mediaType: string): boolean {
    if (mediaType.startsWith('image/')) return true
    const lower = `${attachment.name} ${attachment.relativePath}`.toLowerCase()
    return /\.(png|jpe?g|gif|webp|bmp|tiff?|heic|heif|svg)(\s|$|[?#])/i.test(lower)
}

async function materializeAttachment(
    config: PiRuntimeConfig,
    attachment: RoomAttachment,
    model: Model<Api> | undefined,
    renderImages: RenderPdfPageImages,
): Promise<MaterializedAttachment> {
    const path = await resolveAttachmentPath(config, attachment)
    const fileStat = await stat(path)
    if (!fileStat.isFile()) {
        throw new Error(`Attached file "${attachment.name}" is not a file`)
    }
    const bytes = await readFile(path)
    const mediaType = inferMediaType(path, bytes)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const canonicalAttachment = {
        ...attachment,
        name: attachment.name || basename(path),
        byteLength: fileStat.size,
    }
    if (isPdfMediaType(mediaType)) {
        const pdf = await materializePdfRead({
            config,
            path,
            bytes,
            model,
            renderImages,
        })
        return {
            attachment: canonicalAttachment,
            path,
            byteLength: fileStat.size,
            mediaType,
            sha256,
            content: pdf.content,
            ingestion: {
                attachmentId: attachment.id,
                name: canonicalAttachment.name,
                relativePath: attachment.relativePath,
                mediaType,
                ingestionMode: pdf.mode,
                pageCount: pdf.pageCount,
                pages: pdf.selectedPages.label,
                requestedPages: pdf.requestedPages,
                inputBlocks: pdf.content.length,
                degraded: pdf.degraded,
                degradedReason: pdf.degradedReason,
            },
        }
    }
    const content = supportedImageTypes.has(mediaType)
        ? [
              {
                  type: 'image' as const,
                  data: bytes.toString('base64'),
                  mimeType: mediaType,
              },
          ]
        : []
    return {
        attachment: canonicalAttachment,
        path,
        byteLength: fileStat.size,
        mediaType,
        sha256,
        content,
    }
}

function assertSupportedImageAttachments(attachments: MaterializedAttachment[]): void {
    const unsupportedImage = attachments.find(
        (attachment) =>
            attachment.content.length === 0 &&
            looksLikeImageAttachment(attachment.attachment, attachment.mediaType),
    )
    if (!unsupportedImage) return
    throw new Error(
        `Attached image "${unsupportedImage.attachment.name}" could not be passed as direct image input. Images must be handled by the model attachment path, not by shell commands, OCR, conversion utilities, or package installs.`,
    )
}

function assertModelAcceptsImages(model: Model<Api> | undefined, images: ImageContent[]): void {
    if (images.length === 0) return
    if (!model) {
        throw new Error('Attached images require a selected multimodal model')
    }
    if (!modelAcceptsImages(model)) {
        throw new Error(
            `Attached images require a multimodal model, but ${model.provider}/${model.id} only accepts ${model.input.join(', ') || 'unknown'} input`,
        )
    }
}

function diskReference(attachment: MaterializedAttachment): string {
    const rootVariable =
        attachment.attachment.surface === 'store'
            ? `$${shellVisibleStoreDirEnvKey}`
            : `$${shellVisibleWorkspaceDirEnvKey}`
    return [
        `root=${attachment.attachment.surface}`,
        `path="${attachment.attachment.relativePath}"`,
        `shellPath="${rootVariable}/${attachment.attachment.relativePath}"`,
    ].join(' ')
}

function attachmentSummaryLine(attachment: MaterializedAttachment, index: number): string {
    const kind = attachment.ingestion ? 'PDF' : attachment.content.length > 0 ? 'Image' : 'File'
    const base = [
        `${kind} attachment ${index + 1}: ${attachment.attachment.name}`,
        `type ${attachment.mediaType}`,
        `size ${formatBytes(attachment.byteLength)}`,
        `sha256 ${attachment.sha256}`,
    ]
    if (attachment.ingestion?.ingestionMode === 'native_document') {
        return [
            ...base,
            `provided as native PDF document input (${attachment.ingestion.pages})`,
            attachment.ingestion.degraded && attachment.ingestion.degradedReason
                ? `degraded: ${attachment.ingestion.degradedReason}`
                : null,
        ]
            .filter((part): part is string => part !== null)
            .join(', ')
    }
    if (attachment.ingestion?.ingestionMode === 'image_render') {
        return [
            ...base,
            `provided as rendered PDF page images (${attachment.ingestion.pages})`,
            attachment.ingestion.degraded && attachment.ingestion.degradedReason
                ? `degraded: ${attachment.ingestion.degradedReason}`
                : null,
        ]
            .filter((part): part is string => part !== null)
            .join(', ')
    }
    if (attachment.ingestion?.ingestionMode === 'unsupported') {
        return [
            ...base,
            `PDF content was not provided to the model (${attachment.ingestion.pages})`,
            attachment.ingestion.degradedReason
                ? `unsupported: ${attachment.ingestion.degradedReason}`
                : null,
            `available as room-local file ${diskReference(attachment)}`,
        ]
            .filter((part): part is string => part !== null)
            .join(', ')
    }
    if (attachment.content.length > 0) {
        return [...base, 'provided as direct image input'].join(', ')
    }
    return [...base, `available as room-local file ${diskReference(attachment)}`].join(', ')
}

function promptTextForAttachments(text: string, attachments: MaterializedAttachment[]): string {
    const body = text.trim() || 'Please review the attached file(s).'
    const summary = attachments.map(attachmentSummaryLine).join('\n')
    return `${body}\n\nAttached files:\n${summary}`
}

export async function preparePromptWithAttachments(input: {
    config: PiRuntimeConfig
    model: Model<Api> | undefined
    message: string
    renderPdfPageImages?: RenderPdfPageImages
}): Promise<PreparedPrompt> {
    const parsed = parseRoomMessageAttachments(input.message)
    if (parsed.attachments.length === 0) {
        return {
            text: input.message,
        }
    }

    const materialized = await Promise.all(
        parsed.attachments.map((attachment) =>
            materializeAttachment(
                input.config,
                attachment,
                input.model,
                input.renderPdfPageImages ?? renderPdfPageImages,
            ),
        ),
    )
    assertSupportedImageAttachments(materialized)
    const images = materialized.flatMap((attachment) => attachment.content)
    assertModelAcceptsImages(input.model, images)

    const attachments = materialized.map((attachment) => attachment.attachment)
    const ingestions = materialized
        .map((attachment) => attachment.ingestion)
        .filter((ingestion): ingestion is PdfIngestionRecord => ingestion !== undefined)
    return {
        text: promptTextForAttachments(parsed.text, materialized),
        images,
        metadata: {
            text: parsed.text,
            attachments,
            ingestions,
        },
    }
}

function roomAttachmentFromValue(value: unknown): RoomAttachment | null {
    if (!isRecord(value)) return null
    const surface = value.surface
    const relativePath = value.relativePath
    const name = value.name
    if (
        (surface !== 'workspace' && surface !== 'store') ||
        typeof relativePath !== 'string' ||
        typeof name !== 'string'
    ) {
        return null
    }
    const byteLength =
        typeof value.byteLength === 'number' && Number.isFinite(value.byteLength)
            ? value.byteLength
            : null
    const sizeLabel = typeof value.sizeLabel === 'string' ? value.sizeLabel : null
    return {
        id: typeof value.id === 'string' ? value.id : `${surface}:${relativePath}`,
        name,
        surface,
        relativePath,
        byteLength,
        sizeLabel,
    }
}

export function promptAttachmentMetadataFromValue(value: unknown): PromptAttachmentMetadata | null {
    if (!isRecord(value)) return null
    const text = typeof value.text === 'string' ? value.text : ''
    const attachments = Array.isArray(value.attachments)
        ? value.attachments
              .map(roomAttachmentFromValue)
              .filter((attachment): attachment is RoomAttachment => attachment !== null)
        : []
    if (attachments.length === 0) return null
    const ingestions = Array.isArray(value.ingestions)
        ? value.ingestions
              .map(pdfIngestionRecordFromValue)
              .filter((ingestion): ingestion is PdfIngestionRecord => ingestion !== null)
        : []
    return {
        text,
        attachments,
        ingestions,
    }
}

function pdfIngestionRecordFromValue(value: unknown): PdfIngestionRecord | null {
    if (!isRecord(value)) return null
    const ingestionMode = value.ingestionMode
    if (
        ingestionMode !== 'native_document' &&
        ingestionMode !== 'image_render' &&
        ingestionMode !== 'unsupported'
    ) {
        return null
    }
    const attachmentId = typeof value.attachmentId === 'string' ? value.attachmentId : ''
    const name = typeof value.name === 'string' ? value.name : ''
    const relativePath = typeof value.relativePath === 'string' ? value.relativePath : ''
    const mediaType = typeof value.mediaType === 'string' ? value.mediaType : 'application/pdf'
    return {
        attachmentId,
        name,
        relativePath,
        mediaType,
        ingestionMode,
        pageCount:
            typeof value.pageCount === 'number' && Number.isFinite(value.pageCount)
                ? value.pageCount
                : null,
        pages: typeof value.pages === 'string' ? value.pages : null,
        requestedPages: typeof value.requestedPages === 'string' ? value.requestedPages : null,
        inputBlocks:
            typeof value.inputBlocks === 'number' && Number.isFinite(value.inputBlocks)
                ? value.inputBlocks
                : 0,
        degraded: value.degraded === true,
        degradedReason: typeof value.degradedReason === 'string' ? value.degradedReason : null,
    }
}

export function promptAttachmentMetadataByEntryId(
    entries: SessionEntry[],
): Map<string, PromptAttachmentMetadata> {
    const metadata = new Map<string, PromptAttachmentMetadata>()
    for (const entry of entries) {
        if (entry.type !== 'custom' || entry.customType !== promptAttachmentMetadataType) {
            continue
        }
        const value = promptAttachmentMetadataFromValue(entry.data)
        if (value) {
            metadata.set(entry.id, value)
        }
    }
    return metadata
}

export function displayTextWithPromptAttachments(
    fallbackText: string,
    metadata: PromptAttachmentMetadata | null,
): string {
    if (!metadata) return fallbackText
    return formatMessageWithAttachments(metadata.text, metadata.attachments)
}
