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

/**
 * Coerce an arbitrary value into a normalized DocxContent structure.
 *
 * The input may be any value; when it is an object, this function extracts
 * `title`, `paragraphs`, and `tables` and converts them to the expected types.
 *
 * @param value - The input to normalize; may be any value or an object containing `title`, `paragraphs`, and/or `tables`.
 * @returns A `DocxContent` where:
 *  - `title` is the trimmed string from `value.title` or `''` if missing or not a string;
 *  - `paragraphs` is an array of strings (each item coerced via `String`) or an empty array;
 *  - `tables` is an array of tables, where each table is an array of rows, each row is an array of cell strings; non-array rows become single-cell rows, non-array tables become empty tables, and all cell values are coerced to strings.
 */
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

/**
 * Escape XML special characters in a string.
 *
 * @param value - Input text to escape for inclusion in XML
 * @returns The input string with XML-special characters replaced: `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`, `"` → `&quot;`
 */
function escapeXml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
}

/**
 * Create a WordprocessingML paragraph (`<w:p>`) containing the given text and optional paragraph style.
 *
 * The returned XML preserves whitespace in the text and escapes XML special characters.
 *
 * @param text - The paragraph text
 * @param style - Optional paragraph style name to include as a `w:pStyle` value
 * @returns An XML string representing a `<w:p>` element with the text (and `w:pStyle` when `style` is provided)
 */
function paragraphXml(text: string, style?: string): string {
    const styleXml = style ? `<w:pPr><w:pStyle w:val="${escapeXml(style)}"/></w:pPr>` : ''
    return `<w:p>${styleXml}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
}

/**
 * Builds a WordprocessingML table XML fragment from rows of cell text.
 *
 * @param rows - Array of table rows; each row is an array of cell text values
 * @returns A string containing the `<w:tbl>` XML for the provided rows and cells
 */
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

/**
 * Build the XML for the Word document body (word/document.xml) from structured content.
 *
 * @param content - The document content: `title`, `paragraphs`, and `tables`
 * @returns A complete `word/document.xml` XML string containing the document body and section properties
 */
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

/**
 * Produce the minimal WordprocessingML styles XML used in generated DOCX files.
 *
 * @returns A string containing the contents of word/styles.xml that defines the `Normal` and `Title` paragraph styles in the WordprocessingML namespace.
 */
function createStylesXml(): string {
    return [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        `<w:styles xmlns:w="${documentNamespace}">`,
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>',
        '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>',
        '</w:styles>',
    ].join('')
}

/**
 * Create a minimal DOCX file at the given filesystem path from structured `DocxContent`.
 *
 * Writes the required OpenXML package parts (document, styles, relationships and basic metadata)
 * into a ZIP archive and saves it to `path`.
 *
 * @param path - Filesystem path where the resulting .docx archive will be written
 * @param content - Document content (title, paragraphs, tables) used to generate `word/document.xml`
 */
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

/**
 * Identify WordprocessingML "story" part file names inside a DOCX ZIP.
 *
 * @param zip - The JSZip archive representing the DOCX package
 * @returns The matching part paths (e.g. `word/document.xml`, `word/header1.xml`)
 */
function docxStoryPartNames(zip: JSZip): string[] {
    return zipFileNames(zip).filter((name) =>
        /^word\/(document|header\d+|footer\d+|footnotes|endnotes|comments.*)\.xml$/.test(name),
    )
}

/**
 * Extracts text content, paragraph metadata, and table cell data from a DOCX file.
 *
 * @param path - Filesystem path to the DOCX file to inspect
 * @returns An object containing:
 *  - `text`: all extracted paragraph lines joined with `\n` (each line formatted as `"{part}#p{index}{ optional style }: {text}"`)
 *  - `paragraphs`: an array of `ParagraphInspection` entries with `part`, 1-based `index`, `style` (or `null`), and `text`
 *  - `tables`: an array of `TableInspection` entries with `part`, 1-based `index`, and `rows` (2D array of cell text)
 *  - `partsScanned`: the list of DOCX story part names that were scanned (e.g., `word/document.xml`, headers/footers, footnotes)
 */
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

/**
 * Apply a set of text replacements to all Word "story" parts inside a DOCX file and save the updated archive.
 *
 * @param path - Filesystem path to the DOCX file to edit
 * @param replacementsJson - JSON string describing replacements (normalized by `normalizeReplacements`)
 * @returns The total number of individual replacements performed
 * @throws If no replacement text is found and applied
 */
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

/**
 * Parse CLI arguments and execute the requested DOCX operation (`create`, `inspect`, or `edit`), emitting a JSON result.
 *
 * Performs workspace and path resolution as required, creates or updates DOCX files for `create`/`edit`, or inspects existing DOCX for `inspect`, and prints a JSON summary to stdout.
 *
 * @throws If the operation is not `create`, `inspect`, or `edit`. 
 */
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
