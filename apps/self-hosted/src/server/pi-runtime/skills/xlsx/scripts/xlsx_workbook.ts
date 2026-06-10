import JSZip from 'jszip'
import {
    appendElement,
    attributeByLocalName,
    clearChildren,
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
    renderOfficeDocument,
    requiredOption,
    requireWorkspace,
    resolveRoomPath,
    saveZip,
    serializeXml,
    setElementText,
    truthyOption,
    type XmlDocument,
    type XmlElement,
    validateOfficePackage,
    writeZipText,
    zipFileNames,
} from '../../.shared/office.ts'

type WorkbookCellPrimitive = string | number | boolean | null

interface WorkbookCellInput {
    value?: WorkbookCellPrimitive
    formula?: string
    style?: string
    bold?: boolean
    italic?: boolean
    fill?: string
    numberFormat?: string
    alignment?: 'left' | 'center' | 'right'
}

interface SheetInput {
    name: string
    rows: Array<Array<WorkbookCellPrimitive | WorkbookCellInput>>
    columns?: Array<number | { width?: number }>
    merges?: string[]
    autoFilter?: string | boolean
    freezePane?: string | boolean
}

interface SheetPart {
    name: string
    target: string
}

interface CellInspection {
    address: string
    value: string | number | boolean | null
    formula: string | null
    style: string | null
    numberFormatId: string | null
    numberFormat: string | null
}

interface SheetInspection {
    name: string
    cells: CellInspection[]
    mergedCells: string[]
}

interface WorkbookEdit {
    type: 'setCell' | 'deleteCell' | 'addSheet' | 'deleteSheet'
    sheet?: string
    cell?: string
    name?: string
    rows?: Array<Array<WorkbookCellPrimitive | WorkbookCellInput>>
    value?: unknown
    formula?: string
}

const spreadsheetNamespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const relationshipsNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const packageRelationshipsNamespace = 'http://schemas.openxmlformats.org/package/2006/relationships'

function escapeXml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
}

function normalizeSheets(value: unknown): SheetInput[] {
    const source = isRecord(value) ? value.sheets : value
    const sheets =
        Array.isArray(source) && source.length > 0 ? source : [{ name: 'Sheet 1', rows: [['']] }]
    const seenNames = new Set<string>()
    return sheets.map((sheet, index) => {
        const record = isRecord(sheet) ? sheet : {}
        const rows = normalizeRows(
            Array.isArray(record.rows)
                ? record.rows
                : Array.isArray(record.data)
                  ? record.data
                  : [],
        )
        const rawName =
            record.name === undefined || record.name === null
                ? `Sheet ${index + 1}`
                : String(record.name)
        const name = rawName.trim()
        validateSheetName(name)
        const comparableName = name.toLowerCase()
        if (seenNames.has(comparableName)) {
            fail(`Duplicate sheet name: ${name}`)
        }
        seenNames.add(comparableName)
        return {
            name,
            rows,
            columns: Array.isArray(record.columns)
                ? record.columns.map((column) =>
                      typeof column === 'number' || isRecord(column) ? column : {},
                  )
                : undefined,
            merges: Array.isArray(record.merges)
                ? record.merges.map((merge) => String(merge)).filter(Boolean)
                : undefined,
            autoFilter:
                typeof record.autoFilter === 'string' || record.autoFilter === true
                    ? record.autoFilter
                    : rows.length > 1,
            freezePane:
                typeof record.freezePane === 'string' || record.freezePane === true
                    ? record.freezePane
                    : rows.length > 1,
        }
    })
}

function columnName(index: number): string {
    let value = ''
    let current = index + 1
    while (current > 0) {
        const remainder = (current - 1) % 26
        value = String.fromCharCode(65 + remainder) + value
        current = Math.floor((current - 1) / 26)
    }
    return value
}

function columnIndex(column: string): number {
    let value = 0
    for (const character of column.toUpperCase()) {
        value = value * 26 + character.charCodeAt(0) - 64
    }
    return value - 1
}

function splitAddress(address: string): { column: string; row: number; normalized: string } {
    const match = /^([A-Za-z]+)([1-9][0-9]*)$/.exec(address.trim())
    if (!match) {
        fail(`Invalid cell address: ${address}`)
    }
    const column = match[1].toUpperCase()
    const row = Number(match[2])
    return {
        column,
        row,
        normalized: `${column}${row}`,
    }
}

