import { readFile } from 'node:fs/promises'
import { Document, Packer, Paragraph, TextRun } from 'docx'
import { strFromU8, unzipSync } from 'fflate'
import type { Replacement } from './types'
import { boundExtractedText, extractXmlText, replaceZipText } from './xml'
import { writeWorkspaceFile } from './paths'

export async function createDocx(
    path: string,
    title: string | undefined,
    paragraphs: string[],
): Promise<void> {
    const children: Paragraph[] = []
    if (title?.trim()) {
        children.push(
            new Paragraph({
                children: [
                    new TextRun({
                        text: title.trim(),
                        bold: true,
                        size: 32,
                    }),
                ],
            }),
        )
    }
    for (const paragraph of paragraphs) {
        children.push(
            new Paragraph({
                text: paragraph,
            }),
        )
    }
    const document = new Document({
        sections: [
            {
                children,
            },
        ],
    })
    await writeWorkspaceFile(path, await Packer.toBuffer(document))
}

export async function inspectDocx(path: string): Promise<string> {
    const zip = unzipSync(new Uint8Array(await readFile(path)))
    const xml = zip['word/document.xml']
    if (!xml) {
        throw new Error('DOCX document.xml was not found')
    }
    return boundExtractedText(extractXmlText(strFromU8(xml)))
}

export async function editDocx(path: string, replacements: Replacement[]): Promise<number> {
    const updated = replaceZipText({
        buffer: await readFile(path),
        paths: (entryPath) => entryPath === 'word/document.xml',
        replacements,
    })
    await writeWorkspaceFile(path, updated.buffer)
    return updated.replacementCount
}
