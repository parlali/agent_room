import { constants as fsConstants } from 'node:fs'
import { access, lstat, open, readFile, readdir, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import type { PiRuntimeConfig } from '../../rooms/pi-runtime-config'
import { assertPathInsideRoot } from '../../security/path-boundary'
import type { ToolRoot } from './shared'

export const MAX_READ_BYTES = 128000
export const MAX_SEARCH_FILES = 5000
export const MAX_SEARCH_MATCHES = 200
export const MAX_SEARCH_PATTERN_CHARS = 1000
export const MAX_LIST_ENTRIES = 500

export function rootPath(config: PiRuntimeConfig, root: ToolRoot): string {
    return root === 'store' ? config.paths.storeDir : config.paths.workspaceDir
}

export function normalizeRoot(value: unknown): ToolRoot {
    return value === 'store' ? 'store' : 'workspace'
}

function assertInside(candidate: string, root: string): string {
    return assertPathInsideRoot(candidate, root, (path) => `Path escapes allowed root: ${path}`)
}

function resolveToolPath(config: PiRuntimeConfig, root: ToolRoot, path: string): string {
    const base = rootPath(config, root)
    const requested = path.trim() || '.'
    return assertInside(isAbsolute(requested) ? requested : join(base, requested), base)
}

export async function resolveExistingToolPath(
    config: PiRuntimeConfig,
    root: ToolRoot,
    path: string,
): Promise<string> {
    const base = await realpath(rootPath(config, root))
    const requested = resolveToolPath(config, root, path)
    const target = await realpath(requested)
    return assertInside(target, base)
}

async function nearestExistingParent(path: string, root: string): Promise<string> {
    let current = dirname(path)
    while (true) {
        assertInside(current, root)
        try {
            await access(current, fsConstants.F_OK)
            return current
        } catch {
            const next = dirname(current)
            if (next === current) {
                throw new Error(`No existing parent for ${path}`)
            }
            current = next
        }
    }
}

async function resolveWritableToolPath(
    config: PiRuntimeConfig,
    root: ToolRoot,
    path: string,
): Promise<string> {
    const base = await realpath(rootPath(config, root))
    const requested = resolveToolPath(config, root, path)
    const parent = await nearestExistingParent(requested, rootPath(config, root))
    const realParent = await realpath(parent)
    assertInside(realParent, base)
    return requested
}

function isNotFoundFsError(error: unknown): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        String((error as { code: unknown }).code) === 'ENOENT'
    )
}

export async function resolveWriteTargetPath(
    config: PiRuntimeConfig,
    root: ToolRoot,
    path: string,
    overwrite: boolean | undefined,
): Promise<{
    path: string
    previous: Buffer | null
}> {
    const requested = await resolveWritableToolPath(config, root, path)

    try {
        await access(requested, fsConstants.F_OK)
    } catch (error) {
        if (!isNotFoundFsError(error)) {
            throw error
        }
        return {
            path: requested,
            previous: null,
        }
    }

    if (!overwrite) {
        throw new Error(`File already exists: ${path}`)
    }

    const existing = await resolveExistingToolPath(config, root, path)
    return {
        path: existing,
        previous: await readFile(existing),
    }
}

export function buildSearchMatcher(input: {
    pattern: string
    ignoreCase?: boolean
    literal?: boolean
}): (line: string) => boolean {
    if (!input.pattern.trim()) {
        throw new Error('Search pattern cannot be empty')
    }
    if (input.pattern.length > MAX_SEARCH_PATTERN_CHARS) {
        throw new Error(`Search pattern cannot exceed ${MAX_SEARCH_PATTERN_CHARS} characters`)
    }

    if (input.literal) {
        const needle = input.ignoreCase ? input.pattern.toLowerCase() : input.pattern
        return (line) => {
            const haystack = input.ignoreCase ? line.toLowerCase() : line
            return haystack.includes(needle)
        }
    }

    let matcher: RegExp
    try {
        matcher = new RegExp(input.pattern, input.ignoreCase ? 'i' : '')
    } catch {
        throw new Error('Search pattern is not a valid regular expression')
    }
    return (line) => matcher.test(line)
}

export function conciseDiff(before: string, after: string): string[] {
    const beforeLines = before.split(/\r?\n/)
    const afterLines = after.split(/\r?\n/)
    const rows: string[] = []
    const length = Math.max(beforeLines.length, afterLines.length)
    for (let index = 0; index < length && rows.length < 40; index += 1) {
        const beforeLine = beforeLines[index] ?? ''
        const afterLine = afterLines[index] ?? ''
        if (beforeLine === afterLine) {
            continue
        }
        rows.push(`-${index + 1}: ${beforeLine}`)
        rows.push(`+${index + 1}: ${afterLine}`)
    }
    return rows
}

export async function readBoundedFile(input: {
    path: string
    offset: number
    limitBytes: number
}): Promise<{
    buffer: Buffer
    byteLength: number
    truncated: boolean
}> {
    const fileStat = await lstat(input.path)
    if (!fileStat.isFile()) {
        throw new Error('Read only supports regular files')
    }
    const readLength = Math.max(0, Math.min(input.limitBytes, fileStat.size - input.offset))
    const handle = await open(input.path, 'r')
    let buffer: Buffer
    try {
        const target = Buffer.alloc(readLength)
        const result = await handle.read(target, 0, readLength, input.offset)
        buffer = target.subarray(0, result.bytesRead)
    } finally {
        await handle.close()
    }
    return {
        buffer,
        byteLength: fileStat.size,
        truncated: input.offset + buffer.byteLength < fileStat.size,
    }
}

export async function walkFiles(root: string, limit: number): Promise<string[]> {
    const files: string[] = []
    const stack = [root]
    while (stack.length > 0 && files.length < limit) {
        const current = stack.pop()!
        const entries = await readdir(current, {
            withFileTypes: true,
        })
        for (const entry of entries) {
            const entryPath = join(current, entry.name)
            if (entry.isDirectory()) {
                stack.push(entryPath)
            } else if (entry.isFile()) {
                files.push(entryPath)
                if (files.length >= limit) {
                    break
                }
            }
        }
    }
    return files
}