function validateSheetName(name: string): void {
    if (!name) {
        fail('Sheet name cannot be empty')
    }
    if (name.length > 31) {
        fail(`Sheet name cannot exceed 31 characters: ${name}`)
    }
    if ([...name].some((character) => '[]:*?/\\'.includes(character))) {
        fail(`Invalid sheet name: ${name}`)
    }
}

function normalizeCellInput(value: unknown): WorkbookCellPrimitive | WorkbookCellInput {
    if (!isRecord(value)) {
        if (
            typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean' ||
            value === null
        ) {
            return value
        }
        return String(value ?? '')
    }
    const cell: WorkbookCellInput = {}
    if (typeof value.formula === 'string') {
        cell.formula = value.formula
    }
    if (
        typeof value.value === 'string' ||
        typeof value.value === 'number' ||
        typeof value.value === 'boolean' ||
        value.value === null
    ) {
        cell.value = value.value
    }
    if (typeof value.style === 'string') {
        cell.style = value.style
    }
    if (typeof value.numberFormat === 'string') {
        cell.numberFormat = value.numberFormat
    }
    if (typeof value.fill === 'string') {
        cell.fill = value.fill.replace(/^#/, '')
    }
    if (value.bold === true) {
        cell.bold = true
    }
    if (value.italic === true) {
        cell.italic = true
    }
    if (value.alignment === 'center' || value.alignment === 'right' || value.alignment === 'left') {
        cell.alignment = value.alignment
    }
    return cell
}

function normalizeRows(value: unknown): Array<Array<WorkbookCellPrimitive | WorkbookCellInput>> {
    return Array.isArray(value)
        ? value.map((row) =>
              Array.isArray(row) ? row.map(normalizeCellInput) : [normalizeCellInput(row)],
          )
        : []
}

function isWorkbookCellInput(
    cell: WorkbookCellPrimitive | WorkbookCellInput,
): cell is WorkbookCellInput {
    return typeof cell === 'object' && cell !== null
}

function cellValueAndStyle(cell: WorkbookCellPrimitive | WorkbookCellInput): {
    value: WorkbookCellPrimitive
    formula: string | null
    styleKey: string | null
} {
    if (!isWorkbookCellInput(cell)) {
        return {
            value: cell,
            formula: typeof cell === 'string' && cell.startsWith('=') ? cell.slice(1) : null,
            styleKey: null,
        }
    }
    return {
        value: cell.value ?? null,
        formula: cell.formula
            ? cell.formula.startsWith('=')
                ? cell.formula.slice(1)
                : cell.formula
            : null,
        styleKey: styleKeyForCell(cell),
    }
}

function styleKeyForCell(cell: WorkbookCellInput): string | null {
    const parts = [
        cell.style ? `style:${cell.style}` : '',
        cell.bold ? 'bold' : '',
        cell.italic ? 'italic' : '',
        cell.fill ? `fill:${cell.fill}` : '',
        cell.numberFormat ? `num:${cell.numberFormat}` : '',
        cell.alignment ? `align:${cell.alignment}` : '',
    ].filter(Boolean)
    return parts.length > 0 ? parts.join('|') : null
}

function styleIdForCell(cell: WorkbookCellPrimitive | WorkbookCellInput, rowIndex: number): number {
    if (isRecord(cell)) {
        const styleName = typeof cell.style === 'string' ? cell.style.toLowerCase() : ''
        if (styleName === 'header') return 1
        if (styleName === 'currency') return 2
        if (styleName === 'percent') return 3
        if (styleName === 'integer') return 4
        if (styleName === 'date') return 5
        if (cell.bold || cell.fill || cell.numberFormat || cell.alignment) return 1
    }
    return rowIndex === 0 ? 1 : 0
}

function cellXml(
    address: string,
    cell: WorkbookCellPrimitive | WorkbookCellInput,
    rowIndex: number,
): string {
    const normalized = cellValueAndStyle(cell)
    const styleId = styleIdForCell(cell, rowIndex)
    const style = styleId > 0 ? ` s="${styleId}"` : ''
    if (normalized.formula) {
        const cached =
            typeof normalized.value === 'number' && Number.isFinite(normalized.value)
                ? `<v>${normalized.value}</v>`
                : ''
        return `<c r="${address}"${style}><f>${escapeXml(normalized.formula)}</f>${cached}</c>`
    }
    if (typeof normalized.value === 'boolean') {
        return `<c r="${address}" t="b"${style}><v>${normalized.value ? 1 : 0}</v></c>`
    }
    if (typeof normalized.value === 'number' && Number.isFinite(normalized.value)) {
        return `<c r="${address}"${style}><v>${normalized.value}</v></c>`
    }
    const text = String(normalized.value ?? '')
    return `<c r="${address}" t="inlineStr"${style}><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`
}

function columnWidthsXml(sheet: SheetInput): string {
    const maxColumns = Math.max(0, ...sheet.rows.map((row) => row.length))
    const widths = Array.from({ length: maxColumns }, (_value, index) => {
        const explicit = sheet.columns?.[index]
        if (typeof explicit === 'number') {
            return explicit
        }
        if (isRecord(explicit) && typeof explicit.width === 'number') {
            return explicit.width
        }
        const maxTextLength = Math.max(
            8,
            ...sheet.rows.map((row) => {
                const cell = cellValueAndStyle(row[index] ?? '')
                return String(cell.value ?? cell.formula ?? '').length
            }),
        )
        return Math.min(60, Math.max(10, maxTextLength + 2))
    })
    return widths.length > 0
        ? `<cols>${widths
              .map(
                  (width, index) =>
                      `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`,
              )
              .join('')}</cols>`
        : ''
}

function createWorksheetXml(sheet: SheetInput): string {
    const rows = sheet.rows
    const rowXml = rows
        .map((row, rowIndex) => {
            const cells = row
                .map((value, columnIndexValue) =>
                    cellXml(`${columnName(columnIndexValue)}${rowIndex + 1}`, value, rowIndex),
                )
                .join('')
            return `<row r="${rowIndex + 1}">${cells}</row>`
        })
        .join('')
    const maxColumn = Math.max(0, ...rows.map((row) => row.length - 1))
    const dimension = rows.length > 0 ? `A1:${columnName(maxColumn)}${rows.length}` : 'A1'
    const autoFilter =
        sheet.autoFilter === true
            ? `<autoFilter ref="${dimension}"/>`
            : typeof sheet.autoFilter === 'string'
              ? `<autoFilter ref="${escapeXml(sheet.autoFilter)}"/>`
              : ''
    const freezePane =
        sheet.freezePane === true
            ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
            : typeof sheet.freezePane === 'string'
              ? `<sheetViews><sheetView workbookViewId="0"><pane topLeftCell="${escapeXml(sheet.freezePane)}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
              : ''
    const merges =
        sheet.merges && sheet.merges.length > 0
            ? `<mergeCells count="${sheet.merges.length}">${sheet.merges
                  .map((merge) => `<mergeCell ref="${escapeXml(merge)}"/>`)
                  .join('')}</mergeCells>`
            : ''
    return [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        `<worksheet xmlns="${spreadsheetNamespace}" xmlns:r="${relationshipsNamespace}">`,
        freezePane,
        `<dimension ref="${dimension}"/>`,
        columnWidthsXml(sheet),
        `<sheetData>${rowXml}</sheetData>`,
        merges,
        autoFilter,
        '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>',
        '</worksheet>',
    ].join('')
}

async function createXlsx(path: string, sheets: SheetInput[]): Promise<void> {
    const zip = new JSZip()
    writeZipText(
        zip,
        '[Content_Types].xml',
        [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
            '<Default Extension="xml" ContentType="application/xml"/>',
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
            '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
            ...sheets.map(
                (_sheet, index) =>
                    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
            ),
            '</Types>',
        ].join(''),
    )
    writeZipText(
        zip,
        '_rels/.rels',
        [
            '<?xml version="1.0" encoding="UTF-8"?>',
            `<Relationships xmlns="${packageRelationshipsNamespace}">`,
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>',
            '</Relationships>',
        ].join(''),
    )
    const sheetEntries = sheets
        .map(
            (sheet, index) =>
                `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
        )
        .join('')
    writeZipText(
        zip,
        'xl/workbook.xml',
        [
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
            `<workbook xmlns="${spreadsheetNamespace}" xmlns:r="${relationshipsNamespace}">`,
            `<sheets>${sheetEntries}</sheets>`,
            '</workbook>',
        ].join(''),
    )
    const relations = sheets
        .map(
            (_sheet, index) =>
                `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
        )
        .join('')
    writeZipText(
        zip,
        'xl/_rels/workbook.xml.rels',
        `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${packageRelationshipsNamespace}">${relations}</Relationships>`,
    )
    writeZipText(zip, 'xl/styles.xml', createStylesXml())
    sheets.forEach((sheet, index) => {
        writeZipText(zip, `xl/worksheets/sheet${index + 1}.xml`, createWorksheetXml(sheet))
    })
    await saveZip(zip, path)
}

