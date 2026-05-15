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

/**
 * Abort execution by throwing a SkillFailure with the provided message.
 *
 * @param message - Human-readable error message explaining the failure
 * @throws SkillFailure containing `message`
 */
export function fail(message: string): never {
    throw new SkillFailure(message)
}

/**
 * Parse a simple CLI-style argv into an operation name and a map of `--key value` options.
 *
 * Parses `argv` where the first element is the operation and remaining elements are `--key value` pairs; stores options without the leading `--` in a `Map`.
 *
 * @param argv - Array of command-line arguments where index 0 is the operation
 * @returns An object containing the parsed `operation` and `options` map
 * @throws SkillFailure If the operation is missing, an argument does not start with `--`, or a `--key` is missing its value
 */
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

/**
 * Retrieve a required option value from the parsed options map.
 *
 * @param options - Map of option names to their values (parsed from CLI)
 * @param name - The option name (without the leading `--`) to retrieve
 * @returns The option value
 * @throws SkillFailure if the option is missing or the value is an empty string
 */
export function requiredOption(options: Map<string, string>, name: string): string {
    const value = options.get(name)
    if (value === undefined || value.length === 0) {
        fail(`--${name} is required`)
    }
    return value
}

/**
 * Retrieves an option value from `options`, using `fallback` when the option is missing or empty.
 *
 * @param options - Map of option names to values
 * @param name - The option key to look up (without leading `--`)
 * @param fallback - The value to return when the option is absent or an empty string
 * @returns The option's value if present and not empty, otherwise `fallback`
 */
export function optionalOption(
    options: Map<string, string>,
    name: string,
    fallback: string,
): string {
    const value = options.get(name)
    return value === undefined || value.length === 0 ? fallback : value
}

/**
 * Parses `value` as JSON, returning a fallback when `value` is missing or blank.
 *
 * @param value - The JSON string to parse; may be `undefined` or blank
 * @param fallback - Value to return when `value` is `undefined` or contains only whitespace
 * @returns The parsed JSON value, or `fallback` when `value` is missing or blank
 * @throws SkillFailure when `value` is non-blank but not valid JSON (message: `Invalid JSON: <reason>`)
 */
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

/**
 * Parses a JSON string into an array of validated replacement objects.
 *
 * @param value - A JSON string representing an array of replacement objects; if `undefined` or blank, treated as an empty array.
 * @returns An array of `Replacement` objects each containing `oldText` and `newText` strings.
 * @throws SkillFailure if the value is not a JSON array, any entry is not an object, `oldText`/`newText` are not strings, or `oldText` is empty.
 */
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

/**
 * Determines whether a value is a plain object (an object that is not `null` and not an array).
 *
 * @param value - The value to test
 * @returns `true` if `value` is an object, not `null`, and not an array; `false` otherwise.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Get the directory path for the specified room root ('workspace' or 'store').
 *
 * @param root - Either `"workspace"` or `"store"` to select which room root to resolve
 * @returns The directory path taken from the corresponding environment variable
 * @throws SkillFailure if `root` is not `"workspace"` or `"store"`, or if the matching environment variable is unset or empty
 */
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

/**
 * Asserts that a filesystem path is located inside the provided root directory.
 *
 * @param path - The path to validate (can be relative or absolute)
 * @param rootPath - The root directory against which `path` is checked
 * @throws SkillFailure if `path` would escape `rootPath` (e.g., resolves to `..` or an absolute path outside the root)
 */
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

/**
 * Resolve a workspace/store–scoped filesystem path and ensure it stays inside the selected room root.
 *
 * Ensures `input.path` is interpreted relative to the room root identified by `input.root`, verifies the resulting path does not escape that root, and prepares parent directories when the target need not already exist.
 *
 * @param input.root - Either `'workspace'` or `'store'`; selects the room root whose environment variable must be set
 * @param input.path - A path relative to the selected room root; absolute paths are rejected
 * @param input.mustExist - If `true`, the target must exist and the function returns the target's real (resolved) path; if `false`, the parent directory is created as needed and the joined path is returned
 * @returns The resolved path confined to the selected room root. When `mustExist` is `true`, this is the target's realpath; when `mustExist` is `false`, this is the joined path (with parent ensured to exist)
 * @throws SkillFailure if the path is absolute, if the resolved path would escape the room root, if required environment variables are missing, or if `mustExist` is `true` but the file does not exist
 */
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

