import JSZip from 'jszip'
import {
    elementsByLocalName,
    ensureParent,
    fail,
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

interface SlideInput {
    title: string
    bullets: string[]
}

interface SlideInspection {
    part: string
    slide: number
    paragraphs: string[]
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
            bullets: Array.isArray(record.bullets)
                ? record.bullets.map((bullet) => String(bullet))
                : [],
        }
    })
}

function textBodyXml(lines: string[]): string {
    const paragraphs = lines
        .map((line) => `<a:p><a:r><a:t>${escapeXml(line)}</a:t></a:r></a:p>`)
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
    placeholderType: string
    x: number
    y: number
    cx: number
    cy: number
    lines: string[]
}): string {
    return [
        '<p:sp>',
        '<p:nvSpPr>',
        `<p:cNvPr id="${input.id}" name="${escapeXml(input.name)}"/>`,
        '<p:cNvSpPr/>',
        `<p:nvPr><p:ph type="${input.placeholderType}"/></p:nvPr>`,
        '</p:nvSpPr>',
        '<p:spPr>',
        `<a:xfrm><a:off x="${input.x}" y="${input.y}"/><a:ext cx="${input.cx}" cy="${input.cy}"/></a:xfrm>`,
        '</p:spPr>',
        textBodyXml(input.lines),
        '</p:sp>',
    ].join('')
}

function slideXml(slide: SlideInput, index: number): string {
    return [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        `<p:sld xmlns:a="${drawingNamespace}" xmlns:p="${presentationNamespace}" xmlns:r="${relationshipsNamespace}">`,
        '<p:cSld><p:spTree>',
        '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>',
        '<p:grpSpPr/>',
        shapeXml({
            id: index * 10 + 2,
            name: 'Title',
            placeholderType: 'title',
            x: 685800,
            y: 457200,
            cx: 10515600,
            cy: 914400,
            lines: [slide.title],
        }),
        shapeXml({
            id: index * 10 + 3,
            name: 'Content',
            placeholderType: 'body',
            x: 914400,
            y: 1828800,
            cx: 10058400,
            cy: 4114800,
            lines: slide.bullets,
        }),
        '</p:spTree></p:cSld>',
        '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>',
        '</p:sld>',
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
    writeZipText(
        zip,
        '[Content_Types].xml',
        [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
            '<Default Extension="xml" ContentType="application/xml"/>',
            '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>',
            '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
            '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
            slideOverrides,
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
        `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${packageRelationshipsNamespace}">${presentationRelationships}</Relationships>`,
    )
    slides.forEach((slide, index) => {
        writeZipText(zip, `ppt/slides/slide${index + 1}.xml`, slideXml(slide, index + 1))
    })
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
    }
}

async function editPptx(path: string, replacementsJson: string | undefined): Promise<number> {
    const replacements = normalizeReplacements(replacementsJson)
    const zip = await loadZip(path)
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
        await createPptx(path, normalizeSlides(parseJson(command.options.get('content-json'), {})))
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
    if (command.operation === 'edit') {
        requireWorkspace(root, command.operation)
        printJson({
            operation: command.operation,
            format: 'pptx',
            root,
            path: requiredOption(command.options, 'path'),
            replacementCount: await editPptx(path, command.options.get('replacements-json')),
        })
        return
    }
    fail('Operation must be create, inspect, or edit')
}

main().catch(printError)