function createStylesXml(): string {
    return [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        `<styleSheet xmlns="${spreadsheetNamespace}">`,
        '<numFmts count="1"><numFmt numFmtId="164" formatCode="$#,##0.00"/></numFmts>',
        '<fonts count="4">',
        '<font><sz val="11"/><name val="Aptos"/></font>',
        '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font>',
        '<font><b/><sz val="11"/><name val="Aptos"/></font>',
        '<font><i/><sz val="11"/><name val="Aptos"/></font>',
        '</fonts>',
        '<fills count="3">',
        '<fill><patternFill patternType="none"/></fill>',
        '<fill><patternFill patternType="gray125"/></fill>',
        '<fill><patternFill patternType="solid"><fgColor rgb="FF1F4E79"/><bgColor indexed="64"/></patternFill></fill>',
        '</fills>',
        '<borders count="2">',
        '<border/>',
        '<border><left style="thin"><color rgb="FFD9D9D9"/></left><right style="thin"><color rgb="FFD9D9D9"/></right><top style="thin"><color rgb="FFD9D9D9"/></top><bottom style="thin"><color rgb="FFD9D9D9"/></bottom></border>',
        '</borders>',
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>',
        '<cellXfs count="6">',
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center"/></xf>',
        '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>',
        '<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>',
        '<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>',
        '<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>',
        '</cellXfs>',
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>',
        '</styleSheet>',
    ].join('')
}

