import { readFile } from 'node:fs/promises'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { PDFFont } from 'pdf-lib'
import type { PiRuntimeConfig } from '../../rooms/pi-runtime-config'
import { loadPdfDocument } from '../pdf-ingestion'
import { sha256Buffer } from './artifacts'
import { writeWorkspaceFile } from './paths'

type PdfEdit =
    | {
          type: 'append_text_page'
          title?: string
          paragraphs?: string[]
      }
    | {
          type: 'stamp_text'
          text: string
          page?: number
          x?: number
          y?: number
          size?: number
      }
    | {
          type: 'delete_pages'
          pages: number[]
      }

export async function createPdf(
    config: PiRuntimeConfig,
    path: string,
    title: string | undefined,
    paragraphs: string[],
): Promise<void> {
    const pdf = await PDFDocument.create()
    const regularFont = await pdf.embedFont(StandardFonts.Helvetica)
    const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold)
    drawTextPage(pdf, regularFont, boldFont, title, paragraphs)
    await writeWorkspaceFile(config, path, Buffer.from(await pdf.save()))
}

export async function editPdf(
    config: PiRuntimeConfig,
    path: string,
    edits: PdfEdit[],
): Promise<number> {
    const buffer = await readFile(path)
    const pdf = await loadPdfDocument(buffer)
    const regularFont = await pdf.embedFont(StandardFonts.Helvetica)
    const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold)
    let count = 0
    for (const edit of edits) {
        if (edit.type === 'append_text_page') {
            drawTextPage(pdf, regularFont, boldFont, edit.title, edit.paragraphs ?? [])
            count += 1
        } else if (edit.type === 'stamp_text') {
            const page = pdf.getPage(clampInteger(edit.page, 1, pdf.getPageCount()) - 1)
            page.drawText(edit.text, {
                x: edit.x ?? 54,
                y: edit.y ?? 54,
                size: edit.size ?? 10,
                font: regularFont,
                color: rgb(0.12, 0.16, 0.22),
            })
            count += 1
        } else if (edit.type === 'delete_pages') {
            const pages = [...new Set(edit.pages)].sort((a, b) => b - a)
            for (const page of pages) {
                if (page > pdf.getPageCount()) {
                    throw new Error(`PDF edit delete_pages page ${page} exceeds page count`)
                }
                if (pdf.getPageCount() <= 1) {
                    throw new Error('PDF edit cannot delete every page')
                }
                pdf.removePage(page - 1)
                count += 1
            }
        }
    }
    await writeWorkspaceFile(config, path, Buffer.from(await pdf.save()))
    return count
}

export function normalizePdfEdits(value: unknown): PdfEdit[] {
    const parsed = parseJsonArray(value)
    return parsed.map((edit, index): PdfEdit => {
        if (!edit || typeof edit !== 'object') {
            throw new Error(`PDF edit ${index + 1} must be an object`)
        }
        const record = edit as Record<string, unknown>
        if (record.type === 'append_text_page') {
            return {
                type: 'append_text_page',
                title: typeof record.title === 'string' ? record.title : undefined,
                paragraphs: Array.isArray(record.paragraphs)
                    ? record.paragraphs.map((paragraph) => String(paragraph))
                    : [],
            }
        }
        if (record.type === 'stamp_text') {
            if (typeof record.text !== 'string' || !record.text.trim()) {
                throw new Error(`PDF edit ${index + 1} stamp_text requires text`)
            }
            return {
                type: 'stamp_text',
                text: record.text,
                page: optionalNumber(record.page),
                x: optionalNumber(record.x),
                y: optionalNumber(record.y),
                size: optionalNumber(record.size),
            }
        }
        if (record.type === 'delete_pages') {
            if (!Array.isArray(record.pages) || record.pages.length === 0) {
                throw new Error(`PDF edit ${index + 1} delete_pages requires pages`)
            }
            const pages = record.pages.map((page, pageIndex) => {
                if (
                    typeof page !== 'number' ||
                    !Number.isInteger(page) ||
                    page < 1 ||
                    page > 10000
                ) {
                    throw new Error(
                        `PDF edit ${index + 1} delete_pages page ${pageIndex + 1} must be an integer from 1 to 10000`,
                    )
                }
                return page
            })
            return {
                type: 'delete_pages',
                pages,
            }
        }
        throw new Error(`Unsupported PDF edit type ${String(record.type)}`)
    })
}

export async function inspectPdf(path: string): Promise<string> {
    const buffer = await readFile(path)
    return pdfMetadata(path, buffer)
}

function pdfMetadata(path: string, buffer: Buffer): string {
    return `PDF file\nPath: ${path}\nBytes: ${buffer.byteLength}\nSHA-256: ${sha256Buffer(buffer)}`
}

function drawTextPage(
    pdf: PDFDocument,
    regularFont: PDFFont,
    boldFont: PDFFont,
    title: string | undefined,
    paragraphs: string[],
): void {
    let page = pdf.addPage([612, 792])
    let y = 740
    if (title?.trim()) {
        page.drawText(title.trim(), {
            x: 54,
            y,
            size: 20,
            font: boldFont,
            color: rgb(0.08, 0.1, 0.14),
        })
        y -= 42
    }
    for (const paragraph of paragraphs) {
        const words = paragraph.split(/\s+/)
        let line = ''
        for (const word of words) {
            const candidate = line ? `${line} ${word}` : word
            if (regularFont.widthOfTextAtSize(candidate, 11) > 500) {
                page.drawText(line, {
                    x: 54,
                    y,
                    size: 11,
                    font: regularFont,
                    color: rgb(0.12, 0.16, 0.22),
                })
                y -= 16
                line = word
            } else {
                line = candidate
            }
            if (y < 60) {
                page = pdf.addPage([612, 792])
                y = 740
            }
        }
        if (line) {
            page.drawText(line, {
                x: 54,
                y,
                size: 11,
                font: regularFont,
                color: rgb(0.12, 0.16, 0.22),
            })
            y -= 24
        }
    }
}

function clampInteger(value: number | undefined, fallback: number, max: number): number {
    if (value === undefined || !Number.isFinite(value)) return fallback
    return Math.max(1, Math.min(max, Math.floor(value)))
}

function optionalNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function parseJsonArray(value: unknown): unknown[] {
    if (Array.isArray(value)) {
        if (value.length === 0) {
            throw new Error('PDF edits must contain at least one edit')
        }
        return value
    }
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error('Missing or empty PDF edits JSON')
    }
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) {
        throw new Error('PDF edits must be a JSON array')
    }
    if (parsed.length === 0) {
        throw new Error('PDF edits must contain at least one edit')
    }
    return parsed
}
