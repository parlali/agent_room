import { readFile, readdir, rm, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { getModel, type Api, type ImageContent, type Model } from '@mariozechner/pi-ai'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import { runDocumentWorker } from './document-tools/worker'

export const pdfIngestionModes = ['native_document', 'image_render', 'unsupported'] as const

export type PdfIngestionMode = (typeof pdfIngestionModes)[number]

export interface PdfPageSelection {
    pages: number[]
    label: string
    truncated: boolean
}

export interface PdfReadMaterialization {
    mode: PdfIngestionMode
    content: ImageContent[]
    pageCount: number
    selectedPages: PdfPageSelection
    requestedPages: string | null
    degraded: boolean
    degradedReason: string | null
    backend: 'anthropic_native_document' | 'rendered_page_images' | 'unsupported'
}

export interface PdfIngestionRecord {
    attachmentId: string
    name: string
    relativePath: string
    mediaType: string
    ingestionMode: PdfIngestionMode
    pageCount: number | null
    pages: string | null
    requestedPages: string | null
    inputBlocks: number
    degraded: boolean
    degradedReason: string | null
}

export const anthropicNativePdfMaxBytes = 32 * 1024 * 1024
export const anthropicNativePdfMaxPages = 100
export const defaultPdfRenderMaxPages = 20

/**
 * Determines whether a media type string identifies a PDF.
 *
 * @param mediaType - The media type to test; compared exactly to `'application/pdf'`
 * @returns `true` if `mediaType` is `'application/pdf'`, `false` otherwise.
 */
export function isPdfMediaType(mediaType: string): boolean {
    return mediaType === 'application/pdf'
}

/**
 * Determines whether the runtime (model or configured provider) supports Anthropic's native PDF ingestion.
 *
 * Checks the provided `model` first; if present, returns `true` when that model's provider is `'anthropic'` and its API is `'anthropic-messages'`. If `model` is not provided, inspects `config.provider` and returns `true` when `sourceProvider` is `'anthropic'`, `api` is `'anthropic-messages'`, and `piProvider` is `'anthropic'`.
 *
 * @param config - Runtime configuration used when `model` is not provided
 * @param model - Optional model descriptor; when present this takes precedence over `config`
 * @returns `true` if native Anthropic PDF ingestion is supported, `false` otherwise.
 */
export function isNativePdfProvider(
    config: PiRuntimeConfig,
    model: Model<Api> | undefined,
): boolean {
    if (model) {
        return model.provider === 'anthropic' && model.api === 'anthropic-messages'
    }
    return (
        config.provider.sourceProvider === 'anthropic' &&
        config.provider.api === 'anthropic-messages' &&
        config.provider.piProvider === 'anthropic'
    )
}

/**
 * Determines whether the given model accepts image inputs.
 *
 * @param model - The model to inspect; may be `undefined`.
 * @returns `true` if the model's input types include `'image'`, `false` otherwise.
 */
export function modelAcceptsImages(model: Model<Api> | undefined): boolean {
    return Boolean(model?.input.includes('image'))
}

/**
 * Determines whether the runtime-configured model accepts image inputs.
 *
 * @param config - Runtime configuration used to resolve the built-in model, provider-configured model, and any provider model overrides
 * @returns `true` if the resolved model's input types include `image`, `false` otherwise
 */
export function runtimeModelAcceptsImages(config: PiRuntimeConfig): boolean {
    const builtIn = getModel(config.provider.piProvider as never, config.provider.piModel as never)
    if (builtIn) {
        return builtIn.input.includes('image')
    }

    const provider = config.models.providers[config.provider.piProvider]
    const configured = provider?.models?.find((model) => model.id === config.provider.piModel)
    if (configured?.input) {
        return configured.input.includes('image')
    }

    const override = provider?.modelOverrides?.[config.provider.piModel]
    if (override?.input) {
        return override.input.includes('image')
    }

    return false
}

/**
 * Determines the number of pages in a PDF contained in memory.
 *
 * @param bytes - The PDF file bytes
 * @returns The page count of the PDF
 */
export async function readPdfPageCount(bytes: Buffer): Promise<number> {
    const pdf = await PDFDocument.load(bytes)
    return pdf.getPageCount()
}

/**
 * Produce an ImageContent object that represents the given PDF bytes as a base64-encoded payload.
 *
 * @param bytes - Raw PDF file bytes to encode
 * @returns An ImageContent with `type: 'image'`, `mimeType: 'application/pdf'`, and `data` set to the base64 encoding of `bytes`
 */
export function nativePdfImageContent(bytes: Buffer): ImageContent {
    return {
        type: 'image',
        data: bytes.toString('base64'),
        mimeType: 'application/pdf',
    }
}

/**
 * Convert a user-supplied page specifier into a validated, bounded PdfPageSelection.
 *
 * Parses `pages` (comma-separated integers and ranges like `2` or `3-5`), validates bounds
 * against `pageCount`, enforces `maxPages`, deduplicates and sorts page numbers, and
 * produces a human-readable `label` and `truncated` flag when the full-document selection
 * was limited.
 *
 * @param input.pages - Optional page specification string (e.g. `"1,3-5"`). `null` or empty selects the first pages up to `maxPages`.
 * @param input.pageCount - Total pages in the PDF; must be >= 1.
 * @param input.maxPages - Maximum number of pages allowed in the returned selection.
 * @returns A PdfPageSelection with `pages` (1-based ascending page numbers), a `label` describing the selection, and `truncated` indicating whether the selection was limited.
 * @throws Error when `pageCount < 1`, when the `pages` string contains invalid syntax, empty parts, out-of-range numbers or ranges exceeding `pageCount`, when no pages are selected, or when the selected pages exceed `maxPages`.
 */
export function normalizePdfPageSelection(input: {
    pages?: string | null
    pageCount: number
    maxPages: number
}): PdfPageSelection {
    if (input.pageCount < 1) {
        throw new Error('PDF does not contain any pages')
    }

    const requested = input.pages?.trim()
    if (!requested) {
        const count = Math.min(input.pageCount, input.maxPages)
        const pages = Array.from({ length: count }, (_value, index) => index + 1)
        return {
            pages,
            label: count === input.pageCount ? 'all pages' : `pages 1-${count}`,
            truncated: count < input.pageCount,
        }
    }

    const pages = new Set<number>()
    for (const rawPart of requested.split(',')) {
        const part = rawPart.trim()
        if (!part) {
            throw new Error('PDF pages must not contain empty ranges')
        }
        const range = /^(\d+)(?:-(\d+))?$/.exec(part)
        if (!range) {
            throw new Error(`Invalid PDF page range "${part}"`)
        }
        const start = Number(range[1])
        const end = range[2] ? Number(range[2]) : start
        if (start < 1 || end < 1 || end < start) {
            throw new Error(`Invalid PDF page range "${part}"`)
        }
        if (end > input.pageCount) {
            throw new Error(`PDF page range "${part}" exceeds ${input.pageCount} pages`)
        }
        for (let page = start; page <= end; page += 1) {
            pages.add(page)
        }
    }

    const selected = [...pages].sort((a, b) => a - b)
    if (selected.length === 0) {
        throw new Error('PDF pages must select at least one page')
    }
    if (selected.length > input.maxPages) {
        throw new Error(`PDF read is limited to ${input.maxPages} pages per call`)
    }

    return {
        pages: selected,
        label: `pages ${selected.join(',')}`,
        truncated: false,
    }
}

/**
 * Renders the specified PDF pages to PNG images and returns them as base64-encoded image contents in ascending page order.
 *
 * Renders each page in `selection.pages` using an external document worker, reads the produced PNG files, and returns an array of `ImageContent` entries (mimeType `image/png`) corresponding to the requested pages.
 *
 * @param input.config - Runtime configuration used for temp paths, workspace, and document worker timeouts
 * @param input.path - Filesystem path to the PDF to render
 * @param input.selection - Selected pages (1-based) to render; the function returns images in ascending order of these pages
 * @returns An array of `ImageContent` objects containing base64-encoded PNGs for each requested page, ordered by page number
 * @throws Error If the renderer does not produce an image for every requested page (message: 'PDF page rendering did not produce every requested page')
 */
export async function renderPdfPageImages(input: {
    config: PiRuntimeConfig
    path: string
    selection: PdfPageSelection
    signal?: AbortSignal
}): Promise<ImageContent[]> {
    const tempDir = await mkdtemp(join(input.config.paths.tmpDir, 'pdf-pages-'))
    const prefix = join(tempDir, 'page')
    try {
        for (const page of input.selection.pages) {
            await runDocumentWorker({
                config: input.config,
                command: 'pdftoppm',
                args: ['-png', '-f', String(page), '-l', String(page), input.path, prefix],
                cwd: input.config.paths.workspaceDir,
                timeoutMs: input.config.budgets.documentWorkerMs,
                signal: input.signal,
            })
        }
        const selected = new Set(input.selection.pages)
        const entries = await readdir(tempDir)
        const paths = entries
            .map((entry) => {
                const match = /^page-(\d+)\.png$/.exec(entry)
                return match
                    ? {
                          page: Number(match[1]),
                          path: join(tempDir, entry),
                      }
                    : null
            })
            .filter((entry): entry is { page: number; path: string } => entry !== null)
            .filter((entry) => selected.has(entry.page))
            .sort((a, b) => a.page - b.page)

        if (paths.length !== input.selection.pages.length) {
            throw new Error('PDF page rendering did not produce every requested page')
        }

        return await Promise.all(
            paths.map(async (entry) => ({
                type: 'image' as const,
                data: (await readFile(entry.path)).toString('base64'),
                mimeType: 'image/png',
            })),
        )
    } finally {
        await rm(tempDir, {
            recursive: true,
            force: true,
        })
    }
}

/**
 * Determine the best PDF ingestion strategy and produce the materialized content payload and metadata.
 *
 * @param input - Input parameters controlling materialization
 * @param input.config - Runtime configuration used to determine provider/model capabilities and temp/workspace paths
 * @param input.path - Filesystem path to the PDF to read (used when `bytes` is not provided)
 * @param input.pages - Optional page selection string (e.g., "1,3-5"); when omitted, a default selection is used
 * @param input.bytes - Optional preloaded PDF bytes to use instead of reading from `path`
 * @param input.model - Optional model descriptor used to decide native vs. image rendering eligibility
 * @param input.signal - Optional AbortSignal to cancel rendering operations
 * @param input.renderImages - Optional custom page-rendering function (defaults to `renderPdfPageImages`)
 * @returns A `PdfReadMaterialization` describing the chosen ingestion mode (`native_document`, `image_render`, or `unsupported`), the produced content (native PDF payload or rendered PNG images), page counts and selection labels, degradation status and reason, and the backend identifier.
 */
export async function materializePdfRead(input: {
    config: PiRuntimeConfig
    path: string
    pages?: string | null
    bytes?: Buffer
    model?: Model<Api>
    signal?: AbortSignal
    renderImages?: typeof renderPdfPageImages
}): Promise<PdfReadMaterialization> {
    const bytes = input.bytes ?? (await readFile(input.path))
    const pageCount = await readPdfPageCount(bytes)
    const nativeProvider = isNativePdfProvider(input.config, input.model)
    const nativeEligible =
        nativeProvider &&
        bytes.byteLength <= anthropicNativePdfMaxBytes &&
        pageCount <= anthropicNativePdfMaxPages
    const degradedReason = nativeProvider
        ? bytes.byteLength > anthropicNativePdfMaxBytes
            ? `PDF exceeds Anthropic native document request size limit of ${anthropicNativePdfMaxBytes} bytes`
            : pageCount > anthropicNativePdfMaxPages
              ? `PDF exceeds Anthropic native document page limit of ${anthropicNativePdfMaxPages}`
              : null
        : null

    if (nativeEligible) {
        const requestedSelection = input.pages
            ? normalizePdfPageSelection({
                  pages: input.pages,
                  pageCount,
                  maxPages: anthropicNativePdfMaxPages,
              })
            : null
        return {
            mode: 'native_document',
            content: [nativePdfImageContent(bytes)],
            pageCount,
            selectedPages: normalizePdfPageSelection({
                pages: null,
                pageCount,
                maxPages: anthropicNativePdfMaxPages,
            }),
            requestedPages: requestedSelection?.label ?? null,
            degraded: Boolean(requestedSelection),
            degradedReason: requestedSelection
                ? `Native PDF document input sends the full PDF; requested ${requestedSelection.label} was not used to crop the bytes sent to the model.`
                : null,
            backend: 'anthropic_native_document',
        }
    }

    const imageCapable = input.model
        ? modelAcceptsImages(input.model)
        : runtimeModelAcceptsImages(input.config)
    if (!imageCapable) {
        const selectedPages = normalizePdfPageSelection({
            pages: input.pages,
            pageCount,
            maxPages: defaultPdfRenderMaxPages,
        })
        return {
            mode: 'unsupported',
            content: [],
            pageCount,
            selectedPages,
            requestedPages: input.pages ? selectedPages.label : null,
            degraded: true,
            degradedReason:
                degradedReason ??
                'PDF reading requires Anthropic native PDF input or a vision-capable model for rendered pages.',
            backend: 'unsupported',
        }
    }

    const selectedPages = normalizePdfPageSelection({
        pages: input.pages,
        pageCount,
        maxPages: defaultPdfRenderMaxPages,
    })
    const renderImages = input.renderImages ?? renderPdfPageImages
    let content: ImageContent[]
    try {
        content = await renderImages({
            config: input.config,
            path: input.path,
            selection: selectedPages,
            signal: input.signal,
        })
    } catch (error) {
        return {
            mode: 'unsupported',
            content: [],
            pageCount,
            selectedPages,
            requestedPages: input.pages ? selectedPages.label : null,
            degraded: true,
            degradedReason: `PDF page rendering failed: ${error instanceof Error ? error.message : String(error)}`,
            backend: 'unsupported',
        }
    }

    return {
        mode: 'image_render',
        content,
        pageCount,
        selectedPages,
        requestedPages: input.pages ? selectedPages.label : null,
        degraded: Boolean(degradedReason || selectedPages.truncated),
        degradedReason:
            degradedReason ??
            (selectedPages.truncated
                ? `Rendered the first ${selectedPages.pages.length} pages; request specific pages to inspect more.`
                : null),
        backend: 'rendered_page_images',
    }
}
