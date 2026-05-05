import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import * as XLSX from 'xlsx'
import { ensureShellWritableDirectory } from '../shell-sandbox'
import type { Replacement, WorkbookCellEdit, WorkbookChartInput, WorkbookSheetInput } from './types'
import { boundExtractedText, parseJson, xmlEscape } from './xml'
import { writeWorkspaceFile } from './paths'

export function normalizeWorkbookEdits(value: unknown): Array<Replacement | WorkbookCellEdit> {
    const parsed = parseJson<unknown>(value, [])
    if (!Array.isArray(parsed)) {
        throw new Error('Workbook edits must be a JSON array')
    }
    return parsed.map((entry) => {
        if (!entry || typeof entry !== 'object') {
            throw new Error('Each workbook edit must be an object')
        }
        const record = entry as Record<string, unknown>
        if (typeof record.oldText === 'string' && typeof record.newText === 'string') {
            return {
                oldText: record.oldText,
                newText: record.newText,
            }
        }
        if (typeof record.cell === 'string' && record.cell.trim()) {
            return {
                sheet:
                    typeof record.sheet === 'string' && record.sheet.trim()
                        ? record.sheet.trim()
                        : undefined,
                cell: record.cell.trim(),
                value: record.value,
                formula:
                    typeof record.formula === 'string' && record.formula.trim()
                        ? record.formula.trim()
                        : undefined,
            }
        }
        throw new Error('Each workbook edit must include oldText/newText or cell/value')
    })
}
export function normalizeWorkbook(value: unknown): WorkbookSheetInput[] {
    const parsed = parseJson<unknown>(value, [])
    const sheetEntries = Array.isArray(parsed)
        ? parsed
        : parsed &&
            typeof parsed === 'object' &&
            Array.isArray((parsed as Record<string, unknown>).sheets)
          ? ((parsed as Record<string, unknown>).sheets as unknown[])
          : null
    if (!sheetEntries) {
        throw new Error('Workbook JSON must be an array of sheets')
    }
    return sheetEntries.map((entry, index) => {
        if (!entry || typeof entry !== 'object') {
            throw new Error('Each sheet must be an object')
        }
        const record = entry as Record<string, unknown>
        const rows = Array.isArray(record.rows)
            ? record.rows
            : Array.isArray(record.data)
              ? record.data
              : null
        if (!rows) {
            throw new Error('Each sheet must include rows as an array')
        }
        const charts = Array.isArray(record.charts)
            ? record.charts
            : record.chart && typeof record.chart === 'object'
              ? [record.chart]
              : []
        return {
            name:
                typeof record.name === 'string' && record.name.trim()
                    ? record.name.trim()
                    : `Sheet ${index + 1}`,
            rows: rows.map((row) => (Array.isArray(row) ? row : [row])),
            charts: charts.map((chart) => normalizeWorkbookChart(chart, record.name, rows)),
        }
    })
}

function chartCellsFrom(value: unknown): string | null {
    if (typeof value === 'string' && value.trim()) {
        return value.trim()
    }
    if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>
        if (typeof record.cells === 'string' && record.cells.trim()) {
            const cells = record.cells.trim()
            return typeof record.sheet === 'string' && record.sheet.trim()
                ? `'${record.sheet.trim().replaceAll("'", "''")}'!${cells}`
                : cells
        }
    }
    return null
}

function inferChartRange(rows: unknown[][], columnIndex: number): string {
    if (rows.length < 2) {
        throw new Error('Workbook chart ranges require at least one header row and one data row')
    }
    const column = XLSX.utils.encode_col(columnIndex)
    return `${column}2:${column}${rows.length}`
}

function normalizeWorkbookChart(
    value: unknown,
    sheetNameValue: unknown,
    rows: unknown[][],
): WorkbookChartInput {
    if (!value || typeof value !== 'object') {
        throw new Error('Each workbook chart must be an object')
    }
    const record = value as Record<string, unknown>
    const firstSeries =
        Array.isArray(record.series) && record.series[0] && typeof record.series[0] === 'object'
            ? (record.series[0] as Record<string, unknown>)
            : null
    const sheetName =
        typeof sheetNameValue === 'string' && sheetNameValue.trim()
            ? sheetNameValue.trim()
            : 'Sheet'
    const labelsRange =
        chartCellsFrom(record.labelsRange) ??
        chartCellsFrom(record.categories) ??
        inferChartRange(rows, 0)
    const valuesRange =
        chartCellsFrom(record.valuesRange) ??
        chartCellsFrom(firstSeries) ??
        inferChartRange(rows, Math.max(0, (rows[0]?.length ?? 1) - 1))
    return {
        type: record.type === 'line' || record.type === 'pie' ? record.type : 'bar',
        title:
            typeof record.title === 'string' && record.title.trim()
                ? record.title.trim()
                : undefined,
        seriesName:
            typeof record.seriesName === 'string' && record.seriesName.trim()
                ? record.seriesName.trim()
                : typeof firstSeries?.name === 'string' && firstSeries.name.trim()
                  ? firstSeries.name.trim()
                  : String(rows[0]?.[Math.max(0, (rows[0]?.length ?? 1) - 1)] ?? sheetName),
        labelsRange,
        valuesRange,
        anchor:
            typeof record.anchor === 'string' && record.anchor.trim()
                ? record.anchor.trim()
                : undefined,
    }
}

