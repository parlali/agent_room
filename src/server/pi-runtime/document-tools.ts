import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { access, mkdtemp, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { Document, Packer, Paragraph, TextRun } from 'docx'
import pptxgen from 'pptxgenjs'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import * as XLSX from 'xlsx'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import {
    defineTool,
    type AgentToolResult,
    type ToolDefinition,
} from '@mariozechner/pi-coding-agent'
import { Type } from '@mariozechner/pi-ai'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import { buildBoundedProcessEnv } from '../security/process-env'
import {
    ensureShellWritableDirectory,
    ensureShellWritableFile,
    resolveShellSandboxIdentity,
    type ShellSandboxIdentity,
} from './shell-sandbox'
import { currentToolRunContext } from './tool-run-context'

interface DocumentToolContext {
    config: PiRuntimeConfig
    audit: (event: string, payload: unknown) => Promise<void>
}

interface DocumentToolDetails {
    path?: string
    artifactId?: string
    sha256?: string
    byteLength?: number
    mediaType?: string
    exportedPath?: string
    previewPath?: string
    operation?: string
    format?: string
    durationMs?: number
}

interface Replacement {
    oldText: string
    newText: string
}

interface WorkbookCellEdit {
    sheet?: string
    cell: string
    value?: unknown
    formula?: string
}

interface WorkbookChartInput {
    type?: 'bar' | 'line' | 'pie'
    title?: string
    seriesName?: string
    labelsRange: string
    valuesRange: string
    anchor?: string
}

interface WorkbookSheetInput {
    name: string
    rows: unknown[][]
    charts: WorkbookChartInput[]
}

interface SlideInput {
    title: string
    bullets?: string[]
    notes?: string
    imagePath?: string
    chart?: {
        type?: 'bar' | 'line' | 'pie'
        labels: string[]
        values: number[]
        name?: string
    }
}

const xmlTextRegex = /<(?:w:t|a:t)[^>]*>([\s\S]*?)<\/(?:w:t|a:t)>/g
const maxExtractedTextBytes = 128000

function textResult(
    text: string,
    details: DocumentToolDetails = {},
): AgentToolResult<DocumentToolDetails> {
    return {
        content: [
            {
                type: 'text',
                text,
            },
        ],
        details,
    }
}

function sha256Buffer(buffer: Buffer | string): string {
    return createHash('sha256').update(buffer).digest('hex')
}

function assertInside(candidate: string, root: string): string {
    const normalizedRoot = resolve(root)
    const normalizedCandidate = resolve(candidate)
    const diff = relative(normalizedRoot, normalizedCandidate)
    if (diff === '' || (!diff.startsWith('..') && !isAbsolute(diff))) {
        return normalizedCandidate
    }
    throw new Error(`Path escapes allowed root: ${candidate}`)
}

function workspacePath(config: PiRuntimeConfig, path: string): string {
    const requested = path.trim()
    if (!requested) {
        throw new Error('Path cannot be empty')
    }
    return assertInside(
        isAbsolute(requested) ? requested : join(config.paths.workspaceDir, requested),
        config.paths.workspaceDir,
    )
}

function isNotFoundFsError(error: unknown): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        String((error as { code: unknown }).code) === 'ENOENT'
    )
}

async function nearestExistingParent(path: string, root: string): Promise<string> {
    let current = dirname(path)
    while (true) {
        assertInside(current, root)
        try {
            await access(current, fsConstants.F_OK)
            return current
        } catch (error) {
            if (!isNotFoundFsError(error)) {
                throw error
            }
            const next = dirname(current)
            if (next === current) {
                throw new Error(`No existing parent for ${path}`)
            }
            current = next
        }
    }
}

async function existingWorkspacePath(config: PiRuntimeConfig, path: string): Promise<string> {
    const root = await realpath(config.paths.workspaceDir)
    const requested = workspacePath(config, path)
    return assertInside(await realpath(requested), root)
}

async function writableWorkspacePath(config: PiRuntimeConfig, path: string): Promise<string> {
    const root = await realpath(config.paths.workspaceDir)
    const requested = workspacePath(config, path)
    try {
        return assertInside(await realpath(requested), root)
    } catch (error) {
        if (!isNotFoundFsError(error)) {
            throw error
        }
    }
    const parent = await nearestExistingParent(requested, config.paths.workspaceDir)
    assertInside(await realpath(parent), root)
    return requested
}

