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

/**
 * Resolve a room attachment to a safe filesystem path, read and fingerprint its bytes, infer its media type, and produce a materialized attachment including model-ready content or PDF ingestion metadata.
 *
 * @param model - Optional model to consider when materializing PDF content (may affect ingestion mode and rendering).
 * @param renderImages - PDF render callback used when producing page-image content for PDFs.
 * @returns A MaterializedAttachment containing:
 *  - `attachment`: canonicalized RoomAttachment (ensures `name` and `byteLength`),
 *  - `path`: absolute filesystem path,
 *  - `byteLength`, `mediaType`, and `sha256`,
 *  - `content`: an array of image inputs when applicable (empty for unsupported non-PDF files),
 *  - `ingestion`: when the file is a PDF, a PdfIngestionRecord describing ingestionMode, page counts/selection, inputBlocks, and any degradation details.
 * @throws If the resolved path does not point to a regular file.
 */
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

/**
 * Validate that all attachments that appear to be images include materialized image content.
 *
 * @param attachments - The list of materialized attachments to check
 * @throws Error if any attachment appears to be an image but has no materialized `content`
 */
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

/**
 * Validates that a selected model can accept the given image inputs.
 *
 * @param model - The selected model to validate against, or `undefined` if none is selected.
 * @param images - Array of image inputs intended for the model; validation runs only when this array is non-empty.
 * @throws If `images` is non-empty and `model` is `undefined`.
 * @throws If `images` is non-empty and `model` does not accept image inputs (error message includes the model provider/id and its accepted input list).
 */
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

/**
 * Builds a shell-style reference describing where the attachment is stored in the room environment.
 *
 * @param attachment - A materialized attachment whose `attachment.surface` and `attachment.relativePath` are used to construct the reference
 * @returns A single-line string in the form `root=<surface> path="<relativePath>" shellPath="<envVar>/<relativePath>"` where `<envVar>` is `$AGENT_ROOM_STORE_DIR` for `store` surfaces and `$AGENT_ROOM_WORKSPACE_DIR` for others
 */
function diskReference(attachment: MaterializedAttachment): string {
    const rootVariable =
        attachment.attachment.surface === 'store'
            ? '$AGENT_ROOM_STORE_DIR'
            : '$AGENT_ROOM_WORKSPACE_DIR'
    return [
        `root=${attachment.attachment.surface}`,
        `path="${attachment.attachment.relativePath}"`,
        `shellPath="${rootVariable}/${attachment.attachment.relativePath}"`,
    ].join(' ')
}

/**
 * Build a single-line, human-readable summary describing a materialized room attachment.
 *
 * @param attachment - The resolved attachment with computed metadata (`mediaType`, `byteLength`, `sha256`, optional `content` and optional PDF `ingestion`)
 * @param index - Zero-based index of the attachment used for a 1-based label in the summary
 * @returns A textual summary that includes the attachment kind (PDF/Image/File), name, media type, formatted size, sha256, and either PDF ingestion details (mode, pages, degraded reason when present) or whether the file was provided as direct image input or is available as a room-local file
 */
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

/**
 * Prepare a prompt by resolving and serializing room attachments, producing text, model-ready images, and attachment metadata.
 *
 * @param input.config - Runtime configuration used to locate and read room-stored files.
 * @param input.model - Optional model descriptor used to validate whether the model accepts image inputs and to guide PDF ingestion behavior.
 * @param input.message - Original message text that may include room attachment references; used as the prompt base and to generate a human-readable attachment summary when attachments are present.
 * @param input.renderPdfPageImages - Optional override function used to render PDF pages to images for ingestion.
 * @returns A PreparedPrompt containing:
 *  - `text`: the prompt text with an appended attachment summary when attachments exist,
 *  - `images` (optional): flattened model-ready image inputs extracted from attachments,
 *  - `metadata` (optional): original attachment text, the canonicalized room attachments, and any PDF ingestion records collected during materialization.
 */
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

/**
 * Parses a raw value into PromptAttachmentMetadata when it represents valid prompt attachment metadata.
 *
 * @param value - A decoded/unknown value expected to be a record with optional `text` (string), `attachments` (array of room-attachment-like objects), and optional `ingestions` (array of PDF ingestion records).
 * @returns A `PromptAttachmentMetadata` object when `value` contains at least one valid attachment; `null` otherwise.
 */
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

/**
 * Parse and validate a PDF ingestion record from an arbitrary value.
 *
 * Accepts a generic input and, if it conforms to the expected shape, returns a
 * normalized `PdfIngestionRecord` with defaults and strict type checks; otherwise returns `null`.
 *
 * @param value - The unknown value to parse (typically from deserialized session/custom data)
 * @returns A `PdfIngestionRecord` when `value` is a valid record with an `ingestionMode` of
 * `native_document`, `image_render`, or `unsupported`; `null` otherwise. Numeric fields are accepted
 * only when finite (`pageCount`, `inputBlocks`); string fields are coerced to `''` or `null`
 * according to presence; `degraded` is `true` only if the input value is strictly `true`.
 */
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
