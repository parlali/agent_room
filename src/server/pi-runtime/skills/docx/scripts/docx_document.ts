import JSZip from 'jszip'
import {
    attributeByLocalName,
    countOccurrences,
    directElementsByLocalName,
    elementsByLocalName,
    ensureParent,
    fail,
    firstElementByLocalName,
    isRecord,
    loadZip,
    optionalAnyOption,
    optionalOption,
    parseCommand,
    parseJsonInput,
    parseXml,
    printError,
    printJson,
    readZipText,
    replaceAcrossTextElements,
    renderOfficeDocument,
    requiredOption,
    requireWorkspace,
    resolveRoomPath,
    saveZip,
    serializeXml,
    textFromTextElements,
    truthyOption,
    validateOfficePackage,
    writeZipText,
    zipFileNames,
} from '../../.shared/office.ts'

type ParagraphStyle =
    | 'Normal'
    | 'Body'
    | 'Title'
    | 'Subtitle'
    | 'Heading1'
    | 'Heading2'
    | 'Meta'
    | 'SignatureName'
    | 'SignatureTitle'

type Alignment = 'left' | 'center' | 'right' | 'both'

interface DocxContent {
    page: PageOptions
    styles: StyleOptions
    blocks: DocxBlock[]
}

interface PageOptions {
    size: 'a4' | 'letter'
    orientation: 'portrait' | 'landscape'
    margins: MarginOptions
}

interface MarginOptions {
    top: number
    right: number
    bottom: number
    left: number
}

interface StyleOptions {
    font: string
    bodySize: number
    titleSize: number
    headingSize: number
    lineSpacing: number
}

interface RunInput {
    text: string
    bold?: boolean
    italic?: boolean
    underline?: boolean
    size?: number
    font?: string
}

interface ParagraphBlock {
    type: 'paragraph'
    text?: string
    runs?: RunInput[]
    style?: ParagraphStyle
    alignment?: Alignment
    bold?: boolean
    italic?: boolean
    underline?: boolean
    size?: number
    spacingBefore?: number
    spacingAfter?: number
    indentLeft?: number
    hanging?: number
    firstLine?: number
    keepNext?: boolean
    pageBreakBefore?: boolean
}

interface HeadingBlock {
    type: 'heading'
    text: string
    level?: 1 | 2
    alignment?: Alignment
}

interface SpacerBlock {
    type: 'spacer'
    height?: number
}

interface RuleBlock {
    type: 'rule'
    width?: number
    spacingBefore?: number
    spacingAfter?: number
}

interface TableCellInput {
    text?: string
    runs?: RunInput[]
    bold?: boolean
    italic?: boolean
    alignment?: Alignment
    shading?: string
    verticalAlign?: 'top' | 'center' | 'bottom'
}

interface TableBlock {
    type: 'table'
    rows: Array<Array<string | TableCellInput>>
    columnWidths?: number[]
    width?: number
    alignment?: Alignment
    borders?: 'none' | 'single'
    cellMargins?: number
    spacingBefore?: number
    spacingAfter?: number
}

interface SignatureInput {
    name: string
    title?: string
}

interface SignatureGridBlock {
    type: 'signatureGrid'
    signers: SignatureInput[]
    columns?: number
    lineWidth?: number
    spacingBefore?: number
    spacingAfter?: number
}

type DocxBlock =
    | ParagraphBlock
    | HeadingBlock
    | SpacerBlock
    | RuleBlock
    | TableBlock
    | SignatureGridBlock

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

type DocxEditOperation =
    | {
          type: 'replace'
          oldText: string
          newText: string
      }
    | {
          type: 'appendBlocks'
          blocks: DocxBlock[]
      }
    | {
          type: 'deleteParagraph'
          part?: string
          index?: number
          contains?: string
      }
    | {
          type: 'deleteTable'
          part?: string
          index?: number
          contains?: string
      }

const documentNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const packageRelationshipsNamespace = 'http://schemas.openxmlformats.org/package/2006/relationships'

function escapeXml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
}

function normalizeText(value: unknown): string {
    return String(value ?? '').replaceAll('\\n', '\n')
}

