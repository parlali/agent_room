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

/**
 * Escape XML special characters in a string.
 *
 * @param value - Input text to escape for safe inclusion in XML content
 * @returns The input string with `&`, `<`, `>`, and `"` replaced by `&amp;`, `&lt;`, `&gt;`, and `&quot;`
 */
function escapeXml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
}

/**
 * Normalize arbitrary input into a consistent array of slide descriptors.
 *
 * @param value - Input that may be an object with a `slides` property or an array of slide-like records.
 * @returns An array of `SlideInput` objects where each item has a string `title` (falls back to `Slide {n}`) and a `bullets` array of strings; if input is empty returns a single slide titled `Untitled` with no bullets.
 */
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

/**
 * Create a DrawingML `<p:txBody>` fragment representing the given paragraph lines.
 *
 * @param lines - Array of paragraph text lines to include in the text body
 * @returns A string containing the `<p:txBody>` XML with each line wrapped in `<a:p><a:r><a:t>…</a:t></a:r></a:p>`, or an empty paragraph element when `lines` is empty
 */
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

/**
 * Builds a PPTX shape XML fragment representing a slide placeholder.
 *
 * @param input - Configuration for the shape
 * @param input.id - Numeric shape id written to `p:cNvPr`
 * @param input.name - Human-readable shape name (will be XML-escaped)
 * @param input.placeholderType - Placeholder type attribute (e.g., "title", "body")
 * @param input.x - Horizontal offset (EMU) for the shape's transform
 * @param input.y - Vertical offset (EMU) for the shape's transform
 * @param input.cx - Width (EMU) for the shape's transform
 * @param input.cy - Height (EMU) for the shape's transform
 * @param input.lines - Lines of text to include in the shape's text body
 * @returns The XML string for a `<p:sp>` shape element including non-visual properties, transform, and text body
 */
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

/**
 * Build the XML for a single PPTX slide part.
 *
 * @param slide - Slide content with `title` and `bullets` to render into the slide
 * @param index - Zero-based slide index used to derive stable element IDs within the slide
 * @returns The complete XML string for the slide part (suitable for writing to ppt/slides/slideN.xml)
 */
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

/**
 * Create a minimal PPTX package from the given slides and write it to the specified filesystem path.
 *
 * Writes a ZIP-based PPTX containing the required package parts (content types, relationships, presentation,
 * per-slide XML parts, and minimal document properties) and one slide part per entry in `slides`.
 *
 * @param path - Output file path where the generated .pptx will be saved
 * @param slides - Array of slide inputs; each entry provides the slide title and bullet lines to include in that slide
 */
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

/**
 * List slide part entry names in a PPTX ZIP archive.
 *
 * @param zip - The JSZip archive representing the package
 * @returns Array of ZIP entry names matching `ppt/slides/slide<N>.xml`
 */
function slidePartNames(zip: JSZip): string[] {
    return zipFileNames(zip).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
}

/**
 * List ZIP entry names corresponding to editable slide and notes parts in a PPTX package.
 *
 * @returns An array of ZIP entry paths for slide and notes XML parts (e.g. "ppt/slides/slide1.xml", "ppt/notesSlides/notesSlide1.xml").
 */
function editablePartNames(zip: JSZip): string[] {
    return zipFileNames(zip).filter((name) =>
        /^ppt\/(slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml$/.test(name),
    )
}

/**
 * Extracts the trailing numeric slide index from a PPTX part filename.
 *
 * @param part - ZIP entry path or filename (e.g., `ppt/slides/slide3.xml`)
 * @returns The parsed numeric suffix from the filename (for example, `3` for `slide3.xml`), or `0` if no trailing number is found
 */
function slideNumber(part: string): number {
    const match = /(\d+)\.xml$/.exec(part)
    return match ? Number(match[1]) : 0
}

/**
 * Extracts text from slide parts and summarizes available PPTX parts.
 *
 * @param path - Filesystem path to the .pptx file to inspect
 * @returns An object containing:
 *  - `text`: a newline-joined string of per-slide paragraph lines and summary counts,
 *  - `slides`: an array of SlideInspection objects `{ part, slide, paragraphs }`,
 *  - `notes`, `charts`, `media`, `layouts`, `masters`: arrays of matching ZIP entry names for each part category
 */
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

/**
 * Apply text replacements across editable PPTX parts and write the updated file.
 *
 * @param path - Filesystem path to the .pptx file to modify
 * @param replacementsJson - JSON string describing replacement rules (see normalizeReplacements)
 * @returns The total number of text replacements performed across all edited parts
 * @throws Error if no replacement text was found and nothing was changed
 */
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

/**
 * Parse CLI arguments and execute a PPTX operation (`create`, `inspect`, or `edit`).
 *
 * Depending on the chosen operation:
 * - For `create`: ensure the workspace, resolve the target path, create a PPTX from provided slide data, ensure parent directories, and print a JSON summary.
 * - For `inspect`: resolve the input path, extract inspection details from the PPTX, and print a JSON report including extracted text and part counts.
 * - For `edit`: ensure the workspace, resolve the target path, apply text replacements to editable PPTX parts, and print a JSON summary including the total replacement count.
 *
 * If the operation is not one of `create`, `inspect`, or `edit`, the command fails with an error.
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