function relationshipTarget(base: string, target: string): string {
    if (target.startsWith('/')) {
        return target.slice(1)
    }
    if (target.startsWith('xl/')) {
        return target
    }
    return `${base}/${target}`.replaceAll('//', '/')
}

async function workbookSheets(zip: JSZip): Promise<SheetPart[]> {
    const workbookXml = await readZipText(zip, 'xl/workbook.xml')
    const relsXml = await readZipText(zip, 'xl/_rels/workbook.xml.rels')
    if (!workbookXml || !relsXml) {
        return zipFileNames(zip)
            .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
            .map((target, index) => ({
                name: `Sheet ${index + 1}`,
                target,
            }))
    }
    const workbook = parseXml(workbookXml)
    const rels = parseXml(relsXml)
    const targets = new Map<string, string>()
    for (const relationship of elementsByLocalName(rels, 'Relationship')) {
        const id = relationship.getAttribute('Id')
        const target = relationship.getAttribute('Target')
        if (id && target) {
            targets.set(id, relationshipTarget('xl', target))
        }
    }
    return elementsByLocalName(workbook, 'sheet')
        .map((sheet) => {
            const id = attributeByLocalName(sheet, 'id')
            const target = id ? targets.get(id) : undefined
            if (!target) {
                return null
            }
            return {
                name: sheet.getAttribute('name') || 'Sheet',
                target,
            }
        })
        .filter((sheet): sheet is SheetPart => sheet !== null)
}

async function sharedStrings(zip: JSZip): Promise<string[]> {
    const xml = await readZipText(zip, 'xl/sharedStrings.xml')
    if (!xml) {
        return []
    }
    const document = parseXml(xml)
    return elementsByLocalName(document, 'si').map((item) =>
        elementsByLocalName(item, 't')
            .map((text) => text.textContent ?? '')
            .join(''),
    )
}

async function workbookStyles(
    zip: JSZip,
): Promise<Map<string, { id: string; code: string | null }>> {
    const xml = await readZipText(zip, 'xl/styles.xml')
    const styles = new Map<string, { id: string; code: string | null }>()
    if (!xml) {
        return styles
    }
    const document = parseXml(xml)
    const customFormats = new Map<string, string>()
    for (const format of elementsByLocalName(document, 'numFmt')) {
        const id = format.getAttribute('numFmtId')
        const code = format.getAttribute('formatCode')
        if (id && code) {
            customFormats.set(id, code)
        }
    }
    const cellXfs = firstElementByLocalName(document, 'cellXfs')
    if (!cellXfs) {
        return styles
    }
    directElementsByLocalName(cellXfs, 'xf').forEach((format, index) => {
        const id = format.getAttribute('numFmtId') || '0'
        styles.set(String(index), {
            id,
            code: customFormats.get(id) ?? builtInNumberFormats().get(id) ?? null,
        })
    })
    return styles
}

