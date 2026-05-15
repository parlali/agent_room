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
    optionalOption,
    parseCommand,
    parseJson,
    parseXml,
    printError,
    printJson,
    readZipText,
    requiredOption,
    requireWorkspace,
    resolveRoomPath,
    saveZip,
    serializeXml,
    setElementText,
    type XmlDocument,
    type XmlElement,
    writeZipText,
    zipFileNames,
} from '../../.shared/office.ts'

interface SheetInput {
    name: string
    rows: unknown[][]
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
    sheet?: string
    cell: string
    value?: unknown
    formula?: string
}

const spreadsheetNamespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const relationshipsNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const packageRelationshipsNamespace = 'http://schemas.openxmlformats.org/package/2006/relationships'

/**
 * Escape XML special characters in a string.
 *
 * @param value - The input text to escape
 * @returns The input with `&`, `<`, `>`, and `"` replaced by `&amp;`, `&lt;`, `&gt;`, and `&quot;` respectively
 */
function escapeXml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
}

/**
 * Normalize various input shapes into a consistent array of sheet descriptors for workbook creation.
 *
 * Accepts either an object with a `sheets` property or a direct array of sheet-like entries. Each sheet entry may be a record with `name` and either `rows` or `data`; rows may be arrays or scalar values. When the source is missing or an empty array, produces a single sheet named "Sheet 1" containing one empty cell.
 *
 * @param value - Input describing sheets: an object with a `sheets` array, or an array of sheet-like records/values.
 * @returns An array of `SheetInput` where each item has a `name` (trimmed to at most 31 characters) and `rows` (an array of rows, each row normalized to an array of cell values).
 */
function normalizeSheets(value: unknown): SheetInput[] {
    const source = isRecord(value) ? value.sheets : value
    const sheets =
        Array.isArray(source) && source.length > 0 ? source : [{ name: 'Sheet 1', rows: [['']] }]
    return sheets.map((sheet, index) => {
        const record = isRecord(sheet) ? sheet : {}
        const rows = Array.isArray(record.rows)
            ? record.rows
            : Array.isArray(record.data)
              ? record.data
              : []
        return {
            name: String(record.name || `Sheet ${index + 1}`).slice(0, 31),
            rows: rows.map((row) => (Array.isArray(row) ? row : [row])),
        }
    })
}

/**
 * Convert a zero-based column index to Excel-style column letters.
 *
 * @param index - Zero-based column index (0 => "A")
 * @returns The corresponding column name (e.g., 0 -> "A", 25 -> "Z", 26 -> "AA")
 */
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

/**
 * Convert Excel-style column letters to a zero-based column index.
 *
 * @param column - Column letters (e.g., "A", "Z", "AA"); case-insensitive
 * @returns The zero-based column index (`0` for "A", `25` for "Z", `26` for "AA")
 */
function columnIndex(column: string): number {
    let value = 0
    for (const character of column.toUpperCase()) {
        value = value * 26 + character.charCodeAt(0) - 64
    }
    return value - 1
}

/**
 * Parse an Excel cell address into its column letters, numeric row, and normalized form.
 *
 * @param address - Cell address in A1 notation (e.g., "B3", "AA12"); whitespace is trimmed.
 * @returns An object with `column` (uppercase letters), `row` (numeric row index), and `normalized` (e.g., `"A1"`).
 * @throws If `address` is not a valid A1-style cell address.
 */
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

/**
 * Generate a SpreadsheetML `<c>` element for a single worksheet cell.
 *
 * @param address - The cell address (e.g., "A1") to use in the `r` attribute
 * @param value - Cell content: booleans become `t="b"` with `<v>1|0>`, finite numbers become numeric `<v>`, strings starting with `=` become a formula `<f>` (formula text omits the leading `=`), and all other values become an inline string (`t="inlineStr"`) with XML-escaped text
 * @returns The XML string for the `<c>` element representing the cell at `address`
 */
function cellXml(address: string, value: unknown): string {
    if (typeof value === 'boolean') {
        return `<c r="${address}" t="b"><v>${value ? 1 : 0}</v></c>`
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return `<c r="${address}"><v>${value}</v></c>`
    }
    const text = String(value ?? '')
    if (text.startsWith('=')) {
        return `<c r="${address}"><f>${escapeXml(text.slice(1))}</f></c>`
    }
    return `<c r="${address}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`
}

