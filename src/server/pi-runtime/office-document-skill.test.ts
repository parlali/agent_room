import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { bundledSkillScriptPath } from './bundled-skills'
import { createPiResourceLoader } from './resource-loader'

const docxScriptPath = fileURLToPath(
    new URL('./skills/docx/scripts/docx_document.ts', import.meta.url),
)
const xlsxScriptPath = fileURLToPath(
    new URL('./skills/xlsx/scripts/xlsx_workbook.ts', import.meta.url),
)
const pptxScriptPath = fileURLToPath(new URL('./skills/pptx/scripts/pptx_deck.ts', import.meta.url))

interface ScriptRun {
    stdout: string
    stderr: string
    status: number | null
}

async function withRoom<T>(
    fn: (room: { root: string; workspace: string; store: string }) => Promise<T>,
) {
    const root = await mkdtemp(join(tmpdir(), 'agent-room-office-skill-'))
    const workspace = join(root, 'workspace')
    const store = join(root, 'store')
    await mkdir(workspace, {
        recursive: true,
    })
    await mkdir(store, {
        recursive: true,
    })
    try {
        return await fn({ root, workspace, store })
    } finally {
        await rm(root, {
            recursive: true,
            force: true,
        })
    }
}

function runSkillScript(input: {
    scriptPath: string
    workspace: string
    store: string
    args: string[]
}): Record<string, unknown> {
    const result = spawnSync('bun', [input.scriptPath, ...input.args], {
        encoding: 'utf8',
        env: {
            ...process.env,
            AGENT_ROOM_WORKSPACE_DIR: input.workspace,
            AGENT_ROOM_STORE_DIR: input.store,
        },
    }) as ScriptRun
    if (result.status !== 0) {
        throw new Error(result.stderr || result.stdout)
    }
    return JSON.parse(result.stdout) as Record<string, unknown>
}

function inspectedText(result: Record<string, unknown>): string {
    return typeof result.text === 'string' ? result.text : ''
}

async function writeZip(path: string, zip: JSZip): Promise<void> {
    await mkdir(dirname(path), {
        recursive: true,
    })
    await writeFile(
        path,
        await zip.generateAsync({
            type: 'nodebuffer',
            compression: 'DEFLATE',
        }),
    )
}

async function createDocxFixture(path: string): Promise<void> {
    const zip = new JSZip()
    zip.file(
        '[Content_Types].xml',
        [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
            '<Default Extension="xml" ContentType="application/xml"/>',
            '<Default Extension="png" ContentType="image/png"/>',
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
            '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>',
            '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>',
            '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>',
            '</Types>',
        ].join(''),
    )
    zip.file(
        '_rels/.rels',
        [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
            '</Relationships>',
        ].join(''),
    )
    zip.file(
        'word/document.xml',
        [
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
            '<w:body>',
            '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Split</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>Target</w:t></w:r></w:p>',
            '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>TableTarget</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
            '<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><w:footerReference w:type="default" r:id="rIdFooter1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></w:sectPr>',
            '</w:body>',
            '</w:document>',
        ].join(''),
    )
    zip.file(
        'word/header1.xml',
        '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Header</w:t></w:r><w:r><w:t>Target</w:t></w:r></w:p></w:hdr>',
    )
    zip.file(
        'word/footer1.xml',
        '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>FooterTarget</w:t></w:r></w:p></w:ftr>',
    )
    zip.file(
        'word/comments.xml',
        '<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment w:id="0"><w:p><w:r><w:t>CommentTarget</w:t></w:r></w:p></w:comment></w:comments>',
    )
    zip.file('word/media/image1.png', 'image bytes')
    await writeZip(path, zip)
}