function builtInNumberFormats(): Map<string, string> {
    return new Map([
        ['0', 'General'],
        ['1', '0'],
        ['2', '0.00'],
        ['9', '0%'],
        ['10', '0.00%'],
        ['14', 'm/d/yy'],
        ['22', 'm/d/yy h:mm'],
        ['37', '#,##0 ;(#,##0)'],
        ['38', '#,##0 ;[Red](#,##0)'],
        ['39', '#,##0.00;(#,##0.00)'],
        ['40', '#,##0.00;[Red](#,##0.00)'],
    ])
}

function cellValue(cell: XmlElement, strings: string[]): CellInspection {
    const formula = firstElementByLocalName(cell, 'f')?.textContent ?? null
    const type = cell.getAttribute('t')
    const style = cell.getAttribute('s')
    let value: string | number | boolean | null = null
    if (formula) {
        value = `=${formula}`
    } else if (type === 'inlineStr') {
        value = elementsByLocalName(cell, 't')
            .map((text) => text.textContent ?? '')
            .join('')
    } else {
        const raw = firstElementByLocalName(cell, 'v')?.textContent ?? ''
        if (type === 's') {
            value = strings[Number(raw)] ?? raw
        } else if (type === 'b') {
            value = raw === '1'
        } else if (raw.length > 0 && Number.isFinite(Number(raw))) {
            value = Number(raw)
        } else {
            value = raw || null
        }
    }
    return {
        address: cell.getAttribute('r') || '',
        value,
        formula: formula ? `=${formula}` : null,
        style,
        numberFormatId: null,
        numberFormat: null,
    }
}

async function inspectXlsx(path: string): Promise<Record<string, unknown>> {
    const zip = await loadZip(path)
    const strings = await sharedStrings(zip)
    const styles = await workbookStyles(zip)
    const sheets: SheetInspection[] = []
    for (const sheet of await workbookSheets(zip)) {
        const xml = await readZipText(zip, sheet.target)
        if (!xml) {
            continue
        }
        const document = parseXml(xml)
        const cells = elementsByLocalName(document, 'c').map((cell) => {
            const inspection = cellValue(cell, strings)
            const style = inspection.style ? styles.get(inspection.style) : undefined
            return {
                ...inspection,
                numberFormatId: style?.id ?? null,
                numberFormat: style?.code ?? null,
            }
        })
        sheets.push({
            name: sheet.name,
            cells,
            mergedCells: elementsByLocalName(document, 'mergeCell')
                .map((cell) => cell.getAttribute('ref') || '')
                .filter(Boolean),
        })
    }
    const chartParts = zipFileNames(zip).filter((name) => /^xl\/charts\/chart\d+\.xml$/.test(name))
    const validation = await validateOfficePackage(path, [
        '[Content_Types].xml',
        '_rels/.rels',
        'xl/workbook.xml',
    ])
    const issues = [
        ...validation.errors,
        ...sheets.flatMap((sheet) =>
            sheet.cells
                .filter(
                    (cell) => cell.formula && /\bREF!|#DIV\/0!|#VALUE!|#NAME\?/i.test(cell.formula),
                )
                .map(
                    (cell) =>
                        `${sheet.name}!${cell.address} has suspicious formula ${cell.formula}`,
                ),
        ),
        ...sheets
            .filter((sheet) => sheet.cells.length === 0)
            .map((sheet) => `${sheet.name} has no populated cells`),
    ]
    const lines = sheets.flatMap((sheet) => [
        `Sheet ${sheet.name}`,
        ...sheet.cells.map((cell) => {
            const formula = cell.formula ? ` formula=${cell.formula}` : ''
            const style = cell.style ? ` style=${cell.style}` : ''
            const numberFormat = cell.numberFormat ? ` numberFormat=${cell.numberFormat}` : ''
            return `${cell.address}: ${cell.value ?? ''}${formula}${style}${numberFormat}`
        }),
        sheet.mergedCells.length > 0 ? `Merged: ${sheet.mergedCells.join(', ')}` : '',
    ])
    return {
        text: [...lines.filter(Boolean), `Charts: ${chartParts.length}`].join('\n'),
        sheets,
        charts: chartParts,
        validation,
        issues,
    }
}

