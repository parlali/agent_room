import { readFile } from 'node:fs/promises'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { sha256Buffer } from './artifacts'
import { writeWorkspaceFile } from './paths'

export async function createPdf(
    path: string,
    title: string | undefined,
    paragraphs: string[],
): Promise<void> {
    const pdf = await PDFDocument.create()
    const regularFont = await pdf.embedFont(StandardFonts.Helvetica)
    const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold)
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
    await writeWorkspaceFile(path, Buffer.from(await pdf.save()))
}

export async function inspectPdf(path: string): Promise<string> {
    const buffer = await readFile(path)
    return `PDF file\nPath: ${path}\nBytes: ${buffer.byteLength}\nSHA-256: ${sha256Buffer(buffer)}`
}
