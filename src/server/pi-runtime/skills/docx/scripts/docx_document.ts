import JSZip from 'jszip'
import {
    attributeByLocalName,
    elementsByLocalName,
    ensureParent,
    fail,
    firstElementByLocalName,
    isRecord,
    loadZip,
    normalizeReplacements,
    optionalOption,
    parseCommand,
    parseJson,
    parseXml,
    printError,
    printJson,
    replaceAcrossTextElements,
    requiredOption,
    requireWorkspace,
    resolveRoomPath,
    saveZip,
    serializeXml,
    textFromTextElements,
    writeZipText,
    zipFileNames,
} from '../../.shared/office.ts'

interface DocxContent {
    title: string
    paragraphs: string[]
    tables: string[][][]
}

interface ParagraphInspection {
    part: string
    index: number
    style: string | null
    text: string
}

interface TableInspection {
    part: string
    index: number
    rows: string[][]
}

const documentNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

function normalizeContent(value: unknown): DocxContent {
    const record = isRecord(value) ? value : {}
    const paragraphs = Array.isArray(record.paragraphs)
        ? record.paragraphs.map((paragraph) => String(paragraph))
        : []
    const tables = Array.isArray(record.tables)
        ? record.tables.map((table) => {
              if (!Array.isArray(table)) {
                  return []
              }
              return table.map((row) => {
                  if (!Array.isArray(row)) {
                      return [String(row)]
                  }
                  return row.map((cell) => String(cell))
              })
          })
        : []
    return {
        title: typeof record.title === 'string' ? record.title.trim() : '',
        paragraphs,
        tables,
    }
}

function escapeXml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
}

function paragraphXml(text: string, style?: string): string {
    const styleXml = style ? `<w:pPr><w:pStyle w:val="${escapeXml(style)}"/></w:pPr>` : ''
    return `<w:p>${styleXml}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
}

function tableXml(rows: string[][]): string {
    const rowXml = rows
        .map((row) => {
            const cells = row
                .map(
                    (cell) =>
                        `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>${paragraphXml(
                            cell,
                        )}</w:tc>`,
                )
                .join('')
            return `<w:tr>${cells}</w:tr>`
        })
        .join('')
    return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>${rowXml}</w:tbl>`
}

function createDocumentXml(content: DocxContent): string {
    const body: string[] = []
    if (content.title) {
        body.push(paragraphXml(content.title, 'Title'))
    }
    for (const paragraph of content.paragraphs) {
        body.push(paragraphXml(paragraph))
    }
    for (const table of content.tables) {
        body.push(tableXml(table))
    }
    return [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        `<w:document xmlns:w="${documentNamespace}">`,
        `<w:body>${body.join('')}<w:sectPr/></w:body>`,
        '</w:document>',
    ].join('')
}

function createStylesXml(): string {
    return [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        `<w:styles xmlns:w="${documentNamespace}">`,
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>',
        '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>',
        '</w:styles>',
    ].join('')
}

async function createDocx(path: string, content: DocxContent): Promise<void> {
    const zip = new JSZip()
    writeZipText(
        zip,
        '[Content_Types].xml',
        [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
            '<Default Extension="xml" ContentType="application/xml"/>',
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
            '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
            '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
            '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
            '</Types>',
        ].join(''),
    )
    writeZipText(
        zip,
        '_rels/.rels',
        [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
            '</Relationships>',
        ].join(''),
    )
    writeZipText(
        zip,
        'word/_rels/document.xml.rels',
        [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
            '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
            '</Relationships>',
        ].join(''),
    )
    writeZipText(zip, 'word/document.xml', createDocumentXml(content))
    writeZipText(zip, 'word/styles.xml', createStylesXml())
    writeZipText(
        zip,
        'docProps/core.xml',
        '<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"/>',
    )
    writeZipText(
        zip,
        'docProps/app.xml',
        '<?xml version="1.0" encoding="UTF-8"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"/>',
    )
    await saveZip(zip, path)
}