function normalizeEditInput(raw: unknown): WorkbookEdit[] {
    if (!Array.isArray(raw)) {
        fail('Edits must be a JSON array')
    }
    return raw.map((entry) => {
        if (!isRecord(entry)) {
            fail('Each edit must be an object')
        }
        const explicitType = typeof entry.type === 'string' ? entry.type : ''
        const type =
            explicitType === 'addSheet' || explicitType === 'deleteSheet'
                ? explicitType
                : explicitType === 'deleteCell' || entry.delete === true
                  ? 'deleteCell'
                  : 'setCell'
        if ((type === 'setCell' || type === 'deleteCell') && typeof entry.cell !== 'string') {
            fail('Cell edits must include a cell address')
        }
        if (type === 'addSheet' && typeof entry.name !== 'string') {
            fail('addSheet edits must include a name')
        }
        if (
            type === 'deleteSheet' &&
            typeof entry.sheet !== 'string' &&
            typeof entry.name !== 'string'
        ) {
            fail('deleteSheet edits must include sheet or name')
        }
        if (entry.formula !== undefined && typeof entry.formula !== 'string') {
            fail('Formula edits must use a string formula')
        }
        return {
            type,
            sheet: typeof entry.sheet === 'string' ? entry.sheet : undefined,
            name: typeof entry.name === 'string' ? entry.name : undefined,
            rows: Array.isArray(entry.rows) ? normalizeRows(entry.rows) : undefined,
            cell: typeof entry.cell === 'string' ? splitAddress(entry.cell).normalized : undefined,
            value: entry.value,
            formula: entry.formula,
        }
    })
}

function ensureSheetData(document: XmlDocument): XmlElement {
    const existing = firstElementByLocalName(document, 'sheetData')
    if (existing) {
        return existing
    }
    const worksheet = document.documentElement
    if (!worksheet) {
        fail('Worksheet XML has no document element')
    }
    return appendElement({
        document,
        parent: worksheet,
        namespace: spreadsheetNamespace,
        name: 'sheetData',
    })
}

function ensureRow(document: XmlDocument, sheetData: XmlElement, rowNumber: number): XmlElement {
    const existing = directElementsByLocalName(sheetData, 'row').find(
        (row) => row.getAttribute('r') === String(rowNumber),
    )
    if (existing) {
        return existing
    }
    const row = document.createElementNS(spreadsheetNamespace, 'row')
    row.setAttribute('r', String(rowNumber))
    sheetData.appendChild(row)
    return row
}

function ensureCell(document: XmlDocument, row: XmlElement, address: string): XmlElement {
    const existing = directElementsByLocalName(row, 'c').find(
        (cell) => cell.getAttribute('r') === address,
    )
    if (existing) {
        return existing
    }
    const cell = document.createElementNS(spreadsheetNamespace, 'c')
    cell.setAttribute('r', address)
    row.appendChild(cell)
    return cell
}

function applyCellValue(document: XmlDocument, cell: XmlElement, edit: WorkbookEdit): void {
    const style = cell.getAttribute('s')
    clearChildren(cell)
    cell.removeAttribute('t')
    if (style) {
        cell.setAttribute('s', style)
    }
    if (edit.formula !== undefined) {
        const formula = edit.formula.startsWith('=') ? edit.formula.slice(1) : edit.formula
        appendElement({
            document,
            parent: cell,
            namespace: spreadsheetNamespace,
            name: 'f',
            text: formula,
        })
        return
    }
    if (typeof edit.value === 'boolean') {
        cell.setAttribute('t', 'b')
        appendElement({
            document,
            parent: cell,
            namespace: spreadsheetNamespace,
            name: 'v',
            text: edit.value ? '1' : '0',
        })
        return
    }
    if (typeof edit.value === 'number' && Number.isFinite(edit.value)) {
        appendElement({
            document,
            parent: cell,
            namespace: spreadsheetNamespace,
            name: 'v',
            text: String(edit.value),
        })
        return
    }
    cell.setAttribute('t', 'inlineStr')
    const inlineString = appendElement({
        document,
        parent: cell,
        namespace: spreadsheetNamespace,
        name: 'is',
    })
    const text = appendElement({
        document,
        parent: inlineString,
        namespace: spreadsheetNamespace,
        name: 't',
    })
    text.setAttribute('xml:space', 'preserve')
    setElementText(text, String(edit.value ?? ''))
}

function updateDimension(document: XmlDocument): void {
    const cells = elementsByLocalName(document, 'c')
        .map((cell) => cell.getAttribute('r') || '')
        .filter(Boolean)
        .map(splitAddress)
    if (cells.length === 0) {
        return
    }
    const minColumn = Math.min(...cells.map((cell) => columnIndex(cell.column)))
    const minRow = Math.min(...cells.map((cell) => cell.row))
    const maxColumn = Math.max(...cells.map((cell) => columnIndex(cell.column)))
    const maxRow = Math.max(...cells.map((cell) => cell.row))
    const dimension = firstElementByLocalName(document, 'dimension')
    if (dimension) {
        dimension.setAttribute(
            'ref',
            `${columnName(minColumn)}${minRow}:${columnName(maxColumn)}${maxRow}`,
        )
    }
}