function numberOption(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function booleanOption(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined
}

function alignmentOption(value: unknown, fallback?: Alignment): Alignment | undefined {
    return value === 'center' || value === 'right' || value === 'both' || value === 'left'
        ? value
        : fallback
}

function twips(inches: number): number {
    return Math.round(inches * 1440)
}

function halfPoints(points: number): number {
    return Math.round(points * 2)
}

function spacingTwips(points: number): number {
    return Math.round(points * 20)
}

function dxa(value: number | undefined, fallback: number): number {
    return value === undefined ? fallback : Math.round(value)
}

function normalizePage(value: unknown): PageOptions {
    const record = isRecord(value) ? value : {}
    const margins = isRecord(record.margins) ? record.margins : {}
    return {
        size: record.size === 'letter' ? 'letter' : 'a4',
        orientation: record.orientation === 'landscape' ? 'landscape' : 'portrait',
        margins: {
            top: numberOption(margins.top, 1),
            right: numberOption(margins.right, 1),
            bottom: numberOption(margins.bottom, 1),
            left: numberOption(margins.left, 1),
        },
    }
}

function normalizeStyles(value: unknown): StyleOptions {
    const record = isRecord(value) ? value : {}
    return {
        font:
            typeof record.font === 'string' && record.font.trim()
                ? record.font.trim()
                : 'Times New Roman',
        bodySize: numberOption(record.bodySize, 12),
        titleSize: numberOption(record.titleSize, 18),
        headingSize: numberOption(record.headingSize, 14),
        lineSpacing: numberOption(record.lineSpacing, 1.15),
    }
}

function normalizeRuns(
    value: unknown,
    fallbackText: unknown,
    base: Partial<RunInput> = {},
): RunInput[] {
    if (Array.isArray(value) && value.length > 0) {
        return value.map((run) => {
            const record = isRecord(run) ? run : {}
            return {
                text: normalizeText(record.text),
                bold: booleanOption(record.bold),
                italic: booleanOption(record.italic),
                underline: booleanOption(record.underline),
                size: typeof record.size === 'number' ? record.size : undefined,
                font: typeof record.font === 'string' ? record.font : undefined,
            }
        })
    }
    return [
        {
            ...base,
            text: normalizeText(fallbackText),
        },
    ]
}

function signatureFromLegacyParagraph(value: string): SignatureInput | null {
    const lines = value
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    if (lines.length < 2 || !/^_+/.test(lines[0])) {
        return null
    }
    return {
        name: lines[1],
        title: lines[2] ?? 'Signer',
    }
}

function runsWithBoldLabel(text: string): RunInput[] | null {
    const match = /^([A-Za-z][A-Za-z ]{1,24}:)(\s*.*)$/.exec(text)
    if (!match) {
        return null
    }
    return [
        {
            text: match[1],
            bold: true,
        },
        {
            text: match[2],
        },
    ]
}

function isUppercaseHeading(text: string): boolean {
    const letters = text.replace(/[^A-Za-z]/g, '')
    return letters.length >= 8 && letters === letters.toUpperCase()
}

function legacyParagraphBlocks(text: string, index: number): DocxBlock[] {
    if (index === 1 && isUppercaseHeading(text)) {
        return [
            {
                type: 'paragraph',
                text,
                style: 'Subtitle',
                alignment: 'center',
                bold: true,
                spacingBefore: 18,
                spacingAfter: 22,
            },
            {
                type: 'rule',
                spacingBefore: 10,
                spacingAfter: 34,
            },
        ]
    }
    if (index === 0 && text.length <= 90 && !isUppercaseHeading(text)) {
        return [
            {
                type: 'paragraph',
                text,
                style: 'Meta',
                alignment: 'center',
                spacingAfter: 14,
            },
        ]
    }
    if (runsWithBoldLabel(text)) {
        return [
            {
                type: 'paragraph',
                runs: runsWithBoldLabel(text) ?? undefined,
                text,
                style: 'Meta',
                spacingAfter: 10,
            },
        ]
    }
    if (isUppercaseHeading(text)) {
        return [
            {
                type: 'heading',
                text,
                level: 1,
            },
        ]
    }
    if (/^\d+\.\s+/.test(text)) {
        return [
            {
                type: 'paragraph',
                text,
                style: 'Body',
                indentLeft: 0.32,
                hanging: 0.25,
                spacingAfter: 12,
            },
        ]
    }
    if (/^[a-z]\)\s+/.test(text)) {
        return [
            {
                type: 'paragraph',
                text,
                style: 'Body',
                indentLeft: 0.58,
                hanging: 0.22,
                spacingAfter: 8,
            },
        ]
    }
    return [
        {
            type: 'paragraph',
            text,
            style: 'Body',
        },
    ]
}

function legacyBlocks(record: Record<string, unknown>): DocxBlock[] {
    const blocks: DocxBlock[] = []
    const title = typeof record.title === 'string' ? record.title.trim() : ''
    if (title) {
        blocks.push({
            type: 'paragraph',
            text: title,
            style: 'Title',
            alignment: 'center',
            bold: true,
            spacingAfter: 10,
        })
    }
    const paragraphs = Array.isArray(record.paragraphs)
        ? record.paragraphs.map((paragraph) => normalizeText(paragraph))
        : []
    for (let index = 0; index < paragraphs.length; index += 1) {
        const paragraph = paragraphs[index]
        const signature = signatureFromLegacyParagraph(paragraph)
        if (signature) {
            const signers: SignatureInput[] = []
            while (index < paragraphs.length) {
                const nextSignature = signatureFromLegacyParagraph(paragraphs[index])
                if (!nextSignature) {
                    break
                }
                signers.push(nextSignature)
                index += 1
            }
            index -= 1
            blocks.push({
                type: 'signatureGrid',
                signers,
                columns: signers.length === 1 ? 1 : 2,
                spacingBefore: 8,
            })
            continue
        }
        blocks.push(...legacyParagraphBlocks(paragraph, index))
    }
    if (Array.isArray(record.tables)) {
        for (const table of record.tables) {
            if (!Array.isArray(table)) {
                continue
            }
            blocks.push({
                type: 'table',
                rows: table.map((row) =>
                    Array.isArray(row)
                        ? row.map((cell) => normalizeText(cell))
                        : [normalizeText(row)],
                ),
            })
        }
    }
    return blocks
}

