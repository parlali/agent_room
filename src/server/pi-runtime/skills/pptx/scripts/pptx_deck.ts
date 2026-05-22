import JSZip from 'jszip'
import {
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

interface SlideInput {
    title: string
    subtitle?: string
    bullets: string[]
    notes?: string
    background?: string
    blocks?: SlideBlock[]
}

interface SlideInspection {
    part: string
    slide: number
    paragraphs: string[]
}

type SlideBlock =
    | {
          type: 'text'
          text: string
          x?: number
          y?: number
          width?: number
          height?: number
          size?: number
          bold?: boolean
      }
    | {
          type: 'bullets'
          items: string[]
          x?: number
          y?: number
          width?: number
          height?: number
      }
    | {
          type: 'table'
          rows: string[][]
          x?: number
          y?: number
          width?: number
          height?: number
      }
    | {
          type: 'metric'
          label: string
          value: string
          x?: number
          y?: number
          width?: number
          height?: number
      }

type PptxEditOperation =
    | {
          type: 'replace'
          oldText: string
          newText: string
      }
    | {
          type: 'addSlide'
          slide: SlideInput
      }
    | {
          type: 'deleteSlide'
          slide: number
      }

const presentationNamespace = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const drawingNamespace = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const relationshipsNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const packageRelationshipsNamespace = 'http://schemas.openxmlformats.org/package/2006/relationships'

function escapeXml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
}