function normalizeCell(value: unknown): unknown {
    if (typeof value === 'string' && value.startsWith('=')) {
        return {
            t: 'n',
            f: value.slice(1),
            v: 0,
        }
    }
    return value
}

function numberFromCell(sheet: XLSX.WorkSheet, address: string): number | null {
    const cell = sheet[address]
    if (!cell) {
        return null
    }
    if (typeof cell.v === 'number') {
        return cell.v
    }
    if (typeof cell.v === 'string') {
        const value = Number(cell.v)
        return Number.isFinite(value) ? value : null
    }
    return null
}

function evaluateSimpleFormula(sheet: XLSX.WorkSheet, formula: string): number | null {
    const match = formula.trim().match(/^([A-Z]+[0-9]+)\s*([*+\-/])\s*([A-Z]+[0-9]+)$/i)
    if (!match) {
        return null
    }
    const left = numberFromCell(sheet, match[1]!.toUpperCase())
    const right = numberFromCell(sheet, match[3]!.toUpperCase())
    if (left === null || right === null) {
        return null
    }
    const operator = match[2]
    if (operator === '+') return left + right
    if (operator === '-') return left - right
    if (operator === '*') return left * right
    if (operator === '/') return right === 0 ? null : left / right
    return null
}

function populateFormulaCachedValues(sheet: XLSX.WorkSheet): void {
    for (const address of Object.keys(sheet)) {
        if (address.startsWith('!')) {
            continue
        }
        const cell = sheet[address] as XLSX.CellObject
        if (!cell.f) {
            continue
        }
        const value = evaluateSimpleFormula(sheet, cell.f)
        if (value === null) {
            continue
        }
        cell.t = 'n'
        cell.v = value
        cell.w = undefined
    }
}

function contentTypesWithOverrides(
    xml: string,
    overrides: Array<{ partName: string; contentType: string }>,
): string {
    let next = xml
    for (const override of overrides) {
        if (next.includes(`PartName="${override.partName}"`)) {
            continue
        }
        next = next.replace(
            '</Types>',
            `<Override PartName="${override.partName}" ContentType="${override.contentType}"/></Types>`,
        )
    }
    return next
}

function contentTypesWithRawOverrides(xml: string, overrides: string[]): string {
    let next = xml
    for (const override of overrides) {
        const partName = override.match(/PartName="([^"]+)"/)?.[1]
        if (partName && next.includes(`PartName="${partName}"`)) {
            continue
        }
        next = next.replace('</Types>', `${override}</Types>`)
    }
    return next
}

function nextRelationshipId(xml: string): string {
    let max = 0
    for (const match of xml.matchAll(/Id="rId(\d+)"/g)) {
        max = Math.max(max, Number(match[1]))
    }
    return `rId${max + 1}`
}

function appendRelationship(
    xml: string | undefined,
    input: {
        id: string
        type: string
        target: string
    },
): string {
    const entry = `<Relationship Id="${input.id}" Type="${input.type}" Target="${input.target}"/>`
    if (!xml) {
        return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entry}</Relationships>`
    }
    return xml.replace('</Relationships>', `${entry}</Relationships>`)
}

function ensureWorksheetRelationshipNamespace(xml: string): string {
    if (xml.includes('xmlns:r=')) {
        return xml
    }
    return xml.replace(
        '<worksheet ',
        '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ',
    )
}

function addWorksheetDrawing(xml: string, relationshipId: string): string {
    const next = ensureWorksheetRelationshipNamespace(xml)
    if (next.includes('<drawing ')) {
        return next
    }
    return next.replace('</worksheet>', `<drawing r:id="${relationshipId}"/></worksheet>`)
}

function quotedSheetReference(sheetName: string, range: string): string {
    if (range.includes('!')) {
        return range
    }
    return `'${sheetName.replaceAll("'", "''")}'!${range}`
}

