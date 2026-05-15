import { existsSync } from 'node:fs'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import JSZip from 'jszip'
import {
    DOMParser,
    XMLSerializer,
    type Document as XmlDocument,
    type Element as XmlElement,
    type Node as XmlNode,
} from '@xmldom/xmldom'

export type { XmlDocument, XmlElement, XmlNode }

export interface Replacement {
    oldText: string
    newText: string
}

export interface ParsedCommand {
    operation: string
    options: Map<string, string>
}

export class SkillFailure extends Error {}

export function fail(message: string): never {
    throw new SkillFailure(message)
}

export function parseCommand(argv: string[]): ParsedCommand {
    const [operation, ...rest] = argv
    if (!operation) {
        fail('Operation is required')
    }
    const options = new Map<string, string>()
    for (let index = 0; index < rest.length; index += 1) {
        const key = rest[index]
        if (!key?.startsWith('--')) {
            fail(`Unexpected argument: ${key ?? ''}`)
        }
        const value = rest[index + 1]
        if (value === undefined || value.startsWith('--')) {
            fail(`Missing value for ${key}`)
        }
        options.set(key.slice(2), value)
        index += 1
    }
    return {
        operation,
        options,
    }
}

export function requiredOption(options: Map<string, string>, name: string): string {
    const value = options.get(name)
    if (value === undefined || value.length === 0) {
        fail(`--${name} is required`)
    }
    return value
}

export function optionalOption(
    options: Map<string, string>,
    name: string,
    fallback: string,
): string {
    const value = options.get(name)
    return value === undefined || value.length === 0 ? fallback : value
}

export function parseJson<T>(value: string | undefined, fallback: T): T {
    if (value === undefined || value.trim().length === 0) {
        return fallback
    }
    try {
        return JSON.parse(value) as T
    } catch (error) {
        const message = error instanceof SyntaxError ? error.message : 'invalid JSON'
        fail(`Invalid JSON: ${message}`)
    }
}

export function normalizeReplacements(value: string | undefined): Replacement[] {
    const raw = parseJson<unknown>(value, [])
    if (!Array.isArray(raw)) {
        fail('Replacements must be a JSON array')
    }
    return raw.map((entry) => {
        if (!isRecord(entry)) {
            fail('Each replacement must be an object')
        }
        if (typeof entry.oldText !== 'string' || typeof entry.newText !== 'string') {
            fail('Each replacement must include oldText and newText strings')
        }
        if (entry.oldText.length === 0) {
            fail('Replacement oldText cannot be empty')
        }
        return {
            oldText: entry.oldText,
            newText: entry.newText,
        }
    })
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function roomRoot(root: string): string {
    const key =
        root === 'workspace'
            ? 'AGENT_ROOM_WORKSPACE_DIR'
            : root === 'store'
              ? 'AGENT_ROOM_STORE_DIR'
              : ''
    if (!key) {
        fail('Root must be workspace or store')
    }
    const value = process.env[key]
    if (!value) {
        fail(`${key} is not set`)
    }
    return value
}

function assertInside(path: string, rootPath: string): void {
    const pathRelativeToRoot = relative(rootPath, path)
    if (
        pathRelativeToRoot === '..' ||
        pathRelativeToRoot.startsWith(`..${sep}`) ||
        isAbsolute(pathRelativeToRoot)
    ) {
        fail('Path escapes the selected room root')
    }
}

export async function resolveRoomPath(input: {
    root: string
    path: string
    mustExist: boolean
}): Promise<string> {
    if (isAbsolute(input.path)) {
        fail('Path must be relative to the selected room root')
    }
    const rootPath = await realpath(roomRoot(input.root))
    const joined = resolve(rootPath, input.path)
    assertInside(joined, rootPath)
    if (input.mustExist) {
        if (!existsSync(joined)) {
            fail('File does not exist')
        }
        const resolved = await realpath(joined)
        assertInside(resolved, rootPath)
        return resolved
    }
    if (existsSync(joined)) {
        assertInside(await realpath(joined), rootPath)
    }
    await mkdir(dirname(joined), {
        recursive: true,
    })
    assertInside(await realpath(dirname(joined)), rootPath)
    return joined
}

export function requireWorkspace(root: string, operation: string): void {
    if (root !== 'workspace') {
        fail(`${operation} writes are only supported in the workspace`)
    }
}

export async function ensureParent(path: string): Promise<void> {
    await mkdir(dirname(path), {
        recursive: true,
    })
}

export async function loadZip(path: string): Promise<JSZip> {
    return JSZip.loadAsync(await readFile(path))
}

export async function saveZip(zip: JSZip, path: string): Promise<void> {
    await ensureParent(path)
    const content = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
    })
    await writeFile(path, content)
}

export async function readZipText(zip: JSZip, path: string): Promise<string | null> {
    const file = zip.file(path)
    if (!file) {
        return null
    }
    return file.async('text')
}

export function writeZipText(zip: JSZip, path: string, content: string): void {
    zip.file(path, content)
}

export function zipFileNames(zip: JSZip): string[] {
    return Object.keys(zip.files)
        .filter((name) => !zip.files[name]?.dir)
        .sort()
}

export function parseXml(xml: string): XmlDocument {
    return new DOMParser().parseFromString(xml, 'application/xml')
}

export function serializeXml(document: XmlDocument): string {
    return new XMLSerializer().serializeToString(document)
}

export function localName(node: XmlNode): string {
    const value = node.localName || node.nodeName
    const separator = value.lastIndexOf(':')
    return separator >= 0 ? value.slice(separator + 1) : value
}

export function elementsByLocalName(root: XmlDocument | XmlElement, name: string): XmlElement[] {
    const nodes = root.getElementsByTagName('*')
    const elements: XmlElement[] = []
    for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes.item(index)
        if (node && localName(node) === name) {
            elements.push(node)
        }
    }
    return elements
}