async function addSheet(
    zip: JSZip,
    input: { name: string; rows?: SheetInput['rows'] },
): Promise<void> {
    validateSheetName(input.name)
    const sheets = await workbookSheets(zip)
    if (sheets.some((sheet) => sheet.name.toLowerCase() === input.name.toLowerCase())) {
        fail(`Duplicate sheet name: ${input.name}`)
    }
    const nextIndex =
        Math.max(
            0,
            ...zipFileNames(zip)
                .map((name) => /^xl\/worksheets\/sheet(\d+)\.xml$/.exec(name)?.[1])
                .filter((value): value is string => value !== undefined)
                .map(Number),
        ) + 1
    const sheetTarget = `xl/worksheets/sheet${nextIndex}.xml`
    const workbookXml = await readZipText(zip, 'xl/workbook.xml')
    const relsXml = await readZipText(zip, 'xl/_rels/workbook.xml.rels')
    const typesXml = await readZipText(zip, '[Content_Types].xml')
    if (!workbookXml || !relsXml || !typesXml) {
        fail('Workbook package is missing required XML parts')
    }
    const workbook = parseXml(workbookXml)
    const rels = parseXml(relsXml)
    const sheetsElement = firstElementByLocalName(workbook, 'sheets')
    const relsRoot = rels.documentElement
    if (!sheetsElement || !relsRoot) {
        fail('Workbook XML is missing sheet metadata')
    }
    const nextSheetId =
        Math.max(
            0,
            ...elementsByLocalName(workbook, 'sheet')
                .map((sheet) => Number(sheet.getAttribute('sheetId') ?? 0))
                .filter(Number.isFinite),
        ) + 1
    const nextRid =
        Math.max(
            0,
            ...elementsByLocalName(rels, 'Relationship')
                .map(
                    (relationship) => /^rId(\d+)$/.exec(relationship.getAttribute('Id') ?? '')?.[1],
                )
                .filter((value): value is string => value !== undefined)
                .map(Number),
        ) + 1
    const relationshipId = `rId${nextRid}`
    const sheetElement = workbook.createElementNS(spreadsheetNamespace, 'sheet')
    sheetElement.setAttribute('name', input.name)
    sheetElement.setAttribute('sheetId', String(nextSheetId))
    sheetElement.setAttribute('r:id', relationshipId)
    sheetsElement.appendChild(sheetElement)
    const relationship = rels.createElementNS(packageRelationshipsNamespace, 'Relationship')
    relationship.setAttribute('Id', relationshipId)
    relationship.setAttribute(
        'Type',
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet',
    )
    relationship.setAttribute('Target', `worksheets/sheet${nextIndex}.xml`)
    relsRoot.appendChild(relationship)
    writeZipText(zip, 'xl/workbook.xml', serializeXml(workbook))
    writeZipText(zip, 'xl/_rels/workbook.xml.rels', serializeXml(rels))
    writeZipText(
        zip,
        '[Content_Types].xml',
        typesXml.replace(
            '</Types>',
            `<Override PartName="/${sheetTarget}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
        ),
    )
    writeZipText(
        zip,
        sheetTarget,
        createWorksheetXml({
            name: input.name,
            rows: input.rows ?? [['']],
            autoFilter: false,
            freezePane: false,
        }),
    )
}

async function deleteSheet(zip: JSZip, name: string): Promise<void> {
    const sheets = await workbookSheets(zip)
    if (sheets.length <= 1) {
        fail('Cannot delete the only worksheet')
    }
    const sheet = sheets.find((entry) => entry.name === name)
    if (!sheet) {
        fail(`Sheet not found: ${name}`)
    }
    const workbookXml = await readZipText(zip, 'xl/workbook.xml')
    const relsXml = await readZipText(zip, 'xl/_rels/workbook.xml.rels')
    const typesXml = await readZipText(zip, '[Content_Types].xml')
    if (!workbookXml || !relsXml || !typesXml) {
        fail('Workbook package is missing required XML parts')
    }
    const workbook = parseXml(workbookXml)
    const rels = parseXml(relsXml)
    const sheetElement = elementsByLocalName(workbook, 'sheet').find(
        (entry) => entry.getAttribute('name') === name,
    )
    const relationshipId = sheetElement ? attributeByLocalName(sheetElement, 'id') : null
    if (!sheetElement || !relationshipId) {
        fail(`Sheet metadata not found: ${name}`)
    }
    sheetElement.parentNode?.removeChild(sheetElement)
    const relationship = elementsByLocalName(rels, 'Relationship').find(
        (entry) => entry.getAttribute('Id') === relationshipId,
    )
    relationship?.parentNode?.removeChild(relationship)
    zip.remove(sheet.target)
    writeZipText(zip, 'xl/workbook.xml', serializeXml(workbook))
    writeZipText(zip, 'xl/_rels/workbook.xml.rels', serializeXml(rels))
    writeZipText(
        zip,
        '[Content_Types].xml',
        typesXml.replace(
            new RegExp(
                `<Override PartName="/${sheet.target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*/>`,
            ),
            '',
        ),
    )
}