function chartAnchorCell(anchor: string | undefined): { col: number; row: number } {
    try {
        const decoded = XLSX.utils.decode_cell(anchor?.trim() || 'F2')
        return {
            col: decoded.c,
            row: decoded.r,
        }
    } catch {
        return {
            col: 5,
            row: 1,
        }
    }
}

function drawingXml(chartRelationshipId: string, chart: WorkbookChartInput): string {
    const anchor = chartAnchorCell(chart.anchor)
    const title = xmlEscape(chart.title ?? 'Workbook chart')
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<xdr:twoCellAnchor>
<xdr:from><xdr:col>${anchor.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${anchor.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
<xdr:to><xdr:col>${anchor.col + 7}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${anchor.row + 15}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
<xdr:graphicFrame macro="">
<xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="${title}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>
<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${chartRelationshipId}"/></a:graphicData></a:graphic>
</xdr:graphicFrame>
<xdr:clientData/>
</xdr:twoCellAnchor>
</xdr:wsDr>`
}

function chartXml(sheetName: string, chart: WorkbookChartInput): string {
    const chartType =
        chart.type === 'line' ? 'lineChart' : chart.type === 'pie' ? 'pieChart' : 'barChart'
    const title = xmlEscape(chart.title ?? 'Workbook chart')
    const seriesName = xmlEscape(chart.seriesName ?? 'Series')
    const labelsRange = xmlEscape(quotedSheetReference(sheetName, chart.labelsRange))
    const valuesRange = xmlEscape(quotedSheetReference(sheetName, chart.valuesRange))
    const categoryAxis = chart.type === 'pie' ? '' : '<c:axId val="123456"/><c:axId val="654321"/>'
    const axes =
        chart.type === 'pie'
            ? ''
            : '<c:catAx><c:axId val="123456"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="b"/><c:tickLblPos val="nextTo"/><c:crossAx val="654321"/><c:crosses val="autoZero"/></c:catAx><c:valAx><c:axId val="654321"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="l"/><c:majorGridlines/><c:numFmt formatCode="General" sourceLinked="1"/><c:tickLblPos val="nextTo"/><c:crossAx val="123456"/><c:crosses val="autoZero"/></c:valAx>'
    const chartSpecific =
        chart.type === 'line'
            ? '<c:grouping val="standard"/>'
            : chart.type === 'pie'
              ? ''
              : '<c:barDir val="col"/><c:grouping val="clustered"/>'
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<c:chart>
<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>${title}</a:t></a:r></a:p></c:rich></c:tx><c:layout/></c:title>
<c:plotArea><c:layout/>
<c:${chartType}>${chartSpecific}<c:varyColors val="0"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>${seriesName}</c:v></c:tx><c:cat><c:strRef><c:f>${labelsRange}</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>${valuesRange}</c:f></c:numRef></c:val></c:ser>${categoryAxis}</c:${chartType}>
${axes}
</c:plotArea>
<c:legend><c:legendPos val="r"/><c:layout/></c:legend>
<c:plotVisOnly val="1"/>
</c:chart>
</c:chartSpace>`
}

function addWorkbookCharts(buffer: Buffer, sheets: WorkbookSheetInput[]): Buffer {
    const zip = unzipSync(new Uint8Array(buffer))
    let chartIndex = 1
    const contentTypeOverrides: Array<{ partName: string; contentType: string }> = []
    for (const [sheetIndex, sheet] of sheets.entries()) {
        for (const chart of sheet.charts) {
            const sheetPath = `xl/worksheets/sheet${sheetIndex + 1}.xml`
            const sheetRelsPath = `xl/worksheets/_rels/sheet${sheetIndex + 1}.xml.rels`
            const drawingPath = `xl/drawings/drawing${chartIndex}.xml`
            const drawingRelsPath = `xl/drawings/_rels/drawing${chartIndex}.xml.rels`
            const chartPath = `xl/charts/chart${chartIndex}.xml`
            const sheetXml = zip[sheetPath] ? strFromU8(zip[sheetPath]) : null
            if (!sheetXml) {
                throw new Error(`Worksheet ${sheetIndex + 1} was not found for chart`)
            }
            const sheetRelsXml = zip[sheetRelsPath] ? strFromU8(zip[sheetRelsPath]) : undefined
            const drawingRelationshipId = nextRelationshipId(sheetRelsXml ?? '')
            zip[sheetPath] = strToU8(addWorksheetDrawing(sheetXml, drawingRelationshipId))
            zip[sheetRelsPath] = strToU8(
                appendRelationship(sheetRelsXml, {
                    id: drawingRelationshipId,
                    type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing',
                    target: `../drawings/drawing${chartIndex}.xml`,
                }),
            )
            zip[drawingPath] = strToU8(drawingXml('rId1', chart))
            zip[drawingRelsPath] = strToU8(
                appendRelationship(undefined, {
                    id: 'rId1',
                    type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart',
                    target: `../charts/chart${chartIndex}.xml`,
                }),
            )
            zip[chartPath] = strToU8(chartXml(sheet.name.slice(0, 31), chart))
            contentTypeOverrides.push(
                {
                    partName: `/xl/drawings/drawing${chartIndex}.xml`,
                    contentType: 'application/vnd.openxmlformats-officedocument.drawing+xml',
                },
                {
                    partName: `/xl/charts/chart${chartIndex}.xml`,
                    contentType:
                        'application/vnd.openxmlformats-officedocument.drawingml.chart+xml',
                },
            )
            chartIndex += 1
        }
    }
    const contentTypes = zip['[Content_Types].xml'] ? strFromU8(zip['[Content_Types].xml']) : null
    if (!contentTypes) {
        throw new Error('XLSX content types were not found')
    }
    zip['[Content_Types].xml'] = strToU8(
        contentTypesWithOverrides(contentTypes, contentTypeOverrides),
    )
    return Buffer.from(zipSync(zip))
}

function preserveWorkbookDrawingParts(originalBuffer: Buffer, updatedBuffer: Buffer): Buffer {
    const originalZip = unzipSync(new Uint8Array(originalBuffer))
    const updatedZip = unzipSync(new Uint8Array(updatedBuffer))
    for (const [path, content] of Object.entries(originalZip)) {
        if (/^xl\/(?:charts|drawings)\//.test(path)) {
            updatedZip[path] = content
        }
        if (
            /^xl\/worksheets\/_rels\/sheet\d+\.xml\.rels$/.test(path) &&
            strFromU8(content).includes('/drawing')
        ) {
            updatedZip[path] = content
        }
    }
    for (const [path, content] of Object.entries(originalZip)) {
        if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(path)) {
            continue
        }
        const originalDrawing = strFromU8(content).match(/<drawing\b[^>]*\/>/)?.[0]
        if (!originalDrawing || !updatedZip[path]) {
            continue
        }
        const updatedXml = strFromU8(updatedZip[path])
        if (!updatedXml.includes('<drawing ')) {
            updatedZip[path] = strToU8(
                ensureWorksheetRelationshipNamespace(updatedXml).replace(
                    '</worksheet>',
                    `${originalDrawing}</worksheet>`,
                ),
            )
        }
    }
    const originalContentTypes = originalZip['[Content_Types].xml']
        ? strFromU8(originalZip['[Content_Types].xml'])
        : ''
    const updatedContentTypes = updatedZip['[Content_Types].xml']
        ? strFromU8(updatedZip['[Content_Types].xml'])
        : null
    if (!updatedContentTypes) {
        throw new Error('XLSX content types were not found')
    }
    const drawingOverrides = Array.from(
        originalContentTypes.matchAll(
            /<Override\b[^>]+PartName="\/xl\/(?:charts|drawings)\/[^"]+"[^>]*\/>/g,
        ),
        (match) => match[0],
    )
    updatedZip['[Content_Types].xml'] = strToU8(
        contentTypesWithRawOverrides(updatedContentTypes, drawingOverrides),
    )
    return Buffer.from(zipSync(updatedZip))
}