/**
 * Ensures the selected room root is the workspace before performing a write operation.
 *
 * @param root - The room root identifier; must be `'workspace'` to permit writes.
 * @param operation - The name of the operation (used in the error message on failure).
 * @throws SkillFailure if `root` is not `'workspace'` with message `{operation} writes are only supported in the workspace`
 */
export function requireWorkspace(root: string, operation: string): void {
    if (root !== 'workspace') {
        fail(`${operation} writes are only supported in the workspace`)
    }
}

/**
 * Ensures the parent directory of the given filesystem path exists by creating it (recursively) if necessary.
 *
 * @param path - The target file path whose parent directory should be created
 */
export async function ensureParent(path: string): Promise<void> {
    await mkdir(dirname(path), {
        recursive: true,
    })
}

/**
 * Load a ZIP archive from the filesystem and return its JSZip representation.
 *
 * @param path - Filesystem path to the ZIP file to load
 * @returns A `JSZip` object representing the archive
 */
export async function loadZip(path: string): Promise<JSZip> {
    return JSZip.loadAsync(await readFile(path))
}

/**
 * Writes a JSZip archive to the given filesystem path, creating parent directories if necessary.
 *
 * @param zip - The JSZip instance to serialize and save
 * @param path - The destination file path where the ZIP will be written
 */
export async function saveZip(zip: JSZip, path: string): Promise<void> {
    await ensureParent(path)
    const content = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
    })
    await writeFile(path, content)
}

/**
 * Retrieve the text content of a file entry inside a ZIP archive.
 *
 * @param zip - The JSZip archive to read from
 * @param path - Path of the entry within the archive
 * @returns The entry's text content if the entry exists, `null` if the entry is missing
 */
export async function readZipText(zip: JSZip, path: string): Promise<string | null> {
    const file = zip.file(path)
    if (!file) {
        return null
    }
    return file.async('text')
}

/**
 * Adds or replaces a file entry at the given path in the ZIP with the provided text content.
 *
 * @param zip - The JSZip instance to modify
 * @param path - The entry path inside the ZIP
 * @param content - Text content to store in the entry
 */
export function writeZipText(zip: JSZip, path: string, content: string): void {
    zip.file(path, content)
}

/**
 * List non-directory entry names in a zip archive in sorted order.
 *
 * @param zip - The JSZip archive to inspect
 * @returns A sorted array of entry names for all files (entries where `dir` is false)
 */
export function zipFileNames(zip: JSZip): string[] {
    return Object.keys(zip.files)
        .filter((name) => !zip.files[name]?.dir)
        .sort()
}

/**
 * Parse an XML string into a DOM document.
 *
 * @param xml - The XML string to parse
 * @returns The parsed XML document
 */
export function parseXml(xml: string): XmlDocument {
    return new DOMParser().parseFromString(xml, 'application/xml')
}

/**
 * Serialize an XML document to its string representation.
 *
 * @returns The XML document serialized as a string
 */
export function serializeXml(document: XmlDocument): string {
    return new XMLSerializer().serializeToString(document)
}

/**
 * Extracts the local (namespace-less) name of an XML node.
 *
 * @returns The part of the node's name after the last ':' if present, otherwise the node's full name.
 */
export function localName(node: XmlNode): string {
    const value = node.localName || node.nodeName
    const separator = value.lastIndexOf(':')
    return separator >= 0 ? value.slice(separator + 1) : value
}

/**
 * Finds all descendant elements whose local (namespace-stripped) name matches the given name.
 *
 * @param root - The document or element to search within
 * @param name - The local element name to match (namespace prefixes are ignored)
 * @returns An array of matching XmlElement instances; empty if no matches are found
 */
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

/**
 * Retrieves direct child elements of `root` whose local (namespace-stripped) name matches `name`.
 *
 * @param root - Parent element whose immediate children will be searched
 * @param name - Local name to match (any namespace prefix is ignored)
 * @returns An array of matching child elements; empty if no matches are found
 */
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