/**
 * Generate a SpreadsheetML worksheet XML document for the provided rows.
 *
 * @param rows - Matrix of cell values; each element is a row (array) of cell values (booleans, numbers, strings, formulas, or null/undefined)
 * @returns The worksheet XML as a string, including a `<dimension>` that spans from `A1` to the last column/row and a `<sheetData>` section with the rows and cells
 */
function createWorksheetXml(rows: unknown[][]): string {
    const rowXml = rows
        .map((row, rowIndex) => {
            const cells = row
                .map((value, columnIndexValue) =>
                    cellXml(`${columnName(columnIndexValue)}${rowIndex + 1}`, value),
                )
                .join('')
            return `<row r="${rowIndex + 1}">${cells}</row>`
        })
        .join('')
    const maxColumn = Math.max(0, ...rows.map((row) => row.length - 1))
    const dimension = rows.length > 0 ? `A1:${columnName(maxColumn)}${rows.length}` : 'A1'
    return [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        `<worksheet xmlns="${spreadsheetNamespace}" xmlns:r="${relationshipsNamespace}">`,
        `<dimension ref="${dimension}"/>`,
        `<sheetData>${rowXml}</sheetData>`,
        '</worksheet>',
    ].join('')
}

/**
 * Creates a minimal `.xlsx` file at the given path containing the provided sheets.
 *
 * Writes the required OOXML package parts (content types, package/workbook relationships, workbook, styles)
 * and one worksheet part per sheet, using the sheet names and row data supplied.
 *
 * @param path - Filesystem path where the `.xlsx` file will be written
 * @param sheets - Array of sheet descriptors; each entry provides a sheet `name` and `rows` (cells)
 */
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
    writeZipText(
        zip,
        'xl/styles.xml',
        `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="${spreadsheetNamespace}"><fonts count="1"><font/></fonts><fills count="1"><fill/></fills><borders count="1"><border/></borders><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellXfs></styleSheet>`,
    )
    sheets.forEach((sheet, index) => {
        writeZipText(zip, `xl/worksheets/sheet${index + 1}.xml`, createWorksheetXml(sheet.rows))
    })
    await saveZip(zip, path)
}

/**
 * Normalize an OOXML relationship target path relative to a base path.
 *
 * @param base - The base path to prepend for relative targets (e.g., "xl").
 * @param target - The relationship target as found in the .rels file.
 * @returns The normalized package path: if `target` starts with `/` the leading slash is removed; if `target` starts with `xl/` it is returned unchanged; otherwise `base` and `target` are joined and any duplicate slashes are collapsed.
 */
function relationshipTarget(base: string, target: string): string {
    if (target.startsWith('/')) {
        return target.slice(1)
    }
    if (target.startsWith('xl/')) {
        return target
    }
    return `${base}/${target}`.replaceAll('//', '/')
}

/**
 * Resolve worksheet parts and their ZIP targets from an XLSX archive.
 *
 * If the workbook and its relationships are present, returns sheets declared in the workbook
 * whose relationship IDs map to worksheet file targets; sheets without a mapped target are skipped.
 * If the workbook or its rels file is missing, enumerates worksheet files in the ZIP and
 * returns them as `Sheet 1`, `Sheet 2`, …
 *
 * @param zip - The JSZip archive representing the .xlsx package
 * @returns An array of sheet descriptors where each item contains the sheet `name` and the worksheet XML `target` path inside the ZIP
 */
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

/**
 * Extracts the workbook's shared string table from the ZIP and returns the shared strings in document order.
 *
 * @param zip - The JSZip archive representing the .xlsx package
 * @returns An array of shared string values (each is the concatenation of all `<t>` nodes within an `<si>`); returns an empty array if the shared strings part is missing
 */
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

