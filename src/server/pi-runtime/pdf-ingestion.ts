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

export function isPdfMediaType(mediaType: string): boolean {
    return mediaType === 'application/pdf'
}

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

export function modelAcceptsImages(model: Model<Api> | undefined): boolean {
    return Boolean(model?.input.includes('image'))
}

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

export async function readPdfPageCount(bytes: Buffer): Promise<number> {
    const pdf = await PDFDocument.load(bytes)
    return pdf.getPageCount()
}

export function nativePdfImageContent(bytes: Buffer): ImageContent {
    return {
        type: 'image',
        data: bytes.toString('base64'),
        mimeType: 'application/pdf',
    }
}

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