export async function createXlsx(path: string, sheets: WorkbookSheetInput[]): Promise<void> {
    const workbook = XLSX.utils.book_new()
    const safeSheets = sheets.length > 0 ? sheets : [{ name: 'Sheet 1', rows: [['']], charts: [] }]
    for (const sheet of safeSheets) {
        const rows = sheet.rows.map((row) => row.map(normalizeCell))
        const worksheet = XLSX.utils.aoa_to_sheet(rows)
        populateFormulaCachedValues(worksheet)
        XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name.slice(0, 31))
    }
    await ensureShellWritableDirectory(dirname(path))
    const workbookBuffer = XLSX.write(workbook, {
        bookType: 'xlsx',
        type: 'buffer',
    })
    await writeWorkspaceFile(
        path,
        safeSheets.some((sheet) => sheet.charts.length > 0)
            ? addWorkbookCharts(Buffer.from(workbookBuffer), safeSheets)
            : Buffer.from(workbookBuffer),
    )
}

export async function inspectXlsx(path: string): Promise<string> {
    const workbook = XLSX.readFile(path, {
        cellFormula: true,
    })
    const output = workbook.SheetNames.map((name) => {
        const sheet = workbook.Sheets[name]
        const rows = sheet ? XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) : []
        return {
            name,
            rows,
        }
    })
    return boundExtractedText(JSON.stringify(output, null, 4))
}

