import { readFile } from 'node:fs/promises'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { PDFFont } from 'pdf-lib'
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

/**
 * Create a PDF file at the given workspace path containing an optional title and the provided paragraphs.
 *
 * The generated PDF is written to `path`.
 *
 * @param path - Destination workspace path where the PDF will be written
 * @param title - Optional title to render at the top of the first page; ignored if undefined or empty
 * @param paragraphs - Paragraph strings to render as flowing text across one or more pages
 */
export async function createPdf(
    path: string,
    title: string | undefined,
    paragraphs: string[],
): Promise<void> {
    const pdf = await PDFDocument.create()
    const regularFont = await pdf.embedFont(StandardFonts.Helvetica)
    const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold)
    drawTextPage(pdf, regularFont, boldFont, title, paragraphs)
    await writeWorkspaceFile(path, Buffer.from(await pdf.save()))
}

/**
 * Applies a sequence of PDF edits to the document at the given workspace path.
 *
 * @param path - Workspace path to the PDF file to modify
 * @param edits - Array of `PdfEdit` records describing mutations to apply
 * @returns The number of individual edit actions that were applied
 * @throws Error - If a delete-pages edit would remove the last remaining page (attempting to delete every page)
 */
export async function editPdf(path: string, edits: PdfEdit[]): Promise<number> {
    const buffer = await readFile(path)
    const pdf = await PDFDocument.load(buffer)
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
            const pages = [
                ...new Set(edit.pages.map((page) => clampInteger(page, 1, pdf.getPageCount()))),
            ].sort((a, b) => b - a)
            for (const page of pages) {
                if (pdf.getPageCount() <= 1) {
                    throw new Error('PDF edit cannot delete every page')
                }
                pdf.removePage(page - 1)
                count += 1
            }
        }
    }
    await writeWorkspaceFile(path, Buffer.from(await pdf.save()))
    return count
}

/**
 * Convert an unknown value (an array or a JSON array string) into a validated array of PdfEdit records.
 *
 * @param value - The input to parse; may be an array or a JSON string representing an array of edit objects.
 * @returns An array of validated `PdfEdit` entries.
 * @throws Error if an element is not an object, a required field is missing or invalid for its edit `type`, or an unsupported edit `type` is encountered.
 */
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
            return {
                type: 'delete_pages',
                pages: record.pages.map((page) => clampInteger(optionalNumber(page), 1, 10000)),
            }
        }
        throw new Error(`Unsupported PDF edit type ${String(record.type)}`)
    })
}

/**
 * Produce a short metadata summary for the PDF at the given workspace path.
 *
 * @param path - Workspace file path to the PDF
 * @returns A string containing file type, path, byte length, and SHA-256 digest for the PDF
 */
export async function inspectPdf(path: string): Promise<string> {
    const buffer = await readFile(path)
    return pdfMetadata(path, buffer)
}

/**
 * Produce a concise metadata summary for a PDF buffer including path, size, and checksum.
 *
 * @param path - The file path associated with the PDF
 * @param buffer - The PDF file contents
 * @returns A string containing "PDF file", the `Path`, `Bytes` (buffer length), and `SHA-256` hash
 */
function pdfMetadata(path: string, buffer: Buffer): string {
    return `PDF file\nPath: ${path}\nBytes: ${buffer.byteLength}\nSHA-256: ${sha256Buffer(buffer)}`
}

/**
 * Adds one or more pages to `pdf` containing an optional title and the provided paragraphs.
 *
 * Paragraphs are word-wrapped to fit the page width and flowed across additional pages when needed.
 *
 * @param title - Optional page title; trimmed before rendering and omitted if empty
 * @param paragraphs - Array of paragraph strings to render beneath the title; each paragraph is wrapped into lines and laid out with automatic page breaks
 */
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

/**
 * Clamp a numeric input to an integer within the range [1, max], using `fallback` when the input is undefined or not finite.
 *
 * @param value - The input number to clamp; may be undefined.
 * @param fallback - The value to return when `value` is undefined or not a finite number.
 * @param max - The maximum allowed result (inclusive).
 * @returns The input floored and clamped to the range [1, max], or `fallback` if the input was invalid.
 */
function clampInteger(value: number | undefined, fallback: number, max: number): number {
    if (value === undefined || !Number.isFinite(value)) return fallback
    return Math.max(1, Math.min(max, Math.floor(value)))
}

/**
 * Coerces a value to a number only if it is a finite number; otherwise returns `undefined`.
 *
 * @param value - The value to check.
 * @returns `value` if it is a finite number, `undefined` otherwise.
 */
function optionalNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Interpret a value as an array, accepting either an array or a JSON-encoded array string.
 *
 * @param value - The value to interpret: if already an array it is returned as-is; if a non-empty string it is parsed as JSON and must be an array.
 * @returns The resulting array, or an empty array when `value` is not an array and not a non-empty JSON string.
 * @throws Error if `value` is a non-empty string that parses to a non-array value.
 */
function parseJsonArray(value: unknown): unknown[] {
    if (Array.isArray(value)) return value
    if (typeof value !== 'string' || !value.trim()) return []
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) {
        throw new Error('PDF edits must be a JSON array')
    }
    return parsed
}
