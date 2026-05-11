import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import * as XLSX from 'xlsx'
import type { WorkbookChartInput, WorkbookSheetInput } from './types'
import { xmlEscape } from './xml'

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

export function addWorkbookCharts(buffer: Buffer, sheets: WorkbookSheetInput[]): Buffer {
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

export function preserveWorkbookDrawingParts(
    originalBuffer: Buffer,
    updatedBuffer: Buffer,
): Buffer {
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