/**
 * Finds the first descendant element whose local name matches `name`.
 *
 * @param root - The document or element to search within
 * @param name - The local (namespace-less) element name to match
 * @returns The first matching element, or `null` if no match is found
 */
export function firstElementByLocalName(
    root: XmlDocument | XmlElement,
    name: string,
): XmlElement | null {
    return elementsByLocalName(root, name)[0] ?? null
}

/**
 * Retrieve the value of an attribute on an element by its local (namespace-less) name.
 *
 * @param element - The XML element to search for the attribute
 * @param name - The attribute's local name (ignores any namespace prefix)
 * @returns The attribute's value if present, `null` otherwise
 */
export function attributeByLocalName(element: XmlElement, name: string): string | null {
    for (let index = 0; index < element.attributes.length; index += 1) {
        const attribute = element.attributes.item(index)
        if (attribute && localName(attribute) === name) {
            return attribute.value
        }
    }
    return null
}

/**
 * Set an element's text content by removing all existing children and adding a single text node.
 *
 * @param element - The XML element whose text content will be replaced
 * @param value - The text to set on the element
 * @throws SkillFailure if the element has no owner document
 */
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

/**
 * Remove all child nodes from the given XML element.
 *
 * @param element - The element whose children will be removed
 */
export function clearChildren(element: XmlElement): void {
    while (element.firstChild) {
        element.removeChild(element.firstChild)
    }
}

/**
 * Creates a new namespaced element, appends it to the given parent, and optionally sets its text content.
 *
 * @param input.document - The XML document used to create the element
 * @param input.parent - The element to which the new element will be appended
 * @param input.namespace - The namespace URI for the created element
 * @param input.name - The qualified name for the created element (may include a prefix)
 * @param input.text - Optional text content to set on the created element
 * @returns The newly created and appended element
 */
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

/**
 * Concatenates the text content of all descendant elements with the given local name.
 *
 * @param root - The element to search within
 * @param textElementName - The local name of the elements to collect text from
 * @returns The concatenated text content of all matching elements; empty string if none match
 */
export function textFromTextElements(root: XmlElement, textElementName: string): string {
    return elementsByLocalName(root, textElementName)
        .map((element) => element.textContent ?? '')
        .join('')
}

/**
 * Apply multiple text replacements across all descendant elements with the given local name, updating each element's text content to reflect the changes.
 *
 * @param root - Element under which matching text elements will be searched
 * @param textElementName - Local name of the elements whose text content will be processed
 * @param replacements - Ordered list of replacements, each with `oldText` and `newText`, applied sequentially across the concatenated text of all matching elements
 * @returns The total number of replacements performed across all matching elements
 */
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

/**
 * Applies a single text replacement across an ordered list of text segments and returns the updated segments and number of replacements applied.
 *
 * Scans the concatenated segment texts for non-overlapping occurrences of `replacement.oldText`, replaces each occurrence with `replacement.newText`, and returns a new array of segments that preserves original `sourceIndex` values while reflecting the inserted and remaining text pieces.
 *
 * @param segments - Ordered array of text segments to search and update. Each segment's `text` represents its content and `sourceIndex` identifies its origin.
 * @param replacement - Object with `oldText` to find and `newText` to insert in place of each occurrence.
 * @returns An object containing `segments`, the transformed array of text segments, and `count`, the number of replacements performed (`0` if none).
 */
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

/**
 * Counts non-overlapping occurrences of a substring within a string.
 *
 * If `needle` is empty, returns 0. Matches are counted without overlap (search continues after each match).
 *
 * @param text - The string to search within
 * @param needle - The substring to count
 * @returns The number of non-overlapping occurrences of `needle` in `text`
 */
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

/**
 * Prints a success JSON object to stdout with `ok: true` merged into the provided fields.
 *
 * @param value - Additional fields to include at the top level of the printed JSON
 */
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

/**
 * Prints a JSON error object to stderr and terminates the process with exit code 1.
 *
 * @param error - The error to report; if an `Error` instance its `message` is used, otherwise `String(error)` is used.
 * @returns Never returns; exits the process with code 1.
 */
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
