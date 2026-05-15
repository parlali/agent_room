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
        const rows = Array.isArray(record.rows)
            ? record.rows
            : Array.isArray(record.data)
              ? record.data
              : []
        const rawName =
            record.name === undefined || record.name === null
                ? `Sheet ${index + 1}`
                : String(record.name)
        const name = rawName.trim()
        if (!name) {
            fail('Sheet name cannot be empty')
        }
        if (name.length > 31) {
            fail(`Sheet name cannot exceed 31 characters: ${name}`)
        }
        if ([...name].some((character) => '[]:*?/\\'.includes(character))) {
            fail(`Invalid sheet name: ${name}`)
        }
        const comparableName = name.toLowerCase()
        if (seenNames.has(comparableName)) {
            fail(`Duplicate sheet name: ${name}`)
        }
        seenNames.add(comparableName)
        return {
            name,
            rows: rows.map((row) => (Array.isArray(row) ? row : [row])),
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
