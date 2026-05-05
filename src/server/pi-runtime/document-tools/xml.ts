import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import type { Replacement } from './types'

const xmlTextRegex = /<(?:w:t|a:t)[^>]*>([\s\S]*?)<\/(?:w:t|a:t)>/g
const maxExtractedTextBytes = 128000

export function parseJson<T>(value: unknown, fallback: T): T {
    if (typeof value !== 'string' || !value.trim()) {
        return fallback
    }
    return JSON.parse(value) as T
}
export function normalizeReplacements(value: unknown): Replacement[] {
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
export function xmlEscape(value: string): string {
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

export function extractXmlText(xml: string): string {
    const rows: string[] = []
    for (const match of xml.matchAll(xmlTextRegex)) {
        rows.push(xmlDecode(match[1] ?? ''))
    }
    return rows.join('\n')
}

export function boundExtractedText(text: string): string {
    const buffer = Buffer.from(text)
    return buffer.byteLength <= maxExtractedTextBytes
        ? text
        : `${buffer.subarray(0, maxExtractedTextBytes).toString('utf8')}\n[truncated]`
}

export function replaceZipText(input: {
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