async function createXlsxFixture(path: string): Promise<void> {
    const zip = new JSZip()
    zip.file(
        '[Content_Types].xml',
        [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
            '<Default Extension="xml" ContentType="application/xml"/>',
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
            '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
            '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
            '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>',
            '<Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>',
            '</Types>',
        ].join(''),
    )
    zip.file(
        '_rels/.rels',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    )
    zip.file(
        'xl/workbook.xml',
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>',
    )
    zip.file(
        'xl/_rels/workbook.xml.rels',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    )
    zip.file(
        'xl/sharedStrings.xml',
        '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="4" uniqueCount="4"><si><t>Metric</t></si><si><t>Value</t></si><si><t>Revenue</t></si><si><t>Draft label</t></si></sst>',
    )
    zip.file(
        'xl/styles.xml',
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="165" formatCode="$#,##0.00"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="165"/></cellXfs></styleSheet>',
    )
    zip.file(
        'xl/worksheets/sheet1.xml',
        [
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
            '<dimension ref="A1:C4"/>',
            '<sheetData>',
            '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>',
            '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" s="1"><v>42</v></c><c r="C2"><f>SUM(B2:B3)</f><v>42</v></c></row>',
            '<row r="4"><c r="A4" t="inlineStr"><is><t>Merged title</t></is></c></row>',
            '</sheetData>',
            '<mergeCells count="1"><mergeCell ref="A4:C4"/></mergeCells>',
            '<drawing r:id="rIdDraw1"/>',
            '</worksheet>',
        ].join(''),
    )
    zip.file(
        'xl/worksheets/_rels/sheet1.xml.rels',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdDraw1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>',
    )
    zip.file(
        'xl/drawings/drawing1.xml',
        '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/>',
    )
    zip.file(
        'xl/drawings/_rels/drawing1.xml.rels',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdChart1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>',
    )
    zip.file(
        'xl/charts/chart1.xml',
        '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/>',
    )
    await writeZip(path, zip)
}

async function createPptxFixture(path: string): Promise<void> {
    const zip = new JSZip()
    zip.file(
        '[Content_Types].xml',
        [
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
            '<Default Extension="xml" ContentType="application/xml"/>',
            '<Default Extension="png" ContentType="image/png"/>',
            '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>',
            '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>',
            '<Override PartName="/ppt/notesSlides/notesSlide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>',
            '<Override PartName="/ppt/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>',
            '</Types>',
        ].join(''),
    )
    zip.file(
        '_rels/.rels',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>',
    )
    zip.file(
        'ppt/presentation.xml',
        '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>',
    )
    zip.file(
        'ppt/slides/slide1.xml',
        [
            '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">',
            '<p:cSld><p:spTree>',
            '<p:sp><p:txBody><a:bodyPr/><a:p><a:r><a:t>Split</a:t></a:r><a:r><a:t>Title</a:t></a:r></a:p></p:txBody></p:sp>',
            '<p:graphicFrame><a:graphic><a:graphicData><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>TableTarget</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>',
            '</p:spTree></p:cSld>',
            '</p:sld>',
        ].join(''),
    )
    zip.file(
        'ppt/notesSlides/notesSlide1.xml',
        '<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>NotesTarget</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>',
    )
    zip.file(
        'ppt/charts/chart1.xml',
        '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/>',
    )
    zip.file('ppt/media/image1.png', 'image bytes')
    zip.file(
        'ppt/slideLayouts/slideLayout1.xml',
        '<p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>',
    )
    zip.file(
        'ppt/slideMasters/slideMaster1.xml',
        '<p:sldMaster xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>',
    )
    await writeZip(path, zip)
}

async function zipText(path: string, entry: string): Promise<string> {
    const zip = await JSZip.loadAsync(await readFile(path))
    const file = zip.file(entry)
    if (!file) {
        throw new Error(`${entry} not found`)
    }
    return file.async('text')
}