function docxStoryPartNames(zip: JSZip): string[] {
    return zipFileNames(zip).filter((name) =>
        /^word\/(document|header\d+|footer\d+|footnotes|endnotes|comments.*)\.xml$/.test(name),
    )
}

async function inspectDocx(path: string): Promise<Record<string, unknown>> {
    const zip = await loadZip(path)
    const paragraphs: ParagraphInspection[] = []
    const tables: TableInspection[] = []
    for (const part of docxStoryPartNames(zip)) {
        const file = zip.file(part)
        if (!file) {
            continue
        }
        const document = parseXml(await file.async('text'))
        const partParagraphs = elementsByLocalName(document, 'p')
        partParagraphs.forEach((paragraph, index) => {
            const text = textFromTextElements(paragraph, 't')
            if (!text) {
                return
            }
            const style = firstElementByLocalName(paragraph, 'pStyle')
            paragraphs.push({
                part,
                index: index + 1,
                style: style ? attributeByLocalName(style, 'val') : null,
                text,
            })
        })
        elementsByLocalName(document, 'tbl').forEach((table, index) => {
            const rows = elementsByLocalName(table, 'tr').map((row) =>
                elementsByLocalName(row, 'tc').map((cell) => textFromTextElements(cell, 't')),
            )
            tables.push({
                part,
                index: index + 1,
                rows,
            })
        })
    }
    const lines = paragraphs.map((paragraph) => {
        const style = paragraph.style ? ` style=${paragraph.style}` : ''
        return `${paragraph.part}#p${paragraph.index}${style}: ${paragraph.text}`
    })
    return {
        text: lines.join('\n'),
        paragraphs,
        tables,
        partsScanned: docxStoryPartNames(zip),
    }
}

async function editDocx(path: string, replacementsJson: string | undefined): Promise<number> {
    const replacements = normalizeReplacements(replacementsJson)
    const zip = await loadZip(path)
    let replacementCount = 0
    for (const part of docxStoryPartNames(zip)) {
        const file = zip.file(part)
        if (!file) {
            continue
        }
        const document = parseXml(await file.async('text'))
        let partReplacementCount = 0
        for (const paragraph of elementsByLocalName(document, 'p')) {
            partReplacementCount += replaceAcrossTextElements(paragraph, 't', replacements)
        }
        if (partReplacementCount > 0) {
            replacementCount += partReplacementCount
            writeZipText(zip, part, serializeXml(document))
        }
    }
    if (replacementCount === 0) {
        fail('No replacement text was found')
    }
    await saveZip(zip, path)
    return replacementCount
}

async function main(): Promise<void> {
    const command = parseCommand(process.argv.slice(2))
    const root = optionalOption(command.options, 'root', 'workspace')
    if (command.operation === 'create') {
        requireWorkspace(root, command.operation)
        const path = await resolveRoomPath({
            root,
            path: requiredOption(command.options, 'path'),
            mustExist: false,
        })
        await ensureParent(path)
        await createDocx(path, normalizeContent(parseJson(command.options.get('content-json'), {})))
        printJson({
            operation: command.operation,
            format: 'docx',
            root,
            path: requiredOption(command.options, 'path'),
        })
        return
    }
    const path = await resolveRoomPath({
        root,
        path: requiredOption(command.options, 'path'),
        mustExist: true,
    })
    if (command.operation === 'inspect') {
        printJson({
            operation: command.operation,
            format: 'docx',
            root,
            path: requiredOption(command.options, 'path'),
            ...(await inspectDocx(path)),
        })
        return
    }
    if (command.operation === 'edit') {
        requireWorkspace(root, command.operation)
        printJson({
            operation: command.operation,
            format: 'docx',
            root,
            path: requiredOption(command.options, 'path'),
            replacementCount: await editDocx(path, command.options.get('replacements-json')),
        })
        return
    }
    fail('Operation must be create, inspect, or edit')
}

main().catch(printError)