async function assertExists(path: string): Promise<void> {
    await access(path, fsConstants.F_OK)
}

function mediaTypeFor(path: string): string {
    const extension = extname(path).toLowerCase()
    if (extension === '.docx') {
        return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    }
    if (extension === '.xlsx') {
        return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }
    if (extension === '.pptx') {
        return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    }
    if (extension === '.pdf') {
        return 'application/pdf'
    }
    if (extension === '.png') {
        return 'image/png'
    }
    return 'application/octet-stream'
}

function artifactIdFor(path: string, sha256: string): string {
    const base = basename(path, extname(path))
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
    return `${base || 'artifact'}-${sha256.slice(0, 16)}`
}

async function promoteArtifact(
    ctx: DocumentToolContext,
    path: string,
): Promise<{
    artifactId: string
    sha256: string
    byteLength: number
}> {
    const buffer = await readFile(path)
    const sha256 = sha256Buffer(buffer)
    const artifactId = artifactIdFor(path, sha256)
    const blobPath = join(ctx.config.paths.storeDir, 'blobs', sha256)
    const manifestPath = join(ctx.config.paths.storeDir, 'manifests', `${artifactId}.json`)
    const runContext = currentToolRunContext()
    await ensureShellWritableDirectory(dirname(blobPath))
    await ensureShellWritableDirectory(dirname(manifestPath))
    await writeFile(blobPath, buffer)
    await ensureShellWritableFile(blobPath)
    await writeFile(
        manifestPath,
        JSON.stringify(
            {
                artifactId,
                sha256,
                byteLength: buffer.byteLength,
                mediaType: mediaTypeFor(path),
                sourcePath: relative(ctx.config.paths.workspaceDir, path),
                createdAt: new Date().toISOString(),
                sessionKey: runContext?.sessionKey ?? null,
                runId: runContext?.runId ?? null,
            },
            null,
            4,
        ),
        'utf8',
    )
    await ensureShellWritableFile(manifestPath)
    return {
        artifactId,
        sha256,
        byteLength: buffer.byteLength,
    }
}

function parseJson<T>(value: unknown, fallback: T): T {
    if (typeof value !== 'string' || !value.trim()) {
        return fallback
    }
    return JSON.parse(value) as T
}

function normalizeReplacements(value: unknown): Replacement[] {
    const parsed = parseJson<unknown>(value, [])
    if (!Array.isArray(parsed)) {
        throw new Error('Replacements must be a JSON array')
    }
    return parsed.map((entry) => {
        if (!entry || typeof entry !== 'object') {
            throw new Error('Each replacement must be an object')
        }
        const record = entry as Record<string, unknown>
        if (typeof record.oldText !== 'string' || typeof record.newText !== 'string') {
            throw new Error('Each replacement must include oldText and newText')
        }
        return {
            oldText: record.oldText,
            newText: record.newText,
        }
    })
}