function normalizeSlides(value: unknown): SlideInput[] {
    const source = isRecord(value) ? value.slides : value
    const slides =
        Array.isArray(source) && source.length > 0 ? source : [{ title: 'Untitled', bullets: [] }]
    return slides.map((slide, index) => {
        const record = isRecord(slide) ? slide : {}
        return {
            title: String(record.title || `Slide ${index + 1}`),
            subtitle: typeof record.subtitle === 'string' ? record.subtitle : undefined,
            bullets: Array.isArray(record.bullets)
                ? record.bullets.map((bullet) => String(bullet))
                : [],
            notes: typeof record.notes === 'string' ? record.notes : undefined,
            background:
                typeof record.background === 'string'
                    ? record.background.replace(/^#/, '')
                    : undefined,
            blocks: Array.isArray(record.blocks)
                ? record.blocks
                      .map(normalizeSlideBlock)
                      .filter((block): block is SlideBlock => block !== null)
                : undefined,
        }
    })
}

function numberOption(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizeSlideBlock(value: unknown): SlideBlock | null {
    if (!isRecord(value)) {
        return null
    }
    const type = typeof value.type === 'string' ? value.type : 'text'
    const geometry = {
        x: typeof value.x === 'number' ? value.x : undefined,
        y: typeof value.y === 'number' ? value.y : undefined,
        width: typeof value.width === 'number' ? value.width : undefined,
        height: typeof value.height === 'number' ? value.height : undefined,
    }
    if (type === 'bullets') {
        return {
            type,
            items: Array.isArray(value.items) ? value.items.map((item) => String(item)) : [],
            ...geometry,
        }
    }
    if (type === 'table') {
        return {
            type,
            rows: Array.isArray(value.rows)
                ? value.rows.map((row) =>
                      Array.isArray(row) ? row.map((cell) => String(cell)) : [String(row)],
                  )
                : [],
            ...geometry,
        }
    }
    if (type === 'metric') {
        return {
            type,
            label: String(value.label ?? ''),
            value: String(value.value ?? ''),
            ...geometry,
        }
    }
    return {
        type: 'text',
        text: String(value.text ?? ''),
        size: typeof value.size === 'number' ? value.size : undefined,
        bold: value.bold === true,
        ...geometry,
    }
}

function emu(inches: number): number {
    return Math.round(inches * 914400)
}

function position(value: number | undefined, fallback: number): number {
    return emu(numberOption(value, fallback))
}

function color(value: string | undefined, fallback: string): string {
    return escapeXml((value || fallback).replace(/^#/, ''))
}

function textParagraphXml(input: {
    text: string
    size?: number
    bold?: boolean
    bullet?: boolean
    color?: string
}): string {
    const bullet = input.bullet
        ? '<a:pPr marL="342900" indent="-171450"><a:buChar char="•"/></a:pPr>'
        : ''
    const properties = [
        `sz="${Math.round(numberOption(input.size, 20) * 100)}"`,
        input.bold ? 'b="1"' : '',
    ]
        .filter(Boolean)
        .join(' ')
    return [
        '<a:p>',
        bullet,
        '<a:r>',
        `<a:rPr ${properties}><a:solidFill><a:srgbClr val="${color(input.color, '1F2937')}"/></a:solidFill></a:rPr>`,
        `<a:t>${escapeXml(input.text)}</a:t>`,
        '</a:r>',
        '</a:p>',
    ].join('')
}

function textBodyXml(
    lines: string[],
    options: { size?: number; bold?: boolean; bullet?: boolean; color?: string } = {},
): string {
    const paragraphs = lines
        .map((line) =>
            textParagraphXml({
                text: line,
                size: options.size,
                bold: options.bold,
                bullet: options.bullet,
                color: options.color,
            }),
        )
        .join('')
    return [
        '<p:txBody>',
        '<a:bodyPr/>',
        '<a:lstStyle/>',
        paragraphs || '<a:p/>',
        '</p:txBody>',
    ].join('')
}

function shapeXml(input: {
    id: number
    name: string
    placeholderType?: string
    x: number
    y: number
    cx: number
    cy: number
    lines: string[]
    size?: number
    bold?: boolean
    bullet?: boolean
    fill?: string
    textColor?: string
}): string {
    const placeholder = input.placeholderType ? `<p:ph type="${input.placeholderType}"/>` : ''
    const fill = input.fill
        ? `<a:solidFill><a:srgbClr val="${color(input.fill, 'FFFFFF')}"/></a:solidFill>`
        : ''
    return [
        '<p:sp>',
        '<p:nvSpPr>',
        `<p:cNvPr id="${input.id}" name="${escapeXml(input.name)}"/>`,
        '<p:cNvSpPr/>',
        `<p:nvPr>${placeholder}</p:nvPr>`,
        '</p:nvSpPr>',
        '<p:spPr>',
        `<a:xfrm><a:off x="${input.x}" y="${input.y}"/><a:ext cx="${input.cx}" cy="${input.cy}"/></a:xfrm>`,
        fill,
        '</p:spPr>',
        textBodyXml(input.lines, {
            size: input.size,
            bold: input.bold,
            bullet: input.bullet,
            color: input.textColor,
        }),
        '</p:sp>',
    ].join('')
}

function slideXml(slide: SlideInput, index: number): string {
    const background = slide.background
        ? `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${color(slide.background, 'FFFFFF')}"/></a:solidFill></p:bgPr></p:bg>`
        : ''
    const blocks =
        slide.blocks && slide.blocks.length > 0 ? slide.blocks : defaultSlideBlocks(slide)
    const blockShapes = blocks
        .map((block, blockIndex) => slideBlockXml(block, index * 100 + blockIndex + 10))
        .join('')
    return [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        `<p:sld xmlns:a="${drawingNamespace}" xmlns:p="${presentationNamespace}" xmlns:r="${relationshipsNamespace}">`,
        `<p:cSld>${background}<p:spTree>`,
        '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>',
        '<p:grpSpPr/>',
        shapeXml({
            id: index * 10 + 2,
            name: 'Title',
            placeholderType: 'title',
            x: 685800,
            y: 365760,
            cx: 10515600,
            cy: 731520,
            lines: [slide.title],
            size: 34,
            bold: true,
        }),
        slide.subtitle
            ? shapeXml({
                  id: index * 10 + 3,
                  name: 'Subtitle',
                  x: 731520,
                  y: 1097280,
                  cx: 10424160,
                  cy: 548640,
                  lines: [slide.subtitle],
                  size: 18,
                  textColor: '475569',
              })
            : '',
        blockShapes,
        '</p:spTree></p:cSld>',
        '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>',
        '</p:sld>',
    ].join('')
}

function defaultSlideBlocks(slide: SlideInput): SlideBlock[] {
    return slide.bullets.length > 0
        ? [
              {
                  type: 'bullets',
                  items: slide.bullets,
                  x: 0.95,
                  y: slide.subtitle ? 1.9 : 1.55,
                  width: 11.1,
                  height: 4.6,
              },
          ]
        : []
}

function slideBlockXml(block: SlideBlock, id: number): string {
    if (block.type === 'bullets') {
        return shapeXml({
            id,
            name: 'Bullets',
            x: position(block.x, 0.95),
            y: position(block.y, 1.6),
            cx: position(block.width, 11),
            cy: position(block.height, 4.6),
            lines: block.items,
            size: 21,
            bullet: true,
        })
    }
    if (block.type === 'metric') {
        return shapeXml({
            id,
            name: 'Metric',
            x: position(block.x, 0.95),
            y: position(block.y, 1.75),
            cx: position(block.width, 3.2),
            cy: position(block.height, 1.4),
            lines: [block.value, block.label],
            size: 24,
            bold: true,
            fill: 'EEF2FF',
        })
    }
    if (block.type === 'table') {
        return tableShapeXml(block, id)
    }
    return shapeXml({
        id,
        name: 'Text',
        x: position(block.x, 0.95),
        y: position(block.y, 1.6),
        cx: position(block.width, 11),
        cy: position(block.height, 1),
        lines: [block.text],
        size: block.size,
        bold: block.bold,
    })
}

function tableShapeXml(block: Extract<SlideBlock, { type: 'table' }>, id: number): string {
    const rows = block.rows.length > 0 ? block.rows : [['']]
    const columnCount = Math.max(1, ...rows.map((row) => row.length))
    const width = position(block.width, 10.8)
    const height = position(block.height, 3.4)
    const cellWidth = Math.floor(width / columnCount)
    const rowHeight = Math.floor(height / rows.length)
    const grid = Array.from({ length: columnCount }, () => `<a:gridCol w="${cellWidth}"/>`).join('')
    const tableRows = rows
        .map((row, rowIndex) => {
            const cells = Array.from({ length: columnCount }, (_value, index) => {
                const fill =
                    rowIndex === 0
                        ? '<a:tcPr><a:solidFill><a:srgbClr val="1F4E79"/></a:solidFill></a:tcPr>'
                        : '<a:tcPr/>'
                return `<a:tc>${textBodyXml([row[index] ?? ''], {
                    size: 14,
                    bold: rowIndex === 0,
                    color: rowIndex === 0 ? 'FFFFFF' : '1F2937',
                })}${fill}</a:tc>`
            }).join('')
            return `<a:tr h="${rowHeight}">${cells}</a:tr>`
        })
        .join('')
    return [
        '<p:graphicFrame>',
        '<p:nvGraphicFramePr>',
        `<p:cNvPr id="${id}" name="Table"/>`,
        '<p:cNvGraphicFramePr/>',
        '<p:nvPr/>',
        '</p:nvGraphicFramePr>',
        `<p:xfrm><a:off x="${position(block.x, 0.95)}" y="${position(block.y, 1.75)}"/><a:ext cx="${width}" cy="${height}"/></p:xfrm>`,
        '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">',
        `<a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>${grid}</a:tblGrid>${tableRows}</a:tbl>`,
        '</a:graphicData></a:graphic>',
        '</p:graphicFrame>',
    ].join('')
}

async function createPptx(path: string, slides: SlideInput[]): Promise<void> {
    const zip = new JSZip()
    const slideOverrides = slides
        .map(
            (_slide, index) =>
                `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
        )
        .join('')
    const noteOverrides = slides
        .map((slide, index) =>
            slide.notes
                ? `<Override PartName="/ppt/notesSlides/notesSlide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`
                : '',
        )
        .join('')
    writeZipText(
        zip,
        '[Content_Types].xml',
        [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
            '<Default Extension="xml" ContentType="application/xml"/>',
            '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>',
            '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>',
            '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>',
            '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>',
            '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
            '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
            slideOverrides,
            noteOverrides,
            '</Types>',
        ].join(''),
    )
    writeZipText(
        zip,
        '_rels/.rels',
        [
            '<?xml version="1.0" encoding="UTF-8"?>',
            `<Relationships xmlns="${packageRelationshipsNamespace}">`,
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>',
            '</Relationships>',
        ].join(''),
    )
    const slideIds = slides
        .map((_slide, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`)
        .join('')
    writeZipText(
        zip,
        'ppt/presentation.xml',
        [
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
            `<p:presentation xmlns:p="${presentationNamespace}" xmlns:r="${relationshipsNamespace}">`,
            '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rIdMaster1"/></p:sldMasterIdLst>',
            `<p:sldIdLst>${slideIds}</p:sldIdLst>`,
            '<p:sldSz cx="12192000" cy="6858000"/>',
            '<p:notesSz cx="6858000" cy="9144000"/>',
            '</p:presentation>',
        ].join(''),
    )
    const presentationRelationships = slides
        .map(
            (_slide, index) =>
                `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`,
        )
        .join('')
    writeZipText(
        zip,
        'ppt/_rels/presentation.xml.rels',
        `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${packageRelationshipsNamespace}">${presentationRelationships}<Relationship Id="rIdMaster1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/></Relationships>`,
    )
    slides.forEach((slide, index) => {
        writeZipText(zip, `ppt/slides/slide${index + 1}.xml`, slideXml(slide, index + 1))
        writeZipText(
            zip,
            `ppt/slides/_rels/slide${index + 1}.xml.rels`,
            slideRelationshipsXml(index + 1, Boolean(slide.notes)),
        )
        if (slide.notes) {
            writeZipText(zip, `ppt/notesSlides/notesSlide${index + 1}.xml`, notesXml(slide.notes))
        }
    })
    writeZipText(zip, 'ppt/theme/theme1.xml', themeXml())
    writeZipText(zip, 'ppt/slideMasters/slideMaster1.xml', slideMasterXml())
    writeZipText(
        zip,
        'ppt/slideMasters/_rels/slideMaster1.xml.rels',
        `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${packageRelationshipsNamespace}"><Relationship Id="rIdLayout1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rIdTheme1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`,
    )
    writeZipText(zip, 'ppt/slideLayouts/slideLayout1.xml', slideLayoutXml())
    writeZipText(
        zip,
        'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
        `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${packageRelationshipsNamespace}"><Relationship Id="rIdMaster1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
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

function slideRelationshipsXml(index: number, hasNotes: boolean): string {
    const notes = hasNotes
        ? `<Relationship Id="rIdNotes${index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${index}.xml"/>`
        : ''
    return `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${packageRelationshipsNamespace}"><Relationship Id="rIdLayout1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>${notes}</Relationships>`
}

function notesXml(notes: string): string {
    return [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        `<p:notes xmlns:a="${drawingNamespace}" xmlns:p="${presentationNamespace}" xmlns:r="${relationshipsNamespace}">`,
        '<p:cSld><p:spTree>',
        '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>',
        '<p:grpSpPr/>',
        shapeXml({
            id: 2,
            name: 'Notes',
            x: 457200,
            y: 914400,
            cx: 5943600,
            cy: 6400800,
            lines: notes.split('\n'),
            size: 12,
        }),
        '</p:spTree></p:cSld>',
        '</p:notes>',
    ].join('')
}

function themeXml(): string {
    return [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Agent Room">',
        '<a:themeElements>',
        '<a:clrScheme name="Agent Room"><a:dk1><a:srgbClr val="111827"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F8FAFC"/></a:lt2><a:accent1><a:srgbClr val="2563EB"/></a:accent1><a:accent2><a:srgbClr val="059669"/></a:accent2><a:accent3><a:srgbClr val="D97706"/></a:accent3><a:accent4><a:srgbClr val="7C3AED"/></a:accent4><a:accent5><a:srgbClr val="DC2626"/></a:accent5><a:accent6><a:srgbClr val="0891B2"/></a:accent6><a:hlink><a:srgbClr val="2563EB"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink></a:clrScheme>',
        '<a:fontScheme name="Agent Room"><a:majorFont><a:latin typeface="Aptos Display"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/></a:minorFont></a:fontScheme>',
        '<a:fmtScheme name="Agent Room"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle/></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>',
        '</a:themeElements>',
        '</a:theme>',
    ].join('')
}

function slideMasterXml(): string {
    return [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        `<p:sldMaster xmlns:a="${drawingNamespace}" xmlns:p="${presentationNamespace}" xmlns:r="${relationshipsNamespace}">`,
        '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>',
        '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>',
        '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rIdLayout1"/></p:sldLayoutIdLst>',
        '</p:sldMaster>',
    ].join('')
}

function slideLayoutXml(): string {
    return [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        `<p:sldLayout xmlns:a="${drawingNamespace}" xmlns:p="${presentationNamespace}" xmlns:r="${relationshipsNamespace}" type="blank" preserve="1">`,
        '<p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>',
        '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>',
        '</p:sldLayout>',
    ].join('')
}

function slidePartNames(zip: JSZip): string[] {
    return zipFileNames(zip)
        .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
        .sort((left, right) => slideNumber(left) - slideNumber(right))
}

function editablePartNames(zip: JSZip): string[] {
    return zipFileNames(zip).filter((name) =>
        /^ppt\/(slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml$/.test(name),
    )
}

function slideNumber(part: string): number {
    const match = /(\d+)\.xml$/.exec(part)
    return match ? Number(match[1]) : 0
}

async function inspectPptx(path: string): Promise<Record<string, unknown>> {
    const zip = await loadZip(path)
    const slides: SlideInspection[] = []
    for (const part of slidePartNames(zip)) {
        const file = zip.file(part)
        if (!file) {
            continue
        }
        const document = parseXml(await file.async('text'))
        const paragraphs = elementsByLocalName(document, 'p')
            .map((paragraph) => textFromTextElements(paragraph, 't'))
            .filter(Boolean)
        slides.push({
            part,
            slide: slideNumber(part),
            paragraphs,
        })
    }
    const notes = zipFileNames(zip).filter((name) =>
        /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name),
    )
    const charts = zipFileNames(zip).filter((name) => /^ppt\/charts\/chart\d+\.xml$/.test(name))
    const media = zipFileNames(zip).filter((name) => /^ppt\/media\/.+/.test(name))
    const layouts = zipFileNames(zip).filter((name) =>
        /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(name),
    )
    const masters = zipFileNames(zip).filter((name) =>
        /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(name),
    )
    const validation = await validateOfficePackage(path, [
        '[Content_Types].xml',
        '_rels/.rels',
        'ppt/presentation.xml',
    ])
    const issues = [
        ...validation.errors,
        ...slides
            .filter((slide) => slide.paragraphs.length === 0)
            .map((slide) => `Slide ${slide.slide} has no visible text`),
        ...(masters.length === 0 ? ['Presentation has no slide master'] : []),
        ...(layouts.length === 0 ? ['Presentation has no slide layout'] : []),
    ]
    return {
        text: [
            ...slides.flatMap((slide) =>
                slide.paragraphs.map(
                    (paragraph, index) => `Slide ${slide.slide}#p${index + 1}: ${paragraph}`,
                ),
            ),
            `Notes: ${notes.length}`,
            `Charts: ${charts.length}`,
            `Media: ${media.length}`,
            `Layouts: ${layouts.length}`,
            `Masters: ${masters.length}`,
        ].join('\n'),
        slides,
        notes,
        charts,
        media,
        layouts,
        masters,
        validation,
        issues,
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
        if (!entry.oldText) {
            fail('Replacement oldText cannot be empty')
        }
        return {
            oldText: entry.oldText,
            newText: entry.newText,
        }
    })
}

function normalizePptxOperations(value: unknown): PptxEditOperation[] {
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
            return {
                type,
                oldText: entry.oldText,
                newText: entry.newText,
            }
        }
        if (type === 'addSlide') {
            const slide = normalizeSlides({ slides: [entry.slide] })[0]
            return {
                type,
                slide,
            }
        }
        if (type === 'deleteSlide') {
            if (
                typeof entry.slide !== 'number' ||
                !Number.isInteger(entry.slide) ||
                entry.slide < 1
            ) {
                fail('deleteSlide requires a positive slide number')
            }
            return {
                type,
                slide: entry.slide,
            }
        }
        fail(`Unsupported PPTX edit operation: ${type || 'missing type'}`)
    })
}

async function applyPptxReplacements(
    zip: JSZip,
    replacements: Array<{ oldText: string; newText: string }>,
): Promise<number> {
    let replacementCount = 0
    for (const part of editablePartNames(zip)) {
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

function maxPartNumber(zip: JSZip, pattern: RegExp): number {
    return Math.max(
        0,
        ...zipFileNames(zip)
            .map((name) => pattern.exec(name)?.[1])
            .filter((value): value is string => value !== undefined)
            .map(Number),
    )
}

async function addSlide(zip: JSZip, slide: SlideInput): Promise<void> {
    const slideIndex = maxPartNumber(zip, /^ppt\/slides\/slide(\d+)\.xml$/) + 1
    const presentationXml = await readZipText(zip, 'ppt/presentation.xml')
    const relsXml = await readZipText(zip, 'ppt/_rels/presentation.xml.rels')
    const typesXml = await readZipText(zip, '[Content_Types].xml')
    if (!presentationXml || !relsXml || !typesXml) {
        fail('Presentation package is missing required XML parts')
    }
    const presentation = parseXml(presentationXml)
    const rels = parseXml(relsXml)
    const slideList = firstElementByLocalName(presentation, 'sldIdLst')
    const relsRoot = rels.documentElement
    if (!slideList || !relsRoot) {
        fail('Presentation XML is missing slide metadata')
    }
    const nextRelationship =
        Math.max(
            0,
            ...elementsByLocalName(rels, 'Relationship')
                .map(
                    (relationship) => /^rId(\d+)$/.exec(relationship.getAttribute('Id') ?? '')?.[1],
                )
                .filter((value): value is string => value !== undefined)
                .map(Number),
        ) + 1
    const nextSlideId =
        Math.max(
            255,
            ...elementsByLocalName(presentation, 'sldId')
                .map((slideId) => Number(slideId.getAttribute('id') ?? 0))
                .filter(Number.isFinite),
        ) + 1
    const relationshipId = `rId${nextRelationship}`
    const slideId = presentation.createElementNS(presentationNamespace, 'p:sldId')
    slideId.setAttribute('id', String(nextSlideId))
    slideId.setAttribute('r:id', relationshipId)
    slideList.appendChild(slideId)
    const relationship = rels.createElementNS(packageRelationshipsNamespace, 'Relationship')
    relationship.setAttribute('Id', relationshipId)
    relationship.setAttribute(
        'Type',
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide',
    )
    relationship.setAttribute('Target', `slides/slide${slideIndex}.xml`)
    relsRoot.appendChild(relationship)
    writeZipText(zip, 'ppt/presentation.xml', serializeXml(presentation))
    writeZipText(zip, 'ppt/_rels/presentation.xml.rels', serializeXml(rels))
    writeZipText(
        zip,
        '[Content_Types].xml',
        typesXml.replace(
            '</Types>',
            `<Override PartName="/ppt/slides/slide${slideIndex}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>${
                slide.notes
                    ? `<Override PartName="/ppt/notesSlides/notesSlide${slideIndex}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`
                    : ''
            }</Types>`,
        ),
    )
    writeZipText(zip, `ppt/slides/slide${slideIndex}.xml`, slideXml(slide, slideIndex))
    writeZipText(
        zip,
        `ppt/slides/_rels/slide${slideIndex}.xml.rels`,
        slideRelationshipsXml(slideIndex, Boolean(slide.notes)),
    )
    if (slide.notes) {
        writeZipText(zip, `ppt/notesSlides/notesSlide${slideIndex}.xml`, notesXml(slide.notes))
    }
}

async function deleteSlide(zip: JSZip, slideNumberToDelete: number): Promise<void> {
    const slides = slidePartNames(zip)
    if (slides.length <= 1) {
        fail('Cannot delete the only slide')
    }
    const part = slides.find((slide) => slideNumber(slide) === slideNumberToDelete)
    if (!part) {
        fail(`Slide not found: ${slideNumberToDelete}`)
    }
    const presentationXml = await readZipText(zip, 'ppt/presentation.xml')
    const relsXml = await readZipText(zip, 'ppt/_rels/presentation.xml.rels')
    const typesXml = await readZipText(zip, '[Content_Types].xml')
    if (!presentationXml || !relsXml || !typesXml) {
        fail('Presentation package is missing required XML parts')
    }
    const presentation = parseXml(presentationXml)
    const rels = parseXml(relsXml)
    const relationship = elementsByLocalName(rels, 'Relationship').find(
        (entry) => entry.getAttribute('Target') === part.replace(/^ppt\//, ''),
    )
    const relationshipId = relationship?.getAttribute('Id') ?? null
    if (!relationshipId) {
        fail(`Slide relationship not found: ${part}`)
    }
    const slideId = elementsByLocalName(presentation, 'sldId').find(
        (entry) => entry.getAttribute('r:id') === relationshipId,
    )
    slideId?.parentNode?.removeChild(slideId)
    relationship?.parentNode?.removeChild(relationship)
    zip.remove(part)
    zip.remove(part.replace('ppt/slides/', 'ppt/slides/_rels/') + '.rels')
    const notePart = `ppt/notesSlides/notesSlide${slideNumberToDelete}.xml`
    zip.remove(notePart)
    writeZipText(zip, 'ppt/presentation.xml', serializeXml(presentation))
    writeZipText(zip, 'ppt/_rels/presentation.xml.rels', serializeXml(rels))
    const escapedSlidePart = part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const escapedNotePart = notePart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    writeZipText(
        zip,
        '[Content_Types].xml',
        typesXml
            .replace(new RegExp(`<Override PartName="/${escapedSlidePart}"[^>]*/>`), '')
            .replace(new RegExp(`<Override PartName="/${escapedNotePart}"[^>]*/>`), ''),
    )
}

async function editPptx(
    path: string,
    replacements: Array<{ oldText: string; newText: string }>,
    operations: PptxEditOperation[],
): Promise<Record<string, number>> {
    const zip = await loadZip(path)
    let replacementCount = 0
    let slideAddCount = 0
    let slideDeleteCount = 0
    if (replacements.length > 0) {
        replacementCount += await applyPptxReplacements(zip, replacements)
    }
    for (const operation of operations) {
        if (operation.type === 'replace') {
            replacementCount += await applyPptxReplacements(zip, [
                {
                    oldText: operation.oldText,
                    newText: operation.newText,
                },
            ])
        } else if (operation.type === 'addSlide') {
            await addSlide(zip, operation.slide)
            slideAddCount += 1
        } else {
            await deleteSlide(zip, operation.slide)
            slideDeleteCount += 1
        }
    }
    if (replacementCount + slideAddCount + slideDeleteCount === 0) {
        fail('At least one PPTX edit operation is required')
    }
    await saveZip(zip, path)
    return {
        replacementCount,
        slideAddCount,
        slideDeleteCount,
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
        await createPptx(path, normalizeSlides(content))
        printJson({
            operation: command.operation,
            format: 'pptx',
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
            format: 'pptx',
            root,
            path: requiredOption(command.options, 'path'),
            ...(await inspectPptx(path)),
        })
        return
    }
    if (command.operation === 'validate') {
        printJson({
            operation: command.operation,
            format: 'pptx',
            root,
            path: requiredOption(command.options, 'path'),
            validation: await validateOfficePackage(path, [
                '[Content_Types].xml',
                '_rels/.rels',
                'ppt/presentation.xml',
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
            format: 'pptx',
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
        const operations = normalizePptxOperations(
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
            format: 'pptx',
            root,
            path: requiredOption(command.options, 'path'),
            ...(await editPptx(path, replacements, operations)),
        })
        return
    }
    fail('Operation must be create, inspect, edit, validate, or render')
}

main().catch(printError)