/**
 * Builds a lookup of workbook cell format entries to their number format id and resolved format code.
 *
 * Reads `xl/styles.xml` and maps each `<xf>` entry under `<cellXfs>` by its index to an object containing the `numFmtId` and the corresponding format code (from custom formats or built-in formats). If `xl/styles.xml` is absent or contains no `<cellXfs>`, an empty map is returned.
 *
 * @returns A map keyed by the `<xf>` index as a string; each value is an object with `id` (the `numFmtId`) and `code` (the format code string, or `null` if not found).
 */
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

/**
 * Provides common built-in Excel number format IDs mapped to their format code strings.
 *
 * @returns A Map where each key is a built-in `numFmtId` (as a string) and each value is the corresponding format code (for example, `'14' -> 'm/d/yy'`).
 */
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

/**
 * Produces a CellInspection object describing the contents and metadata of a worksheet `<c>` XML element.
 *
 * Determines the cell's address, resolved value, formula (if present), and style. The returned `value` is:
 * - a string that begins with `=` when the cell contains a formula;
 * - the concatenation of `<t>` text nodes for inline strings;
 * - a resolved shared string when `t="s"`;
 * - a boolean when `t="b"`;
 * - a JavaScript `number` when the cell's `<v>` text parses to a finite number;
 * - `null` for empty text values.
 *
 * @param cell - The `<c>` XML element for the cell.
 * @param strings - Shared strings array used to resolve `t="s"` cell values (indexed by the `<v>` text).
 * @returns A `CellInspection` containing:
 * - `address`: the `r` attribute of the cell (or empty string),
 * - `value`: the resolved cell value (string | number | boolean | null),
 * - `formula`: the formula text including a leading `=` when present, otherwise `null`,
 * - `style`: the cell `s` attribute if present,
 * - `numberFormatId` and `numberFormat`: set to `null` (to be populated later).
 */
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

/**
 * Inspects an `.xlsx` file and extracts sheet-level cell data, merged ranges, and chart part paths.
 *
 * @param path - Filesystem path to the `.xlsx` file to inspect
 * @returns An object with:
 *  - `text`: a human-readable multiline summary of sheets and cells,
 *  - `sheets`: an array of sheet inspection objects (name, cells, mergedCells),
 *  - `charts`: an array of chart part file paths found in the package
 */
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
    }
}

/**
 * Normalize a JSON-encoded edits payload into a validated array of workbook edit objects.
 *
 * Parses `value` as a JSON array of edit entries and validates each entry's shape:
 * each entry must be an object with a `cell` string (Excel address) and may include
 * `sheet`, `value`, and `formula`. The returned edits use a normalized cell address.
 *
 * @param value - A JSON string encoding an array of edit objects (or `undefined` to treat as `[]`)
 * @returns An array of `WorkbookEdit` with `sheet` (optional), `cell` (normalized A1 address), `value`, and `formula`
 */
function normalizeEdits(value: string | undefined): WorkbookEdit[] {
    const raw = parseJson<unknown>(value, [])
    if (!Array.isArray(raw)) {
        fail('Edits must be a JSON array')
    }
    return raw.map((entry) => {
        if (!isRecord(entry)) {
            fail('Each edit must be an object')
        }
        if (typeof entry.cell !== 'string') {
            fail('Each edit must include a cell address')
        }
        if (entry.formula !== undefined && typeof entry.formula !== 'string') {
            fail('Formula edits must use a string formula')
        }
        return {
            sheet: typeof entry.sheet === 'string' ? entry.sheet : undefined,
            cell: splitAddress(entry.cell).normalized,
            value: entry.value,
            formula: entry.formula,
        }
    })
}

/**
 * Return the worksheet's `<sheetData>` element, creating and appending one if it does not exist.
 *
 * @returns The existing or newly created `<sheetData>` XmlElement
 * @throws If the provided document has no root worksheet element
 */
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

/**
 * Get or create the <row> element for the given row number in the worksheet's <sheetData>.
 *
 * @param document - The XML document used to create a new element when needed
 * @param sheetData - The `<sheetData>` element that should contain the row
 * @param rowNumber - The 1-based row number to find or create
 * @returns The `<row>` element whose `r` attribute equals `rowNumber`
 */
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