function normalizeWorkbookEdits(value: unknown): Array<Replacement | WorkbookCellEdit> {
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

function xmlEscape(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;')
}

function xmlDecode(value: string): string {
    return value
        .replaceAll('&apos;', "'")
        .replaceAll('&quot;', '"')
        .replaceAll('&gt;', '>')
        .replaceAll('&lt;', '<')
        .replaceAll('&amp;', '&')
}

function extractXmlText(xml: string): string {
    const rows: string[] = []
    for (const match of xml.matchAll(xmlTextRegex)) {
        rows.push(xmlDecode(match[1] ?? ''))
    }
    return rows.join('\n')
}

function boundExtractedText(text: string): string {
    const buffer = Buffer.from(text)
    return buffer.byteLength <= maxExtractedTextBytes
        ? text
        : `${buffer.subarray(0, maxExtractedTextBytes).toString('utf8')}\n[truncated]`
}

async function writeWorkspaceFile(path: string, buffer: Buffer): Promise<void> {
    await ensureShellWritableDirectory(dirname(path))
    await writeFile(path, buffer)
    await ensureShellWritableFile(path)
}

function replaceZipText(input: {
    buffer: Buffer
    paths: (path: string) => boolean
    replacements: Replacement[]
}): {
    buffer: Buffer
    replacementCount: number
} {
    const zip = unzipSync(new Uint8Array(input.buffer))
    let replacementCount = 0
    for (const path of Object.keys(zip)) {
        if (!input.paths(path)) {
            continue
        }
        let xml = strFromU8(zip[path]!)
        for (const replacement of input.replacements) {
            const oldText = xmlEscape(replacement.oldText)
            const newText = xmlEscape(replacement.newText)
            const before = xml
            xml = xml.split(oldText).join(newText)
            if (before !== xml) {
                replacementCount += 1
            }
        }
        zip[path] = strToU8(xml)
    }
    if (replacementCount === 0) {
        throw new Error('No replacement text was found')
    }
    return {
        buffer: Buffer.from(zipSync(zip)),
        replacementCount,
    }
}

async function runWorker(input: {
    config: PiRuntimeConfig
    command: string
    args: string[]
    cwd: string
    timeoutMs: number
    signal?: AbortSignal
}): Promise<string> {
    return await new Promise((resolvePromise, reject) => {
        let settled = false
        const identity = currentWorkerSandboxIdentity()
        const child = spawn(input.command, input.args, {
            cwd: input.cwd,
            detached: true,
            env: buildBoundedProcessEnv({
                HOME: input.config.paths.homeDir,
                TMPDIR: input.config.paths.tmpDir,
                AGENT_ROOM_ROOM_ID: input.config.runtime.roomId,
                AGENT_ROOM_WORKSPACE_DIR: input.config.paths.workspaceDir,
                AGENT_ROOM_STORE_DIR: input.config.paths.storeDir,
            }),
            stdio: ['ignore', 'pipe', 'pipe'],
            ...(identity.uid === undefined ? {} : { uid: identity.uid }),
            ...(identity.gid === undefined ? {} : { gid: identity.gid }),
        })
        let output = ''
        let timer: ReturnType<typeof setTimeout> | null = null
        let abort: () => void = () => {}
        const finish = (error: Error | null, value = '') => {
            if (settled) {
                return
            }
            settled = true
            if (timer) {
                clearTimeout(timer)
            }
            input.signal?.removeEventListener('abort', abort)
            if (error) {
                reject(error)
            } else {
                resolvePromise(value)
            }
        }
        const terminate = (signal: NodeJS.Signals) => {
            if (child.pid) {
                try {
                    process.kill(-child.pid, signal)
                    return
                } catch {}
            }
            child.kill(signal)
        }
        const terminateWithEscalation = () => {
            terminate('SIGTERM')
            setTimeout(() => {
                if (child.exitCode === null && child.signalCode === null) {
                    terminate('SIGKILL')
                }
            }, 2000).unref()
        }
        abort = () => {
            terminateWithEscalation()
            finish(new Error(`${input.command} aborted`))
        }
        const append = (chunk: Buffer) => {
            output = `${output}${chunk.toString('utf8')}`.slice(-12000)
        }
        timer = setTimeout(() => {
            terminateWithEscalation()
            finish(new Error(`${input.command} timed out`))
        }, input.timeoutMs)
        timer.unref()
        input.signal?.addEventListener('abort', abort, { once: true })
        child.stdout.on('data', append)
        child.stderr.on('data', append)
        child.on('error', (error) => finish(error))
        child.on('close', (exitCode) => {
            if (exitCode === 0) {
                finish(null, output)
            } else {
                finish(new Error(`${input.command} failed with exit code ${exitCode}: ${output}`))
            }
        })
    })
}

function currentWorkerSandboxIdentity(): ShellSandboxIdentity {
    return resolveShellSandboxIdentity({
        nodeEnv: process.env.NODE_ENV,
        unsafeAllowUnsandboxed: process.env.AGENT_ROOM_UNSAFE_ALLOW_UNSANDBOXED_SHELL,
        uid: typeof process.getuid === 'function' ? process.getuid() : null,
    })
}

async function exportOfficeToPdf(
    ctx: DocumentToolContext,
    inputPath: string,
    outputPath: string,
    signal?: AbortSignal,
): Promise<void> {
    await assertExists(inputPath)
    const tempDir = await mkdtemp(join(ctx.config.paths.tmpDir, 'office-export-'))
    await runWorker({
        config: ctx.config,
        command: 'soffice',
        args: [
            '--headless',
            '--nologo',
            '--nofirststartwizard',
            '--convert-to',
            'pdf',
            '--outdir',
            tempDir,
            inputPath,
        ],
        cwd: ctx.config.paths.workspaceDir,
        timeoutMs: ctx.config.budgets.documentWorkerMs,
        signal,
    })
    const generatedPath = join(tempDir, `${basename(inputPath, extname(inputPath))}.pdf`)
    await ensureShellWritableDirectory(dirname(outputPath))
    await rename(generatedPath, outputPath)
    await ensureShellWritableFile(outputPath)
}

async function renderPdfPreview(
    ctx: DocumentToolContext,
    inputPath: string,
    outputPath: string,
    signal?: AbortSignal,
): Promise<void> {
    await runWorker({
        config: ctx.config,
        command: 'pdftoppm',
        args: ['-png', '-f', '1', '-singlefile', inputPath, outputPath.replace(/\.png$/i, '')],
        cwd: ctx.config.paths.workspaceDir,
        timeoutMs: ctx.config.budgets.documentWorkerMs,
        signal,
    })
    await ensureShellWritableFile(outputPath)
}

async function createDocx(
    path: string,
    title: string | undefined,
    paragraphs: string[],
): Promise<void> {
    const children: Paragraph[] = []
    if (title?.trim()) {
        children.push(
            new Paragraph({
                children: [
                    new TextRun({
                        text: title.trim(),
                        bold: true,
                        size: 32,
                    }),
                ],
            }),
        )
    }
    for (const paragraph of paragraphs) {
        children.push(
            new Paragraph({
                text: paragraph,
            }),
        )
    }
    const document = new Document({
        sections: [
            {
                children,
            },
        ],
    })
    await writeWorkspaceFile(path, await Packer.toBuffer(document))
}

async function inspectDocx(path: string): Promise<string> {
    const zip = unzipSync(new Uint8Array(await readFile(path)))
    const xml = zip['word/document.xml']
    if (!xml) {
        throw new Error('DOCX document.xml was not found')
    }
    return boundExtractedText(extractXmlText(strFromU8(xml)))
}

async function editDocx(path: string, replacements: Replacement[]): Promise<number> {
    const updated = replaceZipText({
        buffer: await readFile(path),
        paths: (entryPath) => entryPath === 'word/document.xml',
        replacements,
    })
    await writeWorkspaceFile(path, updated.buffer)
    return updated.replacementCount
}

function normalizeWorkbook(value: unknown): WorkbookSheetInput[] {
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

async function createXlsx(path: string, sheets: WorkbookSheetInput[]): Promise<void> {
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

async function inspectXlsx(path: string): Promise<string> {
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

async function editXlsx(
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

function normalizeSlides(value: unknown): SlideInput[] {
    const parsed = parseJson<unknown>(value, [])
    if (!Array.isArray(parsed)) {
        throw new Error('Slides JSON must be an array')
    }
    return parsed.map((entry, index) => {
        if (!entry || typeof entry !== 'object') {
            throw new Error('Each slide must be an object')
        }
        const record = entry as Record<string, unknown>
        const chart =
            record.chart && typeof record.chart === 'object'
                ? (record.chart as SlideInput['chart'])
                : undefined
        return {
            title:
                typeof record.title === 'string' && record.title.trim()
                    ? record.title
                    : `Slide ${index + 1}`,
            bullets: Array.isArray(record.bullets)
                ? record.bullets.filter((item): item is string => typeof item === 'string')
                : [],
            notes: typeof record.notes === 'string' ? record.notes : undefined,
            imagePath: typeof record.imagePath === 'string' ? record.imagePath : undefined,
            chart,
        }
    })
}

async function createPptx(
    ctx: DocumentToolContext,
    path: string,
    slides: SlideInput[],
): Promise<void> {
    const pptx = new pptxgen()
    pptx.layout = 'LAYOUT_WIDE'
    pptx.author = 'Agent Room'
    for (const slideInput of slides.length > 0 ? slides : [{ title: 'Untitled' }]) {
        const slide = pptx.addSlide()
        slide.background = { color: 'FFFFFF' }
        slide.addText(slideInput.title, {
            x: 0.55,
            y: 0.35,
            w: 12.2,
            h: 0.6,
            fontFace: 'Aptos Display',
            fontSize: 28,
            bold: true,
            color: '111827',
            margin: 0.05,
        })
        if (slideInput.bullets && slideInput.bullets.length > 0) {
            slide.addText(slideInput.bullets.map((item) => `- ${item}`).join('\n'), {
                x: 0.75,
                y: 1.2,
                w: 6.2,
                h: 4.8,
                fontFace: 'Aptos',
                fontSize: 18,
                color: '1f2937',
                breakLine: false,
                fit: 'shrink',
            })
        }
        if (slideInput.chart && slideInput.chart.labels.length > 0) {
            const chartType =
                slideInput.chart.type === 'line'
                    ? pptx.ChartType.line
                    : slideInput.chart.type === 'pie'
                      ? pptx.ChartType.pie
                      : pptx.ChartType.bar
            slide.addChart(
                chartType,
                [
                    {
                        name: slideInput.chart.name ?? 'Series',
                        labels: slideInput.chart.labels,
                        values: slideInput.chart.values,
                    },
                ],
                {
                    x: 7.1,
                    y: 1.2,
                    w: 5.5,
                    h: 3.9,
                    showLegend: false,
                    showValue: true,
                },
            )
        }
        if (slideInput.imagePath) {
            const imagePath = await existingWorkspacePath(ctx.config, slideInput.imagePath)
            slide.addImage({
                path: imagePath,
                x: 7.1,
                y: 1.2,
                w: 5.5,
                h: 3.9,
                sizing: {
                    type: 'cover',
                    w: 5.5,
                    h: 3.9,
                },
            })
        }
        if (slideInput.notes) {
            slide.addNotes(slideInput.notes)
        }
    }
    await ensureShellWritableDirectory(dirname(path))
    await pptx.writeFile({
        fileName: path,
    })
    await ensureShellWritableFile(path)
}

async function inspectPptx(path: string): Promise<string> {
    const zip = unzipSync(new Uint8Array(await readFile(path)))
    const parts = Object.entries(zip)
        .filter(([entryPath]) => /^ppt\/slides\/slide\d+\.xml$/.test(entryPath))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([entryPath, content]) => `${entryPath}\n${extractXmlText(strFromU8(content))}`)
    return boundExtractedText(parts.join('\n\n'))
}

async function editPptx(path: string, replacements: Replacement[]): Promise<number> {
    const updated = replaceZipText({
        buffer: await readFile(path),
        paths: (entryPath) => /^ppt\/slides\/slide\d+\.xml$/.test(entryPath),
        replacements,
    })
    await writeWorkspaceFile(path, updated.buffer)
    return updated.replacementCount
}

async function createPdf(
    path: string,
    title: string | undefined,
    paragraphs: string[],
): Promise<void> {
    const pdf = await PDFDocument.create()
    const regularFont = await pdf.embedFont(StandardFonts.Helvetica)
    const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold)
    let page = pdf.addPage([612, 792])
    let y = 740
    if (title?.trim()) {
        page.drawText(title.trim(), {
            x: 54,
            y,
            size: 20,
            font: boldFont,
            color: rgb(0.08, 0.1, 0.14),
        })
        y -= 42
    }
    for (const paragraph of paragraphs) {
        const words = paragraph.split(/\s+/)
        let line = ''
        for (const word of words) {
            const candidate = line ? `${line} ${word}` : word
            if (regularFont.widthOfTextAtSize(candidate, 11) > 500) {
                page.drawText(line, {
                    x: 54,
                    y,
                    size: 11,
                    font: regularFont,
                    color: rgb(0.12, 0.16, 0.22),
                })
                y -= 16
                line = word
            } else {
                line = candidate
            }
            if (y < 60) {
                page = pdf.addPage([612, 792])
                y = 740
            }
        }
        if (line) {
            page.drawText(line, {
                x: 54,
                y,
                size: 11,
                font: regularFont,
                color: rgb(0.12, 0.16, 0.22),
            })
            y -= 24
        }
    }
    await writeWorkspaceFile(path, Buffer.from(await pdf.save()))
}

async function inspectPdf(path: string): Promise<string> {
    const buffer = await readFile(path)
    return `PDF file\nPath: ${path}\nBytes: ${buffer.byteLength}\nSHA-256: ${sha256Buffer(buffer)}`
}

async function completeOperation(
    ctx: DocumentToolContext,
    input: {
        path: string
        format: string
        operation: string
        startedAt: number
        message: string
        mediaPath?: string
    },
): Promise<AgentToolResult<DocumentToolDetails>> {
    const artifact = input.mediaPath ? await promoteArtifact(ctx, input.mediaPath) : null
    const durationMs = Date.now() - input.startedAt
    await ctx.audit(`tool.${input.format}`, {
        operation: input.operation,
        path: input.path,
        durationMs,
        artifactId: artifact?.artifactId,
        sha256: artifact?.sha256,
        byteLength: artifact?.byteLength,
    })
    return textResult(input.message, {
        path: input.path,
        format: input.format,
        operation: input.operation,
        artifactId: artifact?.artifactId,
        sha256: artifact?.sha256,
        byteLength: artifact?.byteLength,
        durationMs,
        mediaType: input.mediaPath ? mediaTypeFor(input.mediaPath) : undefined,
    })
}

function createDocxTool(ctx: DocumentToolContext): ToolDefinition {
    return defineTool({
        name: 'agent_room_docx',
        label: 'Word Document',
        description: 'Create, inspect, edit, export, or preview DOCX documents.',
        promptSnippet:
            'agent_room_docx performs structured DOCX operations and promotes outputs as durable artifacts.',
        parameters: Type.Object({
            operation: Type.Union([
                Type.Literal('create'),
                Type.Literal('inspect'),
                Type.Literal('edit'),
                Type.Literal('export_pdf'),
                Type.Literal('preview'),
            ]),
            path: Type.String(),
            title: Type.Optional(Type.String()),
            paragraphs: Type.Optional(Type.Array(Type.String())),
            replacementsJson: Type.Optional(Type.String()),
            outputPath: Type.Optional(Type.String()),
        }),
        executionMode: 'sequential',
        execute: async (_toolCallId, input, signal) => {
            const startedAt = Date.now()
            if (input.operation === 'create') {
                const path = await writableWorkspacePath(ctx.config, input.path)
                await createDocx(path, input.title, input.paragraphs ?? [])
                return completeOperation(ctx, {
                    path,
                    format: 'docx',
                    operation: input.operation,
                    startedAt,
                    message: `Created DOCX ${relative(ctx.config.paths.workspaceDir, path)}`,
                    mediaPath: path,
                })
            }
            const path = await existingWorkspacePath(ctx.config, input.path)
            if (input.operation === 'inspect') {
                return textResult(await inspectDocx(path), {
                    path,
                    format: 'docx',
                    operation: input.operation,
                })
            }
            if (input.operation === 'edit') {
                const count = await editDocx(path, normalizeReplacements(input.replacementsJson))
                return completeOperation(ctx, {
                    path,
                    format: 'docx',
                    operation: input.operation,
                    startedAt,
                    message: `Edited DOCX ${relative(ctx.config.paths.workspaceDir, path)} with ${count} replacements`,
                    mediaPath: path,
                })
            }
            const outputPath = await writableWorkspacePath(
                ctx.config,
                input.outputPath ?? `${input.path.replace(/\.docx$/i, '')}.pdf`,
            )
            await exportOfficeToPdf(ctx, path, outputPath, signal)
            if (input.operation === 'preview') {
                const previewPath = await writableWorkspacePath(
                    ctx.config,
                    `${input.outputPath ?? input.path}.preview.png`,
                )
                await renderPdfPreview(ctx, outputPath, previewPath, signal)
                return completeOperation(ctx, {
                    path: previewPath,
                    format: 'docx',
                    operation: input.operation,
                    startedAt,
                    message: `Rendered DOCX preview ${relative(ctx.config.paths.workspaceDir, previewPath)}`,
                    mediaPath: previewPath,
                })
            }
            return completeOperation(ctx, {
                path: outputPath,
                format: 'docx',
                operation: input.operation,
                startedAt,
                message: `Exported DOCX PDF ${relative(ctx.config.paths.workspaceDir, outputPath)}`,
                mediaPath: outputPath,
            })
        },
    })
}

function createXlsxTool(ctx: DocumentToolContext): ToolDefinition {
    return defineTool({
        name: 'agent_room_xlsx',
        label: 'Workbook',
        description: 'Create, inspect, edit, export, or preview XLSX workbooks.',
        promptSnippet:
            'agent_room_xlsx performs structured workbook operations with rows, formulas, charts, cell edits, and durable exports. workbookJson is a JSON array of sheets like [{"name":"Data","rows":[["Item","Qty"],["A",1]],"charts":[{"type":"bar","title":"Totals","labelsRange":"A2:A4","valuesRange":"D2:D4","anchor":"F2"}]}]. replacementsJson accepts [{"oldText":"A","newText":"B"}] or direct cell edits like [{"sheet":"Data","cell":"B2","value":12}].',
        parameters: Type.Object({
            operation: Type.Union([
                Type.Literal('create'),
                Type.Literal('inspect'),
                Type.Literal('edit'),
                Type.Literal('export_pdf'),
                Type.Literal('preview'),
            ]),
            path: Type.String(),
            workbookJson: Type.Optional(Type.String()),
            replacementsJson: Type.Optional(Type.String()),
            outputPath: Type.Optional(Type.String()),
        }),
        executionMode: 'sequential',
        execute: async (_toolCallId, input, signal) => {
            const startedAt = Date.now()
            if (input.operation === 'create') {
                const path = await writableWorkspacePath(ctx.config, input.path)
                await createXlsx(path, normalizeWorkbook(input.workbookJson))
                return completeOperation(ctx, {
                    path,
                    format: 'xlsx',
                    operation: input.operation,
                    startedAt,
                    message: `Created XLSX ${relative(ctx.config.paths.workspaceDir, path)}`,
                    mediaPath: path,
                })
            }
            const path = await existingWorkspacePath(ctx.config, input.path)
            if (input.operation === 'inspect') {
                return textResult(await inspectXlsx(path), {
                    path,
                    format: 'xlsx',
                    operation: input.operation,
                })
            }
            if (input.operation === 'edit') {
                const count = await editXlsx(path, normalizeWorkbookEdits(input.replacementsJson))
                return completeOperation(ctx, {
                    path,
                    format: 'xlsx',
                    operation: input.operation,
                    startedAt,
                    message: `Edited XLSX ${relative(ctx.config.paths.workspaceDir, path)} with ${count} replacements`,
                    mediaPath: path,
                })
            }
            const outputPath = await writableWorkspacePath(
                ctx.config,
                input.outputPath ?? `${input.path.replace(/\.xlsx$/i, '')}.pdf`,
            )
            await exportOfficeToPdf(ctx, path, outputPath, signal)
            if (input.operation === 'preview') {
                const previewPath = await writableWorkspacePath(
                    ctx.config,
                    `${input.outputPath ?? input.path}.preview.png`,
                )
                await renderPdfPreview(ctx, outputPath, previewPath, signal)
                return completeOperation(ctx, {
                    path: previewPath,
                    format: 'xlsx',
                    operation: input.operation,
                    startedAt,
                    message: `Rendered XLSX preview ${relative(ctx.config.paths.workspaceDir, previewPath)}`,
                    mediaPath: previewPath,
                })
            }
            return completeOperation(ctx, {
                path: outputPath,
                format: 'xlsx',
                operation: input.operation,
                startedAt,
                message: `Exported XLSX PDF ${relative(ctx.config.paths.workspaceDir, outputPath)}`,
                mediaPath: outputPath,
            })
        },
    })
}

function createPptxTool(ctx: DocumentToolContext): ToolDefinition {
    return defineTool({
        name: 'agent_room_pptx',
        label: 'Presentation',
        description: 'Create, inspect, edit, export, or preview PPTX presentations.',
        promptSnippet:
            'agent_room_pptx creates structured slides with text, images, charts, exports, and previews.',
        parameters: Type.Object({
            operation: Type.Union([
                Type.Literal('create'),
                Type.Literal('inspect'),
                Type.Literal('edit'),
                Type.Literal('export_pdf'),
                Type.Literal('preview'),
            ]),
            path: Type.String(),
            slidesJson: Type.Optional(Type.String()),
            replacementsJson: Type.Optional(Type.String()),
            outputPath: Type.Optional(Type.String()),
        }),
        executionMode: 'sequential',
        execute: async (_toolCallId, input, signal) => {
            const startedAt = Date.now()
            if (input.operation === 'create') {
                const path = await writableWorkspacePath(ctx.config, input.path)
                await createPptx(ctx, path, normalizeSlides(input.slidesJson))
                return completeOperation(ctx, {
                    path,
                    format: 'pptx',
                    operation: input.operation,
                    startedAt,
                    message: `Created PPTX ${relative(ctx.config.paths.workspaceDir, path)}`,
                    mediaPath: path,
                })
            }
            const path = await existingWorkspacePath(ctx.config, input.path)
            if (input.operation === 'inspect') {
                return textResult(await inspectPptx(path), {
                    path,
                    format: 'pptx',
                    operation: input.operation,
                })
            }
            if (input.operation === 'edit') {
                const count = await editPptx(path, normalizeReplacements(input.replacementsJson))
                return completeOperation(ctx, {
                    path,
                    format: 'pptx',
                    operation: input.operation,
                    startedAt,
                    message: `Edited PPTX ${relative(ctx.config.paths.workspaceDir, path)} with ${count} replacements`,
                    mediaPath: path,
                })
            }
            const outputPath = await writableWorkspacePath(
                ctx.config,
                input.outputPath ?? `${input.path.replace(/\.pptx$/i, '')}.pdf`,
            )
            await exportOfficeToPdf(ctx, path, outputPath, signal)
            if (input.operation === 'preview') {
                const previewPath = await writableWorkspacePath(
                    ctx.config,
                    `${input.outputPath ?? input.path}.preview.png`,
                )
                await renderPdfPreview(ctx, outputPath, previewPath, signal)
                return completeOperation(ctx, {
                    path: previewPath,
                    format: 'pptx',
                    operation: input.operation,
                    startedAt,
                    message: `Rendered PPTX preview ${relative(ctx.config.paths.workspaceDir, previewPath)}`,
                    mediaPath: previewPath,
                })
            }
            return completeOperation(ctx, {
                path: outputPath,
                format: 'pptx',
                operation: input.operation,
                startedAt,
                message: `Exported PPTX PDF ${relative(ctx.config.paths.workspaceDir, outputPath)}`,
                mediaPath: outputPath,
            })
        },
    })
}

function createPdfTool(ctx: DocumentToolContext): ToolDefinition {
    return defineTool({
        name: 'agent_room_pdf',
        label: 'PDF',
        description: 'Create, inspect, or preview PDF files.',
        promptSnippet:
            'agent_room_pdf creates durable PDF outputs and renders page previews when requested.',
        parameters: Type.Object({
            operation: Type.Union([
                Type.Literal('create'),
                Type.Literal('inspect'),
                Type.Literal('preview'),
            ]),
            path: Type.String(),
            title: Type.Optional(Type.String()),
            paragraphs: Type.Optional(Type.Array(Type.String())),
            outputPath: Type.Optional(Type.String()),
        }),
        executionMode: 'sequential',
        execute: async (_toolCallId, input, signal) => {
            const startedAt = Date.now()
            if (input.operation === 'create') {
                const path = await writableWorkspacePath(ctx.config, input.path)
                await createPdf(path, input.title, input.paragraphs ?? [])
                return completeOperation(ctx, {
                    path,
                    format: 'pdf',
                    operation: input.operation,
                    startedAt,
                    message: `Created PDF ${relative(ctx.config.paths.workspaceDir, path)}`,
                    mediaPath: path,
                })
            }
            const path = await existingWorkspacePath(ctx.config, input.path)
            if (input.operation === 'inspect') {
                return textResult(await inspectPdf(path), {
                    path,
                    format: 'pdf',
                    operation: input.operation,
                })
            }
            const previewPath = await writableWorkspacePath(
                ctx.config,
                input.outputPath ?? `${input.path}.preview.png`,
            )
            await renderPdfPreview(ctx, path, previewPath, signal)
            return completeOperation(ctx, {
                path: previewPath,
                format: 'pdf',
                operation: input.operation,
                startedAt,
                message: `Rendered PDF preview ${relative(ctx.config.paths.workspaceDir, previewPath)}`,
                mediaPath: previewPath,
            })
        },
    })
}

export function createDocumentTools(ctx: DocumentToolContext): ToolDefinition[] {
    const tools: ToolDefinition[] = []
    if (ctx.config.capabilities.documents) {
        tools.push(createDocxTool(ctx))
    }
    if (ctx.config.capabilities.spreadsheets) {
        tools.push(createXlsxTool(ctx))
    }
    if (ctx.config.capabilities.presentations) {
        tools.push(createPptxTool(ctx))
    }
    if (ctx.config.capabilities.pdf) {
        tools.push(createPdfTool(ctx))
    }
    return tools
}
