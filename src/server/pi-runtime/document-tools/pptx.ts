import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import pptxgen from 'pptxgenjs'
import { ensureShellWritableDirectory, ensureShellWritableFile } from '../shell-sandbox'
import type { DocumentToolContext, Replacement, SlideInput } from './types'
import { existingWorkspacePath, writeWorkspaceFile } from './paths'
import { boundExtractedText, extractXmlText, parseJson, replaceZipText } from './xml'

export function normalizeSlides(value: unknown): SlideInput[] {
    const parsed = parseJson<unknown>(value, [])
    if (!Array.isArray(parsed)) {
        throw new Error('Slides JSON must be an array')
    }
    return parsed.map((entry, index) => {
        if (!entry || typeof entry !== 'object') {
            throw new Error('Each slide must be an object')
        }
        const record = entry as Record<string, unknown>
        const chart =
            record.chart && typeof record.chart === 'object'
                ? (record.chart as SlideInput['chart'])
                : undefined
        return {
            title:
                typeof record.title === 'string' && record.title.trim()
                    ? record.title
                    : `Slide ${index + 1}`,
            bullets: Array.isArray(record.bullets)
                ? record.bullets.filter((item): item is string => typeof item === 'string')
                : [],
            notes: typeof record.notes === 'string' ? record.notes : undefined,
            imagePath: typeof record.imagePath === 'string' ? record.imagePath : undefined,
            chart,
        }
    })
}

export async function createPptx(
    ctx: DocumentToolContext,
    path: string,
    slides: SlideInput[],
): Promise<void> {
    const pptx = new pptxgen()
    pptx.layout = 'LAYOUT_WIDE'
    pptx.author = 'Agent Room'
    for (const slideInput of slides.length > 0 ? slides : [{ title: 'Untitled' }]) {
        const slide = pptx.addSlide()
        slide.background = { color: 'FFFFFF' }
        slide.addText(slideInput.title, {
            x: 0.55,
            y: 0.35,
            w: 12.2,
            h: 0.6,
            fontFace: 'Aptos Display',
            fontSize: 28,
            bold: true,
            color: '111827',
            margin: 0.05,
        })
        if (slideInput.bullets && slideInput.bullets.length > 0) {
            slide.addText(slideInput.bullets.map((item) => `- ${item}`).join('\n'), {
                x: 0.75,
                y: 1.2,
                w: 6.2,
                h: 4.8,
                fontFace: 'Aptos',
                fontSize: 18,
                color: '1f2937',
                breakLine: false,
                fit: 'shrink',
            })
        }
        if (slideInput.chart && slideInput.chart.labels.length > 0) {
            const chartType =
                slideInput.chart.type === 'line'
                    ? pptx.ChartType.line
                    : slideInput.chart.type === 'pie'
                      ? pptx.ChartType.pie
                      : pptx.ChartType.bar
            slide.addChart(
                chartType,
                [
                    {
                        name: slideInput.chart.name ?? 'Series',
                        labels: slideInput.chart.labels,
                        values: slideInput.chart.values,
                    },
                ],
                {
                    x: 7.1,
                    y: 1.2,
                    w: 5.5,
                    h: 3.9,
                    showLegend: false,
                    showValue: true,
                },
            )
        }
        if (slideInput.imagePath) {
            const imagePath = await existingWorkspacePath(ctx.config, slideInput.imagePath)
            slide.addImage({
                path: imagePath,
                x: 7.1,
                y: 1.2,
                w: 5.5,
                h: 3.9,
                sizing: {
                    type: 'cover',
                    w: 5.5,
                    h: 3.9,
                },
            })
        }
        if (slideInput.notes) {
            slide.addNotes(slideInput.notes)
        }
    }
    await ensureShellWritableDirectory(dirname(path))
    await pptx.writeFile({
        fileName: path,
    })
    await ensureShellWritableFile(path)
}

export async function inspectPptx(path: string): Promise<string> {
    const zip = unzipSync(new Uint8Array(await readFile(path)))
    const parts = Object.entries(zip)
        .filter(([entryPath]) => /^ppt\/slides\/slide\d+\.xml$/.test(entryPath))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([entryPath, content]) => `${entryPath}\n${extractXmlText(strFromU8(content))}`)
    return boundExtractedText(parts.join('\n\n'))
}

export async function editPptx(path: string, replacements: Replacement[]): Promise<number> {
    const updated = replaceZipText({
        buffer: await readFile(path),
        paths: (entryPath) => /^ppt\/slides\/slide\d+\.xml$/.test(entryPath),
        replacements,
    })
    await writeWorkspaceFile(path, updated.buffer)
    return updated.replacementCount
}