export function directElementsByLocalName(root: XmlElement, name: string): XmlElement[] {
    const elements: XmlElement[] = []
    for (let index = 0; index < root.childNodes.length; index += 1) {
        const node = root.childNodes.item(index)
        if (node?.nodeType === 1 && localName(node) === name) {
            elements.push(node as XmlElement)
        }
    }
    return elements
}

export function firstElementByLocalName(
    root: XmlDocument | XmlElement,
    name: string,
): XmlElement | null {
    return elementsByLocalName(root, name)[0] ?? null
}

export function attributeByLocalName(element: XmlElement, name: string): string | null {
    for (let index = 0; index < element.attributes.length; index += 1) {
        const attribute = element.attributes.item(index)
        if (attribute && localName(attribute) === name) {
            return attribute.value
        }
    }
    return null
}

export function setElementText(element: XmlElement, value: string): void {
    const document = element.ownerDocument
    if (!document) {
        fail('XML element has no owner document')
    }
    while (element.firstChild) {
        element.removeChild(element.firstChild)
    }
    element.appendChild(document.createTextNode(value))
}

export function clearChildren(element: XmlElement): void {
    while (element.firstChild) {
        element.removeChild(element.firstChild)
    }
}

export function appendElement(input: {
    document: XmlDocument
    parent: XmlElement
    namespace: string
    name: string
    text?: string
}): XmlElement {
    const element = input.document.createElementNS(input.namespace, input.name)
    input.parent.appendChild(element)
    if (input.text !== undefined) {
        setElementText(element, input.text)
    }
    return element
}

export function textFromTextElements(root: XmlElement, textElementName: string): string {
    return elementsByLocalName(root, textElementName)
        .map((element) => element.textContent ?? '')
        .join('')
}

export function replaceAcrossTextElements(
    root: XmlElement,
    textElementName: string,
    replacements: Replacement[],
): number {
    const textElements = elementsByLocalName(root, textElementName)
    if (textElements.length === 0) {
        return 0
    }

    let segments = textElements.map((element, index) => ({
        sourceIndex: index,
        text: element.textContent ?? '',
    }))
    let count = 0
    for (const replacement of replacements) {
        const result = replaceTextSegments(segments, replacement)
        segments = result.segments
        count += result.count
    }
    if (count === 0) {
        return 0
    }
    const outputByElement = new Map<number, string>()
    for (const segment of segments) {
        outputByElement.set(
            segment.sourceIndex,
            `${outputByElement.get(segment.sourceIndex) ?? ''}${segment.text}`,
        )
    }
    textElements.forEach((element, index) => {
        setElementText(element, outputByElement.get(index) ?? '')
    })
    return count
}

interface TextSegment {
    sourceIndex: number
    text: string
}

function replaceTextSegments(
    segments: TextSegment[],
    replacement: Replacement,
): { segments: TextSegment[]; count: number } {
    const fullText = segments.map((segment) => segment.text).join('')
    const ranges: Array<{ start: number; end: number }> = []
    let offset = 0
    while (true) {
        const start = fullText.indexOf(replacement.oldText, offset)
        if (start < 0) break
        const end = start + replacement.oldText.length
        ranges.push({ start, end })
        offset = end
    }
    if (ranges.length === 0) {
        return { segments, count: 0 }
    }

    const nextSegments: TextSegment[] = []
    let position = 0
    let rangeIndex = 0
    for (const segment of segments) {
        let segmentOffset = 0
        const segmentStart = position
        const segmentEnd = segmentStart + segment.text.length
        while (rangeIndex < ranges.length && ranges[rangeIndex].end <= segmentStart) {
            rangeIndex += 1
        }
        if (rangeIndex > 0) {
            const previousRange = ranges[rangeIndex - 1]
            if (previousRange.end > segmentStart) {
                segmentOffset = Math.min(segment.text.length, previousRange.end - segmentStart)
            }
        }
        while (
            rangeIndex < ranges.length &&
            ranges[rangeIndex].start >= segmentStart &&
            ranges[rangeIndex].start < segmentEnd
        ) {
            const range = ranges[rangeIndex]
            const beforeLength = range.start - segmentStart - segmentOffset
            if (beforeLength > 0) {
                nextSegments.push({
                    sourceIndex: segment.sourceIndex,
                    text: segment.text.slice(segmentOffset, segmentOffset + beforeLength),
                })
            }
            nextSegments.push({
                sourceIndex: segment.sourceIndex,
                text: replacement.newText,
            })
            segmentOffset = Math.max(segmentOffset, range.end - segmentStart)
            rangeIndex += 1
        }
        if (segmentOffset < segment.text.length) {
            nextSegments.push({
                sourceIndex: segment.sourceIndex,
                text: segment.text.slice(segmentOffset),
            })
        }
        position = segmentEnd
    }
    return { segments: nextSegments, count: ranges.length }
}

export function countOccurrences(text: string, needle: string): number {
    if (needle.length === 0) {
        return 0
    }
    let count = 0
    let offset = 0
    while (true) {
        const next = text.indexOf(needle, offset)
        if (next < 0) {
            return count
        }
        count += 1
        offset = next + needle.length
    }
}

export function printJson(value: Record<string, unknown>): void {
    console.log(
        JSON.stringify(
            {
                ok: true,
                ...value,
            },
            null,
            4,
        ),
    )
}

export function printError(error: unknown): never {
    const message = error instanceof Error ? error.message : String(error)
    console.error(
        JSON.stringify(
            {
                ok: false,
                error: message,
            },
            null,
            4,
        ),
    )
    process.exit(1)
}