/**
 * Get or create the `<c>` cell element for the specified cell address within a row.
 *
 * @param document - XML document used to create new elements when needed
 * @param row - The `<row>` element to search for or append the cell to
 * @param address - The cell address (e.g., `A1`) to match or create
 * @returns The `<c>` cell element for `address`, created and appended to `row` if missing
 */
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

/**
 * Update a worksheet `<c>` element to represent the provided edit.
 *
 * Clears existing child nodes of `cell`, preserves its `s` (style) attribute if present,
 * and writes either a formula, boolean, numeric, or inline string value according to `edit`.
 *
 * @param document - The XML document containing `cell`.
 * @param cell - The `<c>` element to modify.
 * @param edit - Edit describing the new cell content. If `edit.formula` is provided, it is written as a formula (a leading `=` is removed if present). Otherwise `edit.value` is written as a boolean (`t="b"` with `1`/`0`), a finite number (`<v>`), or an inline string (`t="inlineStr"` with preserved whitespace).
 */
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

/**
 * Update the worksheet `<dimension>` element so its `ref` spans from `A1` to the furthest occupied cell.
 *
 * If the document contains no cells, no changes are made. The function computes the maximum column and row
 * among all `<c r="...">` cells and sets the `ref` attribute to `A1:{Column}{Row}` (e.g., `A1:Z10`) on the
 * first `<dimension>` element found.
 *
 * @param document - The worksheet XML document to modify in-place
 */
function updateDimension(document: XmlDocument): void {
    const cells = elementsByLocalName(document, 'c')
        .map((cell) => cell.getAttribute('r') || '')
        .filter(Boolean)
        .map(splitAddress)
    if (cells.length === 0) {
        return
    }
    const maxColumn = Math.max(...cells.map((cell) => columnIndex(cell.column)))
    const maxRow = Math.max(...cells.map((cell) => cell.row))
    const dimension = firstElementByLocalName(document, 'dimension')
    if (dimension) {
        dimension.setAttribute('ref', `A1:${columnName(maxColumn)}${maxRow}`)
    }
}

/**
 * Apply a sequence of cell edits to an existing `.xlsx` file, writing modifications back into the package.
 *
 * @param path - Filesystem path to the `.xlsx` package to modify
 * @param editsJson - JSON string representing an array of edit objects; each object must include `cell` (address like `A1`) and may include `sheet` (sheet name), `value`, or `formula`
 * @returns The number of edits that were applied
 * @throws If the parsed edits array is empty
 * @throws If the workbook contains no sheets
 * @throws If a referenced sheet cannot be found
 * @throws If a worksheet XML part for a referenced sheet cannot be read
 */
async function editXlsx(path: string, editsJson: string | undefined): Promise<number> {
    const edits = normalizeEdits(editsJson)
    if (edits.length === 0) {
        fail('At least one edit is required')
    }
    const zip = await loadZip(path)
    const sheets = await workbookSheets(zip)
    let editCount = 0
    const editsBySheet = new Map<string, WorkbookEdit[]>()
    for (const edit of edits) {
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
            const address = splitAddress(edit.cell)
            const row = ensureRow(document, sheetData, address.row)
            const cell = ensureCell(document, row, address.normalized)
            applyCellValue(document, cell, edit)
            editCount += 1
        }
        updateDimension(document)
        writeZipText(zip, sheet.target, serializeXml(document))
    }
    await saveZip(zip, path)
    return editCount
}

/**
 * CLI entrypoint that parses arguments and performs create, inspect, or edit operations on `.xlsx` workbooks.
 *
 * Parses command-line options, resolves workspace paths, and dispatches:
 * - create: writes a new workbook from provided sheet data and prints operation details as JSON
 * - inspect: reads a workbook and prints an inspection report as JSON
 * - edit: applies JSON-described edits to a workbook and prints the edit count as JSON
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
        await createXlsx(path, normalizeSheets(parseJson(command.options.get('content-json'), {})))
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
    if (command.operation === 'edit') {
        requireWorkspace(root, command.operation)
        printJson({
            operation: command.operation,
            format: 'xlsx',
            root,
            path: requiredOption(command.options, 'path'),
            editCount: await editXlsx(path, command.options.get('edits-json')),
        })
        return
    }
    fail('Operation must be create, inspect, or edit')
}

main().catch(printError)