describe('office document skills', () => {
    it('loads bundled format-specific office skills into the Pi resource loader', () => {
        const loader = createPiResourceLoader('system prompt')
        const skillNames = loader.getSkills().skills.map((skill) => skill.name)
        expect(skillNames).toEqual(expect.arrayContaining(['docx', 'xlsx', 'pptx']))
        expect(skillNames).not.toContain('office-documents')
        expect(skillNames).not.toContain('.shared')
        const appendPrompt = loader.getAppendSystemPrompt().join('\n')
        expect(appendPrompt).toContain('docx_document.ts')
        expect(appendPrompt).toContain('xlsx_workbook.ts')
        expect(appendPrompt).toContain('pptx_deck.ts')
        expect(appendPrompt).toContain('agent_room_shell')
        expect(bundledSkillScriptPath('docx', 'scripts/docx_document.ts')).toBe(docxScriptPath)
        expect(bundledSkillScriptPath('xlsx', 'scripts/xlsx_workbook.ts')).toBe(xlsxScriptPath)
        expect(bundledSkillScriptPath('pptx', 'scripts/pptx_deck.ts')).toBe(pptxScriptPath)
    })

    it('creates, inspects, and edits generated DOCX, XLSX, and PPTX files through bundled scripts', async () => {
        await withRoom(async ({ workspace, store }) => {
            runSkillScript({
                scriptPath: docxScriptPath,
                workspace,
                store,
                args: [
                    'create',
                    '--path',
                    'artifact.docx',
                    '--content-json',
                    JSON.stringify({
                        title: 'Draft report',
                        paragraphs: ['Revenue increased'],
                    }),
                ],
            })
            runSkillScript({
                scriptPath: xlsxScriptPath,
                workspace,
                store,
                args: [
                    'create',
                    '--path',
                    'artifact.xlsx',
                    '--content-json',
                    JSON.stringify({
                        sheets: [
                            {
                                name: 'Data',
                                rows: [
                                    ['Metric', 'Value'],
                                    ['Draft report', 42],
                                ],
                            },
                        ],
                    }),
                ],
            })
            runSkillScript({
                scriptPath: pptxScriptPath,
                workspace,
                store,
                args: [
                    'create',
                    '--path',
                    'artifact.pptx',
                    '--content-json',
                    JSON.stringify({
                        slides: [
                            {
                                title: 'Draft report',
                                bullets: ['Revenue increased'],
                            },
                        ],
                    }),
                ],
            })

            runSkillScript({
                scriptPath: docxScriptPath,
                workspace,
                store,
                args: [
                    'edit',
                    '--path',
                    'artifact.docx',
                    '--replacements-json',
                    JSON.stringify([{ oldText: 'Draft report', newText: 'Final report' }]),
                ],
            })
            runSkillScript({
                scriptPath: xlsxScriptPath,
                workspace,
                store,
                args: [
                    'edit',
                    '--path',
                    'artifact.xlsx',
                    '--edits-json',
                    JSON.stringify([{ sheet: 'Data', cell: 'A2', value: 'Final report' }]),
                ],
            })
            runSkillScript({
                scriptPath: pptxScriptPath,
                workspace,
                store,
                args: [
                    'edit',
                    '--path',
                    'artifact.pptx',
                    '--replacements-json',
                    JSON.stringify([{ oldText: 'Draft report', newText: 'Final report' }]),
                ],
            })

            expect(
                inspectedText(
                    runSkillScript({
                        scriptPath: docxScriptPath,
                        workspace,
                        store,
                        args: ['inspect', '--path', 'artifact.docx'],
                    }),
                ),
            ).toContain('Final report')
            expect(
                inspectedText(
                    runSkillScript({
                        scriptPath: xlsxScriptPath,
                        workspace,
                        store,
                        args: ['inspect', '--path', 'artifact.xlsx'],
                    }),
                ),
            ).toContain('A2: Final report')
            expect(
                inspectedText(
                    runSkillScript({
                        scriptPath: pptxScriptPath,
                        workspace,
                        store,
                        args: ['inspect', '--path', 'artifact.pptx'],
                    }),
                ),
            ).toContain('Final report')
        })
    })

    it('edits DOCX split runs, tables, headers, footers, and comments without removing media parts', async () => {
        await withRoom(async ({ workspace, store }) => {
            await createDocxFixture(join(workspace, 'fixture.docx'))
            const before = inspectedText(
                runSkillScript({
                    scriptPath: docxScriptPath,
                    workspace,
                    store,
                    args: ['inspect', '--path', 'fixture.docx'],
                }),
            )
            expect(before).toContain('SplitTarget')
            expect(before).toContain('TableTarget')
            expect(before).toContain('HeaderTarget')
            expect(before).toContain('FooterTarget')
            expect(before).toContain('CommentTarget')

            runSkillScript({
                scriptPath: docxScriptPath,
                workspace,
                store,
                args: [
                    'edit',
                    '--path',
                    'fixture.docx',
                    '--replacements-json',
                    JSON.stringify([
                        { oldText: 'SplitTarget', newText: 'Merged replacement' },
                        { oldText: 'TableTarget', newText: 'Table replacement' },
                        { oldText: 'HeaderTarget', newText: 'Header replacement' },
                        { oldText: 'FooterTarget', newText: 'Footer replacement' },
                        { oldText: 'CommentTarget', newText: 'Comment replacement' },
                    ]),
                ],
            })

            const after = inspectedText(
                runSkillScript({
                    scriptPath: docxScriptPath,
                    workspace,
                    store,
                    args: ['inspect', '--path', 'fixture.docx'],
                }),
            )
            expect(after).toContain('Merged replacement')
            expect(after).toContain('Table replacement')
            expect(after).toContain('Header replacement')
            expect(after).toContain('Footer replacement')
            expect(after).toContain('Comment replacement')
            const zip = await JSZip.loadAsync(await readFile(join(workspace, 'fixture.docx')))
            expect(zip.file('word/media/image1.png')).not.toBeNull()
        })
    })

    it('edits XLSX by sheet and coordinate while preserving formulas, styles, merged cells, and charts', async () => {
        await withRoom(async ({ workspace, store }) => {
            await createXlsxFixture(join(workspace, 'fixture.xlsx'))
            const before = inspectedText(
                runSkillScript({
                    scriptPath: xlsxScriptPath,
                    workspace,
                    store,
                    args: ['inspect', '--path', 'fixture.xlsx'],
                }),
            )
            expect(before).toContain('A2: Revenue')
            expect(before).toContain('B2: 42')
            expect(before).toContain('C2: =SUM(B2:B3) formula==SUM(B2:B3)')
            expect(before).toContain('Merged: A4:C4')
            expect(before).toContain('Charts: 1')

            runSkillScript({
                scriptPath: xlsxScriptPath,
                workspace,
                store,
                args: [
                    'edit',
                    '--path',
                    'fixture.xlsx',
                    '--edits-json',
                    JSON.stringify([
                        { sheet: 'Data', cell: 'B2', value: 100 },
                        { sheet: 'Data', cell: 'D2', formula: '=B2*2' },
                    ]),
                ],
            })

            const after = inspectedText(
                runSkillScript({
                    scriptPath: xlsxScriptPath,
                    workspace,
                    store,
                    args: ['inspect', '--path', 'fixture.xlsx'],
                }),
            )
            expect(after).toContain('B2: 100')
            expect(after).toContain('C2: =SUM(B2:B3) formula==SUM(B2:B3)')
            expect(after).toContain('D2: =B2*2 formula==B2*2')
            expect(after).toContain('Merged: A4:C4')
            expect(after).toContain('Charts: 1')
            const worksheetXml = await zipText(
                join(workspace, 'fixture.xlsx'),
                'xl/worksheets/sheet1.xml',
            )
            expect(worksheetXml).toContain('<c r="B2" s="1"><v>100</v></c>')
            expect(worksheetXml).toContain('<c r="C2"><f>SUM(B2:B3)</f><v>42</v></c>')
            expect(
                await zipText(join(workspace, 'fixture.xlsx'), 'xl/charts/chart1.xml'),
            ).toContain('chartSpace')
        })
    })

    it('edits PPTX split runs, table text, and speaker notes without removing layouts, media, or charts', async () => {
        await withRoom(async ({ workspace, store }) => {
            await createPptxFixture(join(workspace, 'fixture.pptx'))
            const before = inspectedText(
                runSkillScript({
                    scriptPath: pptxScriptPath,
                    workspace,
                    store,
                    args: ['inspect', '--path', 'fixture.pptx'],
                }),
            )
            expect(before).toContain('SplitTitle')
            expect(before).toContain('TableTarget')
            expect(before).toContain('Notes: 1')
            expect(before).toContain('Charts: 1')
            expect(before).toContain('Media: 1')

            runSkillScript({
                scriptPath: pptxScriptPath,
                workspace,
                store,
                args: [
                    'edit',
                    '--path',
                    'fixture.pptx',
                    '--replacements-json',
                    JSON.stringify([
                        { oldText: 'SplitTitle', newText: 'Merged title' },
                        { oldText: 'TableTarget', newText: 'Table replacement' },
                        { oldText: 'NotesTarget', newText: 'Notes replacement' },
                    ]),
                ],
            })

            const after = inspectedText(
                runSkillScript({
                    scriptPath: pptxScriptPath,
                    workspace,
                    store,
                    args: ['inspect', '--path', 'fixture.pptx'],
                }),
            )
            expect(after).toContain('Merged title')
            expect(after).toContain('Table replacement')
            expect(after).toContain('Charts: 1')
            expect(after).toContain('Media: 1')
            const notesXml = await zipText(
                join(workspace, 'fixture.pptx'),
                'ppt/notesSlides/notesSlide1.xml',
            )
            expect(notesXml).toContain('Notes replacement')
            const zip = await JSZip.loadAsync(await readFile(join(workspace, 'fixture.pptx')))
            expect(zip.file('ppt/slideLayouts/slideLayout1.xml')).not.toBeNull()
            expect(zip.file('ppt/media/image1.png')).not.toBeNull()
            expect(zip.file('ppt/charts/chart1.xml')).not.toBeNull()
        })
    })
})