function normalizeCell(value: unknown): string | TableCellInput {
    if (!isRecord(value)) {
        return normalizeText(value)
    }
    return {
        text: normalizeText(value.text),
        runs: Array.isArray(value.runs) ? normalizeRuns(value.runs, value.text) : undefined,
        bold: booleanOption(value.bold),
        italic: booleanOption(value.italic),
        alignment: alignmentOption(value.alignment),
        shading: typeof value.shading === 'string' ? value.shading.replace(/^#/, '') : undefined,
        verticalAlign:
            value.verticalAlign === 'center' || value.verticalAlign === 'bottom'
                ? value.verticalAlign
                : 'top',
    }
}

function normalizeBlock(value: unknown): DocxBlock | null {
    if (typeof value === 'string') {
        return {
            type: 'paragraph',
            text: normalizeText(value),
            style: 'Body',
        }
    }
    if (!isRecord(value)) {
        return null
    }
    const type = typeof value.type === 'string' ? value.type : 'paragraph'
    if (type === 'heading') {
        return {
            type: 'heading',
            text: normalizeText(value.text),
            level: value.level === 2 ? 2 : 1,
            alignment: alignmentOption(value.alignment),
        }
    }
    if (type === 'spacer') {
        return {
            type: 'spacer',
            height: numberOption(value.height, 12),
        }
    }
    if (type === 'rule') {
        return {
            type: 'rule',
            width: numberOption(value.width, 8),
            spacingBefore: numberOption(value.spacingBefore, 0),
            spacingAfter: numberOption(value.spacingAfter, 18),
        }
    }
    if (type === 'table') {
        const rows = Array.isArray(value.rows)
            ? value.rows.map((row) =>
                  Array.isArray(row) ? row.map(normalizeCell) : [normalizeCell(row)],
              )
            : []
        return {
            type: 'table',
            rows,
            columnWidths: Array.isArray(value.columnWidths)
                ? value.columnWidths.map((width) => numberOption(width, 1800))
                : undefined,
            width: typeof value.width === 'number' ? value.width : undefined,
            alignment: alignmentOption(value.alignment),
            borders: value.borders === 'none' ? 'none' : 'single',
            cellMargins: numberOption(value.cellMargins, 90),
            spacingBefore: numberOption(value.spacingBefore, 0),
            spacingAfter: numberOption(value.spacingAfter, 12),
        }
    }
    if (type === 'signatureGrid') {
        const signers = Array.isArray(value.signers)
            ? value.signers
                  .map((signer): SignatureInput | null => {
                      if (!isRecord(signer)) {
                          return null
                      }
                      const name = normalizeText(signer.name).trim()
                      if (!name) {
                          return null
                      }
                      return {
                          name,
                          title: normalizeText(signer.title || 'Signer').trim(),
                      }
                  })
                  .filter((signer): signer is SignatureInput => signer !== null)
            : []
        return {
            type: 'signatureGrid',
            signers,
            columns: Math.max(1, Math.min(3, Math.round(numberOption(value.columns, 2)))),
            lineWidth: numberOption(value.lineWidth, 2600),
            spacingBefore: numberOption(value.spacingBefore, 30),
            spacingAfter: numberOption(value.spacingAfter, 12),
        }
    }
    return {
        type: 'paragraph',
        text: normalizeText(value.text),
        runs: Array.isArray(value.runs) ? normalizeRuns(value.runs, value.text) : undefined,
        style:
            value.style === 'Title' ||
            value.style === 'Subtitle' ||
            value.style === 'Heading1' ||
            value.style === 'Heading2' ||
            value.style === 'Meta' ||
            value.style === 'SignatureName' ||
            value.style === 'SignatureTitle'
                ? value.style
                : 'Body',
        alignment: alignmentOption(value.alignment),
        bold: booleanOption(value.bold),
        italic: booleanOption(value.italic),
        underline: booleanOption(value.underline),
        size: typeof value.size === 'number' ? value.size : undefined,
        spacingBefore: typeof value.spacingBefore === 'number' ? value.spacingBefore : undefined,
        spacingAfter: typeof value.spacingAfter === 'number' ? value.spacingAfter : undefined,
        indentLeft: typeof value.indentLeft === 'number' ? value.indentLeft : undefined,
        hanging: typeof value.hanging === 'number' ? value.hanging : undefined,
        firstLine: typeof value.firstLine === 'number' ? value.firstLine : undefined,
        keepNext: booleanOption(value.keepNext),
        pageBreakBefore: booleanOption(value.pageBreakBefore),
    }
}

function normalizeContent(value: unknown): DocxContent {
    const record = isRecord(value) ? value : {}
    const rawBlocks = record.blocks
    const hasStructuredBlocks = Array.isArray(rawBlocks)
    const blocks = hasStructuredBlocks
        ? rawBlocks.map(normalizeBlock).filter((block): block is DocxBlock => block !== null)
        : legacyBlocks(record)
    const page =
        !hasStructuredBlocks && !isRecord(record.page)
            ? {
                  margins: {
                      top: 0.78,
                      right: 1,
                      bottom: 0.65,
                      left: 1,
                  },
              }
            : record.page
    const styles =
        !hasStructuredBlocks && !isRecord(record.styles)
            ? {
                  bodySize: 11.5,
                  titleSize: 18,
                  headingSize: 13.5,
                  lineSpacing: 1.05,
              }
            : record.styles
    return {
        page: normalizePage(page),
        styles: normalizeStyles(styles),
        blocks,
    }
}

function runPropertiesXml(run: RunInput, styles: StyleOptions): string {
    const properties: string[] = []
    if (run.bold) {
        properties.push('<w:b/>')
    }
    if (run.italic) {
        properties.push('<w:i/>')
    }
    if (run.underline) {
        properties.push('<w:u w:val="single"/>')
    }
    const size = run.size ? halfPoints(run.size) : null
    if (size) {
        properties.push(`<w:sz w:val="${size}"/>`)
    }
    const font = run.font || styles.font
    if (font) {
        properties.push(`<w:rFonts w:ascii="${escapeXml(font)}" w:hAnsi="${escapeXml(font)}"/>`)
    }
    return properties.length > 0 ? `<w:rPr>${properties.join('')}</w:rPr>` : ''
}

function textRunXml(run: RunInput, styles: StyleOptions): string {
    const lines = run.text.split('\n')
    const textXml = lines
        .map((line, index) => {
            const breakXml = index === 0 ? '' : '<w:br/>'
            const text = line.length > 0 ? `<w:t xml:space="preserve">${escapeXml(line)}</w:t>` : ''
            return `${breakXml}${text}`
        })
        .join('')
    return `<w:r>${runPropertiesXml(run, styles)}${textXml || '<w:t/>'}</w:r>`
}

function paragraphPropertiesXml(block: ParagraphBlock, styles: StyleOptions): string {
    const properties: string[] = []
    const style = block.style ?? 'Body'
    if (style !== 'Normal') {
        properties.push(`<w:pStyle w:val="${style}"/>`)
    }
    if (block.keepNext) {
        properties.push('<w:keepNext/>')
    }
    if (block.pageBreakBefore) {
        properties.push('<w:pageBreakBefore/>')
    }
    const before = block.spacingBefore === undefined ? undefined : spacingTwips(block.spacingBefore)
    const after =
        block.spacingAfter === undefined
            ? style === 'Body'
                ? spacingTwips(8)
                : undefined
            : spacingTwips(block.spacingAfter)
    const line = Math.round(styles.lineSpacing * 240)
    if (before !== undefined || after !== undefined || line !== 240) {
        properties.push(
            `<w:spacing${before !== undefined ? ` w:before="${before}"` : ''}${after !== undefined ? ` w:after="${after}"` : ''} w:line="${line}" w:lineRule="auto"/>`,
        )
    }
    const indent: string[] = []
    if (block.indentLeft !== undefined) {
        indent.push(`w:left="${twips(block.indentLeft)}"`)
    }
    if (block.hanging !== undefined) {
        indent.push(`w:hanging="${twips(block.hanging)}"`)
    }
    if (block.firstLine !== undefined) {
        indent.push(`w:firstLine="${twips(block.firstLine)}"`)
    }
    if (indent.length > 0) {
        properties.push(`<w:ind ${indent.join(' ')}/>`)
    }
    if (block.alignment && block.alignment !== 'left') {
        properties.push(`<w:jc w:val="${block.alignment}"/>`)
    }
    return properties.length > 0 ? `<w:pPr>${properties.join('')}</w:pPr>` : ''
}

function paragraphXml(block: ParagraphBlock, styles: StyleOptions): string {
    const runs = normalizeRuns(block.runs, block.text, {
        bold: block.bold,
        italic: block.italic,
        underline: block.underline,
        size: block.size,
    })
    return `<w:p>${paragraphPropertiesXml(block, styles)}${runs.map((run) => textRunXml(run, styles)).join('')}</w:p>`
}

function headingXml(block: HeadingBlock, styles: StyleOptions): string {
    return paragraphXml(
        {
            type: 'paragraph',
            text: block.text,
            style: block.level === 2 ? 'Heading2' : 'Heading1',
            alignment: block.alignment,
            bold: true,
            spacingBefore: block.level === 2 ? 14 : 22,
            spacingAfter: block.level === 2 ? 8 : 10,
            keepNext: true,
        },
        styles,
    )
}

function spacerXml(block: SpacerBlock): string {
    return `<w:p><w:pPr><w:spacing w:after="${spacingTwips(block.height ?? 12)}"/></w:pPr></w:p>`
}

function ruleXml(block: RuleBlock): string {
    const width = Math.max(2, Math.round((block.width ?? 8) * 4))
    return [
        '<w:p>',
        '<w:pPr>',
        `<w:spacing w:before="${spacingTwips(block.spacingBefore ?? 0)}" w:after="${spacingTwips(block.spacingAfter ?? 18)}"/>`,
        `<w:pBdr><w:bottom w:val="single" w:sz="${width}" w:space="1" w:color="666666"/></w:pBdr>`,
        '</w:pPr>',
        '</w:p>',
    ].join('')
}

function tableBordersXml(kind: 'none' | 'single'): string {
    if (kind === 'none') {
        return '<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>'
    }
    return '<w:tblBorders><w:top w:val="single" w:sz="4" w:color="D9D9D9"/><w:left w:val="single" w:sz="4" w:color="D9D9D9"/><w:bottom w:val="single" w:sz="4" w:color="D9D9D9"/><w:right w:val="single" w:sz="4" w:color="D9D9D9"/><w:insideH w:val="single" w:sz="4" w:color="D9D9D9"/><w:insideV w:val="single" w:sz="4" w:color="D9D9D9"/></w:tblBorders>'
}

function tableCellXml(
    cell: string | TableCellInput,
    width: number,
    styles: StyleOptions,
    margin: number,
): string {
    const record: TableCellInput =
        typeof cell === 'string'
            ? {
                  text: cell,
              }
            : cell
    const shading = record.shading ? `<w:shd w:fill="${escapeXml(record.shading)}"/>` : ''
    const verticalAlign =
        record.verticalAlign === 'center'
            ? 'center'
            : record.verticalAlign === 'bottom'
              ? 'bottom'
              : 'top'
    const runs =
        record.runs ??
        normalizeRuns(undefined, record.text, {
            bold: record.bold,
            italic: record.italic,
        })
    return [
        '<w:tc>',
        '<w:tcPr>',
        `<w:tcW w:w="${width}" w:type="dxa"/>`,
        `<w:tcMar><w:top w:w="${margin}" w:type="dxa"/><w:left w:w="${margin}" w:type="dxa"/><w:bottom w:w="${margin}" w:type="dxa"/><w:right w:w="${margin}" w:type="dxa"/></w:tcMar>`,
        `<w:vAlign w:val="${verticalAlign}"/>`,
        shading,
        '</w:tcPr>',
        paragraphXml(
            {
                type: 'paragraph',
                runs,
                style: 'Body',
                alignment: record.alignment,
                spacingAfter: 0,
            },
            styles,
        ),
        '</w:tc>',
    ].join('')
}

function tableXml(block: TableBlock, styles: StyleOptions): string {
    const maxColumns = Math.max(1, ...block.rows.map((row) => row.length))
    const totalWidth = dxa(block.width, 9000)
    const columnWidths =
        block.columnWidths && block.columnWidths.length > 0
            ? block.columnWidths.map((width) => dxa(width, Math.floor(totalWidth / maxColumns)))
            : Array.from({ length: maxColumns }, () => Math.floor(totalWidth / maxColumns))
    const grid = columnWidths.map((width) => `<w:gridCol w:w="${width}"/>`).join('')
    const rows = block.rows
        .map((row) => {
            const cells = Array.from({ length: maxColumns }, (_value, index) =>
                tableCellXml(
                    row[index] ?? '',
                    columnWidths[index] ?? columnWidths[0],
                    styles,
                    dxa(block.cellMargins, 90),
                ),
            ).join('')
            return `<w:tr>${cells}</w:tr>`
        })
        .join('')
    const before = block.spacingBefore
        ? spacerXml({ type: 'spacer', height: block.spacingBefore })
        : ''
    const after = block.spacingAfter
        ? spacerXml({ type: 'spacer', height: block.spacingAfter })
        : ''
    const alignment =
        block.alignment && block.alignment !== 'left' ? `<w:jc w:val="${block.alignment}"/>` : ''
    return [
        before,
        '<w:tbl>',
        '<w:tblPr>',
        `<w:tblW w:w="${totalWidth}" w:type="dxa"/>`,
        alignment,
        tableBordersXml(block.borders ?? 'single'),
        '</w:tblPr>',
        `<w:tblGrid>${grid}</w:tblGrid>`,
        rows,
        '</w:tbl>',
        after,
    ].join('')
}

function signatureLineParagraph(width: number): string {
    return [
        '<w:p>',
        '<w:pPr>',
        '<w:keepNext/>',
        '<w:spacing w:before="120" w:after="80"/>',
        `<w:pBdr><w:top w:val="single" w:sz="6" w:space="1" w:color="4D4D4D"/></w:pBdr>`,
        `<w:ind w:right="${Math.max(0, 4200 - width)}"/>`,
        '</w:pPr>',
        '</w:p>',
    ].join('')
}

function signatureCellXml(
    signer: SignatureInput | null,
    width: number,
    styles: StyleOptions,
    lineWidth: number,
): string {
    if (!signer) {
        return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tcBorders></w:tcPr><w:p/></w:tc>`
    }
    return [
        '<w:tc>',
        '<w:tcPr>',
        `<w:tcW w:w="${width}" w:type="dxa"/>`,
        '<w:tcMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tcMar>',
        '</w:tcPr>',
        signatureLineParagraph(Math.min(lineWidth, width)),
        paragraphXml(
            {
                type: 'paragraph',
                text: signer.name,
                style: 'SignatureName',
                italic: true,
                spacingAfter: 2,
                keepNext: true,
            },
            styles,
        ),
        paragraphXml(
            {
                type: 'paragraph',
                text: signer.title || 'Signer',
                style: 'SignatureTitle',
                spacingAfter: 0,
            },
            styles,
        ),
        '</w:tc>',
    ].join('')
}

function signatureGridXml(block: SignatureGridBlock, styles: StyleOptions): string {
    const columns = block.columns ?? 2
    const width = Math.floor(9000 / columns)
    const lineWidth = dxa(block.lineWidth, Math.min(width, 3400))
    const rows: string[] = []
    for (let index = 0; index < block.signers.length; index += columns) {
        const cells = Array.from({ length: columns }, (_value, offset) =>
            signatureCellXml(block.signers[index + offset] ?? null, width, styles, lineWidth),
        ).join('')
        rows.push(`<w:tr><w:trPr><w:cantSplit/></w:trPr>${cells}</w:tr>`)
    }
    return [
        spacerXml({ type: 'spacer', height: block.spacingBefore ?? 30 }),
        '<w:tbl>',
        '<w:tblPr><w:tblW w:w="9000" w:type="dxa"/>',
        tableBordersXml('none'),
        '</w:tblPr>',
        `<w:tblGrid>${Array.from({ length: columns }, () => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>`,
        rows.join(''),
        '</w:tbl>',
        spacerXml({ type: 'spacer', height: block.spacingAfter ?? 12 }),
    ].join('')
}

function blockXml(block: DocxBlock, styles: StyleOptions): string {
    if (block.type === 'heading') {
        return headingXml(block, styles)
    }
    if (block.type === 'spacer') {
        return spacerXml(block)
    }
    if (block.type === 'rule') {
        return ruleXml(block)
    }
    if (block.type === 'table') {
        return tableXml(block, styles)
    }
    if (block.type === 'signatureGrid') {
        return signatureGridXml(block, styles)
    }
    return paragraphXml(block, styles)
}

function pageSizeXml(page: PageOptions): string {
    const portrait =
        page.size === 'letter'
            ? {
                  width: 12240,
                  height: 15840,
              }
            : {
                  width: 11906,
                  height: 16838,
              }
    const width = page.orientation === 'landscape' ? portrait.height : portrait.width
    const height = page.orientation === 'landscape' ? portrait.width : portrait.height
    const orientation = page.orientation === 'landscape' ? ' w:orient="landscape"' : ''
    return `<w:pgSz w:w="${width}" w:h="${height}"${orientation}/>`
}

function sectionPropertiesXml(page: PageOptions): string {
    return [
        '<w:sectPr>',
        pageSizeXml(page),
        `<w:pgMar w:top="${twips(page.margins.top)}" w:right="${twips(page.margins.right)}" w:bottom="${twips(page.margins.bottom)}" w:left="${twips(page.margins.left)}" w:header="720" w:footer="720" w:gutter="0"/>`,
        '</w:sectPr>',
    ].join('')
}

function createDocumentXml(content: DocxContent): string {
    const body = content.blocks.map((block) => blockXml(block, content.styles)).join('')
    return [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        `<w:document xmlns:w="${documentNamespace}">`,
        `<w:body>${body}${sectionPropertiesXml(content.page)}</w:body>`,
        '</w:document>',
    ].join('')
}

function paragraphStyleXml(input: {
    id: ParagraphStyle
    name: string
    basedOn?: ParagraphStyle
    next?: ParagraphStyle
    size?: number
    bold?: boolean
    italic?: boolean
    alignment?: Alignment
    spacingBefore?: number
    spacingAfter?: number
    outlineLevel?: number
    font: string
}): string {
    const basedOn = input.basedOn ? `<w:basedOn w:val="${input.basedOn}"/>` : ''
    const next = input.next ? `<w:next w:val="${input.next}"/>` : ''
    const paragraph: string[] = []
    if (input.alignment && input.alignment !== 'left') {
        paragraph.push(`<w:jc w:val="${input.alignment}"/>`)
    }
    if (input.spacingBefore !== undefined || input.spacingAfter !== undefined) {
        paragraph.push(
            `<w:spacing${input.spacingBefore !== undefined ? ` w:before="${spacingTwips(input.spacingBefore)}"` : ''}${input.spacingAfter !== undefined ? ` w:after="${spacingTwips(input.spacingAfter)}"` : ''}/>`,
        )
    }
    if (input.outlineLevel !== undefined) {
        paragraph.push(`<w:outlineLvl w:val="${input.outlineLevel}"/>`)
    }
    const run: string[] = [
        `<w:rFonts w:ascii="${escapeXml(input.font)}" w:hAnsi="${escapeXml(input.font)}"/>`,
    ]
    if (input.bold) {
        run.push('<w:b/>')
    }
    if (input.italic) {
        run.push('<w:i/>')
    }
    if (input.size) {
        run.push(`<w:sz w:val="${halfPoints(input.size)}"/>`)
    }
    return [
        `<w:style w:type="paragraph" w:styleId="${input.id}">`,
        `<w:name w:val="${escapeXml(input.name)}"/>`,
        basedOn,
        next,
        paragraph.length > 0 ? `<w:pPr>${paragraph.join('')}</w:pPr>` : '',
        `<w:rPr>${run.join('')}</w:rPr>`,
        '</w:style>',
    ].join('')
}

function createStylesXml(styles: StyleOptions): string {
    return [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        `<w:styles xmlns:w="${documentNamespace}">`,
        '<w:docDefaults>',
        `<w:rPrDefault><w:rPr><w:rFonts w:ascii="${escapeXml(styles.font)}" w:hAnsi="${escapeXml(styles.font)}"/><w:sz w:val="${halfPoints(styles.bodySize)}"/></w:rPr></w:rPrDefault>`,
        '</w:docDefaults>',
        paragraphStyleXml({
            id: 'Normal',
            name: 'Normal',
            size: styles.bodySize,
            font: styles.font,
        }),
        paragraphStyleXml({
            id: 'Body',
            name: 'Body',
            basedOn: 'Normal',
            next: 'Body',
            size: styles.bodySize,
            spacingAfter: 8,
            font: styles.font,
        }),
        paragraphStyleXml({
            id: 'Title',
            name: 'Title',
            basedOn: 'Normal',
            next: 'Body',
            size: styles.titleSize,
            bold: true,
            alignment: 'center',
            spacingAfter: 8,
            font: styles.font,
        }),
        paragraphStyleXml({
            id: 'Subtitle',
            name: 'Subtitle',
            basedOn: 'Normal',
            next: 'Body',
            size: styles.headingSize,
            bold: true,
            alignment: 'center',
            spacingBefore: 18,
            spacingAfter: 18,
            font: styles.font,
        }),
        paragraphStyleXml({
            id: 'Heading1',
            name: 'Heading 1',
            basedOn: 'Normal',
            next: 'Body',
            size: styles.headingSize,
            bold: true,
            spacingBefore: 18,
            spacingAfter: 8,
            outlineLevel: 0,
            font: styles.font,
        }),
        paragraphStyleXml({
            id: 'Heading2',
            name: 'Heading 2',
            basedOn: 'Normal',
            next: 'Body',
            size: styles.bodySize + 1,
            bold: true,
            spacingBefore: 12,
            spacingAfter: 6,
            outlineLevel: 1,
            font: styles.font,
        }),
        paragraphStyleXml({
            id: 'Meta',
            name: 'Meta',
            basedOn: 'Normal',
            next: 'Body',
            size: styles.bodySize,
            spacingAfter: 8,
            font: styles.font,
        }),
        paragraphStyleXml({
            id: 'SignatureName',
            name: 'Signature Name',
            basedOn: 'Normal',
            next: 'SignatureTitle',
            size: styles.bodySize,
            italic: true,
            spacingAfter: 4,
            font: styles.font,
        }),
        paragraphStyleXml({
            id: 'SignatureTitle',
            name: 'Signature Title',
            basedOn: 'Normal',
            next: 'Body',
            size: styles.bodySize,
            spacingAfter: 0,
            font: styles.font,
        }),
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
            '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>',
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
            `<Relationships xmlns="${packageRelationshipsNamespace}">`,
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
            '</Relationships>',
        ].join(''),
    )
    writeZipText(
        zip,
        'word/_rels/document.xml.rels',
        [
            '<?xml version="1.0" encoding="UTF-8"?>',
            `<Relationships xmlns="${packageRelationshipsNamespace}">`,
            '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
            '<Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>',
            '</Relationships>',
        ].join(''),
    )
    writeZipText(zip, 'word/document.xml', createDocumentXml(content))
    writeZipText(zip, 'word/styles.xml', createStylesXml(content.styles))
    writeZipText(
        zip,
        'word/settings.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="${documentNamespace}"><w:displayBackgroundShape/><w:compat/></w:settings>`,
    )
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

function docxIssues(input: {
    documentXml: string | undefined
    paragraphs: ParagraphInspection[]
    tables: TableInspection[]
    validationErrors: string[]
}): string[] {
    const issues = [...input.validationErrors]
    if (!input.documentXml) {
        issues.push('Missing word/document.xml')
        return issues
    }
    if (countOccurrences(input.documentXml, '\\n') > 0) {
        issues.push('Literal escaped line breaks found in document XML')
    }
    if (!input.documentXml.includes('<w:sectPr')) {
        issues.push('Document is missing section properties')
    }
    if (input.paragraphs.length === 0 && input.tables.length === 0) {
        issues.push('Document has no visible paragraph or table text')
    }
    if (/<w:tbl>/.test(input.documentXml) && !/<w:tblGrid>/.test(input.documentXml)) {
        issues.push('Document contains a table without an explicit table grid')
    }
    return issues
}

async function inspectDocx(path: string): Promise<Record<string, unknown>> {
    const zip = await loadZip(path)
    const paragraphs: ParagraphInspection[] = []
    const tables: TableInspection[] = []
    const documentXml = await zip.file('word/document.xml')?.async('text')
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
    const validation = await validateOfficePackage(path, [
        '[Content_Types].xml',
        '_rels/.rels',
        'word/document.xml',
        'word/styles.xml',
    ])
    const issues = docxIssues({
        documentXml,
        paragraphs,
        tables,
        validationErrors: validation.errors,
    })
    return {
        text: lines.join('\n'),
        paragraphs,
        tables,
        outline: paragraphs
            .filter((paragraph) => paragraph.style === 'Heading1' || paragraph.style === 'Heading2')
            .map((paragraph) => ({
                part: paragraph.part,
                index: paragraph.index,
                level: paragraph.style === 'Heading2' ? 2 : 1,
                text: paragraph.text,
            })),
        paragraphCount: paragraphs.length,
        tableCount: tables.length,
        literalBackslashNCount: documentXml ? countOccurrences(documentXml, '\\n') : 0,
        validation,
        issues,
        partsScanned: docxStoryPartNames(zip),
    }
}

function normalizeReplacementInput(value: unknown): Array<{ oldText: string; newText: string }> {
    if (!Array.isArray(value)) {
        fail('Replacements must be a JSON array')
    }
    return value.map((entry) => {
        if (!isRecord(entry)) {
            fail('Each replacement must be an object')
        }
        if (typeof entry.oldText !== 'string' || typeof entry.newText !== 'string') {
            fail('Each replacement must include oldText and newText strings')
        }
        if (entry.oldText.length === 0) {
            fail('Replacement oldText cannot be empty')
        }
        return {
            oldText: entry.oldText,
            newText: entry.newText,
        }
    })
}

function normalizeDocxOperations(value: unknown): DocxEditOperation[] {
    if (!Array.isArray(value)) {
        fail('Operations must be a JSON array')
    }
    return value.map((entry) => {
        if (!isRecord(entry)) {
            fail('Each operation must be an object')
        }
        const type = typeof entry.type === 'string' ? entry.type : ''
        if (type === 'replace') {
            if (typeof entry.oldText !== 'string' || typeof entry.newText !== 'string') {
                fail('Replace operations require oldText and newText strings')
            }
            if (!entry.oldText) {
                fail('Replace oldText cannot be empty')
            }
            return {
                type,
                oldText: entry.oldText,
                newText: entry.newText,
            }
        }
        if (type === 'appendBlocks') {
            const blocks = Array.isArray(entry.blocks)
                ? entry.blocks
                      .map(normalizeBlock)
                      .filter((block): block is DocxBlock => block !== null)
                : []
            if (blocks.length === 0) {
                fail('appendBlocks requires at least one block')
            }
            return {
                type,
                blocks,
            }
        }
        if (type === 'deleteParagraph' || type === 'deleteTable') {
            const index =
                typeof entry.index === 'number' && Number.isInteger(entry.index) && entry.index > 0
                    ? entry.index
                    : undefined
            const contains = typeof entry.contains === 'string' ? entry.contains : undefined
            if (index === undefined && !contains) {
                fail(`${type} requires index or contains`)
            }
            return {
                type,
                part: typeof entry.part === 'string' ? entry.part : undefined,
                index,
                contains,
            }
        }
        fail(`Unsupported DOCX edit operation: ${type || 'missing type'}`)
    })
}

function appendBlocksToDocumentXml(xml: string, blocks: DocxBlock[]): string {
    const insertXml = blocks.map((block) => blockXml(block, normalizeStyles({}))).join('')
    const sectionStart = xml.lastIndexOf('<w:sectPr')
    if (sectionStart >= 0) {
        return `${xml.slice(0, sectionStart)}${insertXml}${xml.slice(sectionStart)}`
    }
    const bodyEnd = xml.lastIndexOf('</w:body>')
    if (bodyEnd < 0) {
        fail('word/document.xml has no body end tag')
    }
    return `${xml.slice(0, bodyEnd)}${insertXml}${xml.slice(bodyEnd)}`
}

function deleteMatchingDocxChildren(input: {
    document: ReturnType<typeof parseXml>
    elementName: 'p' | 'tbl'
    index?: number
    contains?: string
}): number {
    const body = firstElementByLocalName(input.document, 'body') ?? input.document.documentElement
    if (!body) {
        return 0
    }
    const candidates = directElementsByLocalName(body, input.elementName)
    let removed = 0
    candidates.forEach((element, zeroIndex) => {
        if (input.index !== undefined && input.index !== zeroIndex + 1) {
            return
        }
        if (input.contains && !textFromTextElements(element, 't').includes(input.contains)) {
            return
        }
        element.parentNode?.removeChild(element)
        removed += 1
    })
    return removed
}

async function applyDocxReplacements(
    zip: JSZip,
    replacements: Array<{ oldText: string; newText: string }>,
): Promise<number> {
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
    return replacementCount
}

async function editDocx(
    path: string,
    replacements: Array<{ oldText: string; newText: string }>,
    operations: DocxEditOperation[],
): Promise<Record<string, number>> {
    const zip = await loadZip(path)
    let replacementCount = 0
    let appendedBlockCount = 0
    let deletedCount = 0
    if (replacements.length > 0) {
        replacementCount += await applyDocxReplacements(zip, replacements)
    }
    for (const operation of operations) {
        if (operation.type === 'replace') {
            replacementCount += await applyDocxReplacements(zip, [
                {
                    oldText: operation.oldText,
                    newText: operation.newText,
                },
            ])
        } else if (operation.type === 'appendBlocks') {
            const documentXml = await readZipText(zip, 'word/document.xml')
            if (!documentXml) {
                fail('word/document.xml not found')
            }
            writeZipText(
                zip,
                'word/document.xml',
                appendBlocksToDocumentXml(documentXml, operation.blocks),
            )
            appendedBlockCount += operation.blocks.length
        } else {
            let operationDeletedCount = 0
            const elementName = operation.type === 'deleteTable' ? 'tbl' : 'p'
            for (const part of docxStoryPartNames(zip)) {
                if (operation.part && operation.part !== part) {
                    continue
                }
                const file = zip.file(part)
                if (!file) {
                    continue
                }
                const document = parseXml(await file.async('text'))
                const partDeletedCount = deleteMatchingDocxChildren({
                    document,
                    elementName,
                    index: operation.index,
                    contains: operation.contains,
                })
                if (partDeletedCount > 0) {
                    operationDeletedCount += partDeletedCount
                    writeZipText(zip, part, serializeXml(document))
                }
            }
            if (operationDeletedCount === 0) {
                fail(`No ${elementName === 'tbl' ? 'table' : 'paragraph'} matched delete operation`)
            }
            deletedCount += operationDeletedCount
        }
    }
    if (replacementCount + appendedBlockCount + deletedCount === 0) {
        fail('At least one DOCX edit operation is required')
    }
    await saveZip(zip, path)
    return {
        replacementCount,
        appendedBlockCount,
        deletedCount,
    }
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
        const content = await parseJsonInput<unknown>({
            options: command.options,
            root,
            jsonOption: 'content-json',
            fileOption: 'content-file',
            fallback: {},
        })
        await ensureParent(path)
        await createDocx(path, normalizeContent(content))
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
    if (command.operation === 'validate') {
        printJson({
            operation: command.operation,
            format: 'docx',
            root,
            path: requiredOption(command.options, 'path'),
            validation: await validateOfficePackage(path, [
                '[Content_Types].xml',
                '_rels/.rels',
                'word/document.xml',
                'word/styles.xml',
            ]),
        })
        return
    }
    if (command.operation === 'render') {
        const outputDir = optionalOption(
            command.options,
            'output-dir',
            `_renders/${requiredOption(command.options, 'path').replace(/[^A-Za-z0-9_.-]+/g, '-')}`,
        )
        const outputPath = await resolveRoomPath({
            root: 'workspace',
            path: outputDir,
            mustExist: false,
        })
        printJson({
            operation: command.operation,
            format: 'docx',
            root,
            outputRoot: 'workspace',
            path: requiredOption(command.options, 'path'),
            ...(await renderOfficeDocument({
                path,
                outputDir: outputPath,
                relativeOutputDir: outputDir,
                emitPdf: truthyOption(
                    optionalAnyOption(command.options, ['emit-pdf', 'pdf'], 'false'),
                ),
            })),
        })
        return
    }
    if (command.operation === 'edit') {
        requireWorkspace(root, command.operation)
        const replacements = normalizeReplacementInput(
            await parseJsonInput<unknown>({
                options: command.options,
                root,
                jsonOption: 'replacements-json',
                fileOption: 'replacements-file',
                fallback: [],
            }),
        )
        const operations = normalizeDocxOperations(
            await parseJsonInput<unknown>({
                options: command.options,
                root,
                jsonOption: 'operations-json',
                fileOption: 'operations-file',
                fallback: [],
            }),
        )
        printJson({
            operation: command.operation,
            format: 'docx',
            root,
            path: requiredOption(command.options, 'path'),
            ...(await editDocx(path, replacements, operations)),
        })
        return
    }
    fail('Operation must be create, inspect, edit, validate, or render')
}

main().catch(printError)