function sheetForEdit(workbook: XLSX.WorkBook, edit: WorkbookCellEdit): XLSX.WorkSheet {
    const sheetName = edit.sheet ?? workbook.SheetNames[0]
    if (!sheetName) {
        throw new Error('Workbook does not contain a sheet')
    }
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) {
        throw new Error(`Workbook sheet was not found: ${sheetName}`)
    }
    return sheet
}

function cellFromEdit(edit: WorkbookCellEdit): XLSX.CellObject {
    const formula =
        edit.formula ??
        (typeof edit.value === 'string' && edit.value.startsWith('=')
            ? edit.value.slice(1)
            : undefined)
    if (formula) {
        return {
            t: 'n',
            f: formula,
            v: 0,
        }
    }
    if (typeof edit.value === 'number') {
        return {
            t: 'n',
            v: edit.value,
        }
    }
    if (typeof edit.value === 'boolean') {
        return {
            t: 'b',
            v: edit.value,
        }
    }
    return {
        t: 's',
        v: edit.value === undefined || edit.value === null ? '' : String(edit.value),
    }
}

function updateSheetRange(sheet: XLSX.WorkSheet, address: string): void {
    const cell = XLSX.utils.decode_cell(address)
    const range = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : { s: cell, e: cell }
    range.s.c = Math.min(range.s.c, cell.c)
    range.s.r = Math.min(range.s.r, cell.r)
    range.e.c = Math.max(range.e.c, cell.c)
    range.e.r = Math.max(range.e.r, cell.r)
    sheet['!ref'] = XLSX.utils.encode_range(range)
}

function applyTextReplacementToCell(cell: XLSX.CellObject, replacement: Replacement): boolean {
    const currentValue = cell.f ? `=${cell.f}` : cell.v
    if (currentValue === undefined || currentValue === null) {
        return false
    }
    const currentText = String(currentValue)
    if (!currentText.includes(replacement.oldText)) {
        return false
    }
    const nextText = currentText.split(replacement.oldText).join(replacement.newText)
    if (cell.f) {
        cell.f = nextText.startsWith('=') ? nextText.slice(1) : nextText
        cell.w = undefined
        return true
    }
    const numericValue = typeof cell.v === 'number' ? Number(nextText) : Number.NaN
    if (typeof cell.v === 'number' && Number.isFinite(numericValue)) {
        cell.v = numericValue
        cell.t = 'n'
    } else {
        cell.v = nextText
        cell.t = 's'
    }
    cell.w = undefined
    return true
}

export async function editXlsx(
    path: string,
    edits: Array<Replacement | WorkbookCellEdit>,
): Promise<number> {
    const originalBuffer = await readFile(path)
    const workbook = XLSX.readFile(path, {
        cellFormula: true,
    })
    let editCount = 0
    for (const edit of edits) {
        if ('cell' in edit) {
            const sheet = sheetForEdit(workbook, edit)
            sheet[edit.cell] = cellFromEdit(edit)
            updateSheetRange(sheet, edit.cell)
            editCount += 1
        }
    }
    const replacements = edits.filter((edit): edit is Replacement => 'oldText' in edit)
    for (const name of workbook.SheetNames) {
        const sheet = workbook.Sheets[name]
        if (!sheet) {
            continue
        }
        for (const address of Object.keys(sheet)) {
            if (address.startsWith('!')) {
                continue
            }
            const cell = sheet[address] as XLSX.CellObject
            for (const replacement of replacements) {
                if (applyTextReplacementToCell(cell, replacement)) {
                    editCount += 1
                }
            }
        }
        populateFormulaCachedValues(sheet)
    }
    if (editCount === 0) {
        throw new Error('No workbook edits were applied')
    }
    const updatedBuffer = XLSX.write(workbook, {
        bookType: 'xlsx',
        type: 'buffer',
    })
    await writeWorkspaceFile(
        path,
        preserveWorkbookDrawingParts(originalBuffer, Buffer.from(updatedBuffer)),
    )
    return editCount
}