async function editXlsx(path: string, edits: WorkbookEdit[]): Promise<Record<string, number>> {
    if (edits.length === 0) {
        fail('At least one edit is required')
    }
    const zip = await loadZip(path)
    let editCount = 0
    let sheetAddCount = 0
    let sheetDeleteCount = 0
    for (const edit of edits) {
        if (edit.type === 'addSheet') {
            if (!edit.name) {
                fail('addSheet edits must include a name')
            }
            await addSheet(zip, {
                name: edit.name,
                rows: edit.rows,
            })
            sheetAddCount += 1
        } else if (edit.type === 'deleteSheet') {
            await deleteSheet(zip, edit.sheet ?? edit.name ?? '')
            sheetDeleteCount += 1
        }
    }
    const sheets = await workbookSheets(zip)
    const editsBySheet = new Map<string, WorkbookEdit[]>()
    for (const edit of edits) {
        if (edit.type === 'addSheet' || edit.type === 'deleteSheet') {
            continue
        }
        const sheetName = edit.sheet ?? sheets[0]?.name
        if (!sheetName) {
            fail('Workbook has no sheets')
        }
        const current = editsBySheet.get(sheetName) ?? []
        current.push(edit)
        editsBySheet.set(sheetName, current)
    }
    for (const [sheetName, sheetEdits] of editsBySheet.entries()) {
        const sheet = sheets.find((entry) => entry.name === sheetName)
        if (!sheet) {
            fail(`Sheet not found: ${sheetName}`)
        }
        const xml = await readZipText(zip, sheet.target)
        if (!xml) {
            fail(`Worksheet XML not found: ${sheet.target}`)
        }
        const document = parseXml(xml)
        const sheetData = ensureSheetData(document)
        for (const edit of sheetEdits) {
            if (!edit.cell) {
                fail('Cell edit is missing a cell address')
            }
            const address = splitAddress(edit.cell)
            const row = ensureRow(document, sheetData, address.row)
            const cell = ensureCell(document, row, address.normalized)
            if (edit.type === 'deleteCell') {
                cell.parentNode?.removeChild(cell)
            } else {
                applyCellValue(document, cell, edit)
            }
            editCount += 1
        }
        updateDimension(document)
        writeZipText(zip, sheet.target, serializeXml(document))
    }
    await saveZip(zip, path)
    return {
        editCount,
        sheetAddCount,
        sheetDeleteCount,
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
        await createXlsx(path, normalizeSheets(content))
        printJson({
            operation: command.operation,
            format: 'xlsx',
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
            format: 'xlsx',
            root,
            path: requiredOption(command.options, 'path'),
            ...(await inspectXlsx(path)),
        })
        return
    }
    if (command.operation === 'validate') {
        printJson({
            operation: command.operation,
            format: 'xlsx',
            root,
            path: requiredOption(command.options, 'path'),
            validation: await validateOfficePackage(path, [
                '[Content_Types].xml',
                '_rels/.rels',
                'xl/workbook.xml',
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
            format: 'xlsx',
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
        const edits = normalizeEditInput(
            await parseJsonInput<unknown>({
                options: command.options,
                root,
                jsonOption: 'edits-json',
                fileOption: 'edits-file',
                fallback: [],
            }),
        )
        printJson({
            operation: command.operation,
            format: 'xlsx',
            root,
            path: requiredOption(command.options, 'path'),
            ...(await editXlsx(path, edits)),
        })
        return
    }
    fail('Operation must be create, inspect, edit, validate, or render')
}

main().catch(printError)
