import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import {
    access,
    copyFile,
    mkdir,
    lstat,
    readFile,
    readdir,
    realpath,
    writeFile,
} from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import {
    defineTool,
    type AgentToolResult,
    type AgentToolUpdateCallback,
    type ToolDefinition,
} from '@mariozechner/pi-coding-agent'
import { Type } from '@mariozechner/pi-ai'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import { buildBoundedProcessEnv } from '../security/process-env'
import { internalStateToolNames } from './internal-state-tools'

type ToolRoot = 'workspace' | 'store'

interface RoomToolDetails {
    root?: ToolRoot
    path?: string
    artifactId?: string
    sha256?: string
    byteLength?: number
    truncated?: boolean
    exitCode?: number | null
    timedOut?: boolean
    durationMs?: number
    fileChange?: {
        kind: 'write' | 'edit' | 'artifact_import' | 'artifact_export'
        root: ToolRoot
        path: string
        beforeSha256?: string | null
        afterSha256: string
        byteLength: number
        diff?: string[]
    }
}

interface RoomToolContext {
    config: PiRuntimeConfig
    audit: (event: string, payload: unknown) => Promise<void>
}

const MAX_READ_BYTES = 128000
const MAX_SEARCH_FILES = 5000
const MAX_SEARCH_MATCHES = 200
const MAX_SEARCH_PATTERN_CHARS = 1000
const MAX_LIST_ENTRIES = 500
const MAX_SHELL_OUTPUT_BYTES = 128000
const DEFAULT_SHELL_TIMEOUT_MS = 30000
const MAX_SHELL_TIMEOUT_MS = 300000

function textResult(text: string, details: RoomToolDetails = {}): AgentToolResult<RoomToolDetails> {
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

function rootPath(config: PiRuntimeConfig, root: ToolRoot): string {
    return root === 'store' ? config.paths.storeDir : config.paths.workspaceDir
}

function normalizeRoot(value: unknown): ToolRoot {
    return value === 'store' ? 'store' : 'workspace'
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

function resolveToolPath(config: PiRuntimeConfig, root: ToolRoot, path: string): string {
    const base = rootPath(config, root)
    const requested = path.trim() || '.'
    return assertInside(isAbsolute(requested) ? requested : join(base, requested), base)
}

async function resolveExistingToolPath(
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

async function resolveWriteTargetPath(
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

function clampPositiveInteger(value: unknown, fallback: number, max: number): number {
    const number =
        typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
    return Math.min(max, Math.max(1, number))
}

function buildSearchMatcher(input: {
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

function boundText(
    input: string,
    maxBytes: number,
): {
    text: string
    truncated: boolean
} {
    const bytes = Buffer.byteLength(input)
    if (bytes <= maxBytes) {
        return {
            text: input,
            truncated: false,
        }
    }
    return {
        text: Buffer.from(input).subarray(0, maxBytes).toString('utf8'),
        truncated: true,
    }
}

function sha256Buffer(buffer: Buffer | string): string {
    return createHash('sha256').update(buffer).digest('hex')
}

function conciseDiff(before: string, after: string): string[] {
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

async function audit(ctx: RoomToolContext, event: string, payload: unknown): Promise<void> {
    await ctx.audit(`tool.${event}`, payload)
}

function createReadTool(ctx: RoomToolContext): ToolDefinition {
    return defineTool({
        name: 'agent_room_read',
        label: 'Read',
        description: 'Read a text file from the room workspace or artifact store with byte bounds.',
        promptSnippet: 'agent_room_read reads bounded files inside the room workspace or store.',
        parameters: Type.Object({
            path: Type.String(),
            root: Type.Optional(Type.Union([Type.Literal('workspace'), Type.Literal('store')])),
            offset: Type.Optional(Type.Number()),
            limitBytes: Type.Optional(Type.Number()),
        }),
        execute: async (_toolCallId, input) => {
            const root = normalizeRoot(input.root)
            const path = await resolveExistingToolPath(ctx.config, root, input.path)
            const offset = clampPositiveInteger(input.offset ?? 1, 1, Number.MAX_SAFE_INTEGER) - 1
            const limitBytes = clampPositiveInteger(
                input.limitBytes,
                MAX_READ_BYTES,
                MAX_READ_BYTES,
            )
            const buffer = await readFile(path)
            const slice = buffer.subarray(offset, offset + limitBytes)
            const truncated = offset + limitBytes < buffer.byteLength
            await audit(ctx, 'read', {
                root,
                path,
                byteLength: slice.byteLength,
                truncated,
            })
            return textResult(slice.toString('utf8'), {
                root,
                path,
                byteLength: slice.byteLength,
                truncated,
            })
        },
    })
}

function createListTool(ctx: RoomToolContext): ToolDefinition {
    return defineTool({
        name: 'agent_room_list',
        label: 'List',
        description: 'List room workspace or artifact store directory entries.',
        promptSnippet: 'agent_room_list lists directories inside the room workspace or store.',
        parameters: Type.Object({
            path: Type.Optional(Type.String()),
            root: Type.Optional(Type.Union([Type.Literal('workspace'), Type.Literal('store')])),
            limit: Type.Optional(Type.Number()),
        }),
        execute: async (_toolCallId, input) => {
            const root = normalizeRoot(input.root)
            const path = await resolveExistingToolPath(ctx.config, root, input.path ?? '.')
            const limit = clampPositiveInteger(input.limit, MAX_LIST_ENTRIES, MAX_LIST_ENTRIES)
            const entries = await readdir(path, {
                withFileTypes: true,
            })
            const rows = await Promise.all(
                entries.slice(0, limit).map(async (entry) => {
                    const entryPath = join(path, entry.name)
                    const entryStat = await lstat(entryPath)
                    const kind = entryStat.isDirectory()
                        ? 'directory'
                        : entryStat.isSymbolicLink()
                          ? 'symlink'
                          : 'file'
                    return {
                        name: entry.name,
                        kind,
                        bytes: entry.isFile() ? entryStat.size : null,
                        updatedAt: entryStat.mtime.toISOString(),
                    }
                }),
            )
            const text = rows
                .map((entry) =>
                    [
                        entry.kind === 'directory'
                            ? 'dir '
                            : entry.kind === 'symlink'
                              ? 'link'
                              : 'file',
                        String(entry.bytes ?? '').padStart(8),
                        entry.updatedAt,
                        entry.name,
                    ].join(' '),
                )
                .join('\n')
            const truncated = entries.length > limit
            await audit(ctx, 'list', {
                root,
                path,
                byteLength: Buffer.byteLength(text),
                truncated,
            })
            return textResult(text, {
                root,
                path,
                byteLength: Buffer.byteLength(text),
                truncated,
            })
        },
    })
}

async function walkFiles(root: string, limit: number): Promise<string[]> {
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

function createSearchTool(ctx: RoomToolContext): ToolDefinition {
    return defineTool({
        name: 'agent_room_search',
        label: 'Search',
        description: 'Search text files inside the room workspace or artifact store.',
        promptSnippet:
            'agent_room_search searches bounded text inside the room workspace or store.',
        parameters: Type.Object({
            pattern: Type.String(),
            path: Type.Optional(Type.String()),
            root: Type.Optional(Type.Union([Type.Literal('workspace'), Type.Literal('store')])),
            ignoreCase: Type.Optional(Type.Boolean()),
            literal: Type.Optional(Type.Boolean()),
            limit: Type.Optional(Type.Number()),
        }),
        execute: async (_toolCallId, input) => {
            const root = normalizeRoot(input.root)
            const searchRoot = await resolveExistingToolPath(ctx.config, root, input.path ?? '.')
            const limit = clampPositiveInteger(input.limit, MAX_SEARCH_MATCHES, MAX_SEARCH_MATCHES)
            const matcher = buildSearchMatcher({
                pattern: input.pattern,
                ignoreCase: input.ignoreCase,
                literal: input.literal,
            })
            const files = await walkFiles(searchRoot, MAX_SEARCH_FILES)
            const matches: string[] = []
            for (const file of files) {
                if (matches.length >= limit) {
                    break
                }
                let content = ''
                try {
                    content = (await readFile(file, 'utf8')).slice(0, MAX_READ_BYTES)
                } catch {
                    continue
                }
                const lines = content.split(/\r?\n/)
                for (let index = 0; index < lines.length && matches.length < limit; index += 1) {
                    const line = lines[index]!
                    if (matcher(line)) {
                        matches.push(
                            `${relative(rootPath(ctx.config, root), file)}:${index + 1}:${line}`,
                        )
                    }
                }
            }
            const text = matches.join('\n')
            const truncated = matches.length >= limit || files.length >= MAX_SEARCH_FILES
            await audit(ctx, 'search', {
                root,
                path: searchRoot,
                byteLength: Buffer.byteLength(text),
                truncated,
            })
            return textResult(text, {
                root,
                path: searchRoot,
                byteLength: Buffer.byteLength(text),
                truncated,
            })
        },
    })
}

function createWriteTool(ctx: RoomToolContext): ToolDefinition {
    return defineTool({
        name: 'agent_room_write',
        label: 'Write',
        description: 'Write a file inside the room workspace or artifact store.',
        promptSnippet: 'agent_room_write writes files only inside the room workspace or store.',
        parameters: Type.Object({
            path: Type.String(),
            content: Type.String(),
            root: Type.Optional(Type.Union([Type.Literal('workspace'), Type.Literal('store')])),
            overwrite: Type.Optional(Type.Boolean()),
        }),
        execute: async (_toolCallId, input) => {
            const root = normalizeRoot(input.root)
            const target = await resolveWriteTargetPath(
                ctx.config,
                root,
                input.path,
                input.overwrite,
            )
            const path = target.path
            await mkdir(dirname(path), {
                recursive: true,
            })
            await writeFile(path, input.content, 'utf8')
            const byteLength = Buffer.byteLength(input.content)
            const fileChange = {
                kind: 'write' as const,
                root,
                path,
                beforeSha256: target.previous ? sha256Buffer(target.previous) : null,
                afterSha256: sha256Buffer(input.content),
                byteLength,
            }
            await audit(ctx, 'write', {
                root,
                path,
                byteLength,
                fileChange,
            })
            return textResult(`Wrote ${input.path}`, {
                root,
                path,
                byteLength,
                fileChange,
            })
        },
    })
}

function createEditTool(ctx: RoomToolContext): ToolDefinition {
    return defineTool({
        name: 'agent_room_edit',
        label: 'Edit',
        description: 'Replace exact text inside a room workspace or artifact store file.',
        promptSnippet:
            'agent_room_edit performs exact text replacements inside the room workspace or store.',
        parameters: Type.Object({
            path: Type.String(),
            oldText: Type.String(),
            newText: Type.String(),
            root: Type.Optional(Type.Union([Type.Literal('workspace'), Type.Literal('store')])),
            replaceAll: Type.Optional(Type.Boolean()),
        }),
        execute: async (_toolCallId, input) => {
            const root = normalizeRoot(input.root)
            const path = await resolveExistingToolPath(ctx.config, root, input.path)
            const original = await readFile(path, 'utf8')
            if (!original.includes(input.oldText)) {
                throw new Error(`Text was not found in ${input.path}`)
            }
            const updated = input.replaceAll
                ? original.split(input.oldText).join(input.newText)
                : original.replace(input.oldText, input.newText)
            await writeFile(path, updated, 'utf8')
            const byteLength = Buffer.byteLength(updated)
            const fileChange = {
                kind: 'edit' as const,
                root,
                path,
                beforeSha256: sha256Buffer(original),
                afterSha256: sha256Buffer(updated),
                byteLength,
                diff: conciseDiff(original, updated),
            }
            await audit(ctx, 'edit', {
                root,
                path,
                byteLength,
                fileChange,
            })
            return textResult(`Edited ${input.path}`, {
                root,
                path,
                byteLength,
                fileChange,
            })
        },
    })
}

function shellEnv(config: PiRuntimeConfig): NodeJS.ProcessEnv {
    return buildBoundedProcessEnv({
        HOME: config.paths.homeDir,
        TMPDIR: config.paths.tmpDir,
        AGENT_ROOM_ROOM_ID: config.runtime.roomId,
        AGENT_ROOM_WORKSPACE_DIR: config.paths.workspaceDir,
        AGENT_ROOM_STORE_DIR: config.paths.storeDir,
    })
}

async function runShell(input: {
    command: string
    cwd: string
    env: NodeJS.ProcessEnv
    timeoutMs: number
    signal?: AbortSignal
    onUpdate?: AgentToolUpdateCallback<RoomToolDetails>
}): Promise<{
    output: string
    exitCode: number | null
    timedOut: boolean
    durationMs: number
    truncated: boolean
}> {
    const startedAt = Date.now()
    let output = ''
    let truncated = false
    let timedOut = false
    let closed = false
    const child = spawn(input.command, {
        cwd: input.cwd,
        shell: '/bin/sh',
        env: input.env,
        stdio: ['ignore', 'pipe', 'pipe'],
    })

    const append = (chunk: Buffer) => {
        const next = boundText(output + chunk.toString('utf8'), MAX_SHELL_OUTPUT_BYTES)
        output = next.text
        truncated = truncated || next.truncated
        input.onUpdate?.(
            textResult(output, {
                path: input.cwd,
                byteLength: Buffer.byteLength(output),
                truncated,
            }),
        )
    }

    child.stdout.on('data', append)
    child.stderr.on('data', append)

    const kill = () => {
        if (closed) {
            return
        }
        child.kill('SIGTERM')
        setTimeout(() => {
            if (!closed) {
                child.kill('SIGKILL')
            }
        }, 2000).unref()
    }

    const timer = setTimeout(() => {
        timedOut = true
        kill()
    }, input.timeoutMs)
    input.signal?.addEventListener('abort', kill, {
        once: true,
    })

    return await new Promise((resolvePromise, reject) => {
        child.on('error', reject)
        child.on('close', (exitCode) => {
            closed = true
            clearTimeout(timer)
            input.signal?.removeEventListener('abort', kill)
            resolvePromise({
                output,
                exitCode,
                timedOut,
                durationMs: Date.now() - startedAt,
                truncated,
            })
        })
    })
}

function createShellTool(ctx: RoomToolContext): ToolDefinition {
    return defineTool({
        name: 'agent_room_shell',
        label: 'Shell',
        description: 'Run a bounded shell command from the room workspace.',
        promptSnippet:
            'agent_room_shell runs bounded commands from the room workspace with a minimal environment.',
        parameters: Type.Object({
            command: Type.String(),
            timeoutMs: Type.Optional(Type.Number()),
        }),
        executionMode: 'sequential',
        execute: async (_toolCallId, input, signal, onUpdate) => {
            const timeoutMs = clampPositiveInteger(
                input.timeoutMs,
                DEFAULT_SHELL_TIMEOUT_MS,
                MAX_SHELL_TIMEOUT_MS,
            )
            const result = await runShell({
                command: input.command,
                cwd: ctx.config.paths.workspaceDir,
                env: shellEnv(ctx.config),
                timeoutMs,
                signal,
                onUpdate,
            })
            await audit(ctx, 'shell', {
                path: ctx.config.paths.workspaceDir,
                exitCode: result.exitCode,
                timedOut: result.timedOut,
                durationMs: result.durationMs,
                truncated: result.truncated,
            })
            return textResult(result.output, {
                path: ctx.config.paths.workspaceDir,
                byteLength: Buffer.byteLength(result.output),
                truncated: result.truncated,
                exitCode: result.exitCode,
                timedOut: result.timedOut,
                durationMs: result.durationMs,
            })
        },
    })
}

function artifactIdFor(path: string, sha256: string): string {
    const base = basename(path, extname(path))
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
    return `${base || 'artifact'}-${sha256.slice(0, 16)}`
}

function createArtifactImportTool(ctx: RoomToolContext): ToolDefinition {
    return defineTool({
        name: 'agent_room_artifact_import',
        label: 'Import Artifact',
        description:
            'Import a workspace file into the room artifact store with provenance metadata.',
        promptSnippet:
            'agent_room_artifact_import copies workspace files into the room artifact store.',
        parameters: Type.Object({
            path: Type.String(),
            mediaType: Type.Optional(Type.String()),
        }),
        execute: async (_toolCallId, input) => {
            const source = await resolveExistingToolPath(ctx.config, 'workspace', input.path)
            const buffer = await readFile(source)
            const sha256 = sha256Buffer(buffer)
            const artifactId = artifactIdFor(source, sha256)
            const blobPath = join(ctx.config.paths.storeDir, 'blobs', sha256)
            const manifestPath = join(ctx.config.paths.storeDir, 'manifests', `${artifactId}.json`)
            await mkdir(dirname(blobPath), {
                recursive: true,
            })
            await mkdir(dirname(manifestPath), {
                recursive: true,
            })
            await writeFile(blobPath, buffer)
            await writeFile(
                manifestPath,
                JSON.stringify(
                    {
                        artifactId,
                        sha256,
                        byteLength: buffer.byteLength,
                        mediaType: input.mediaType ?? 'application/octet-stream',
                        sourcePath: relative(ctx.config.paths.workspaceDir, source),
                        createdAt: new Date().toISOString(),
                    },
                    null,
                    4,
                ),
                'utf8',
            )
            await audit(ctx, 'artifact_import', {
                path: source,
                artifactId,
                sha256,
                byteLength: buffer.byteLength,
                fileChange: {
                    kind: 'artifact_import',
                    root: 'store',
                    path: manifestPath,
                    afterSha256: sha256,
                    byteLength: buffer.byteLength,
                },
            })
            return textResult(
                JSON.stringify(
                    {
                        artifactId,
                        sha256,
                        byteLength: buffer.byteLength,
                    },
                    null,
                    4,
                ),
                {
                    root: 'store',
                    path: manifestPath,
                    artifactId,
                    sha256,
                    byteLength: buffer.byteLength,
                    fileChange: {
                        kind: 'artifact_import',
                        root: 'store',
                        path: manifestPath,
                        afterSha256: sha256,
                        byteLength: buffer.byteLength,
                    },
                },
            )
        },
    })
}

function createArtifactExportTool(ctx: RoomToolContext): ToolDefinition {
    return defineTool({
        name: 'agent_room_artifact_export',
        label: 'Export Artifact',
        description: 'Export an artifact store blob back into the room workspace.',
        promptSnippet: 'agent_room_artifact_export copies artifact store blobs into the workspace.',
        parameters: Type.Object({
            artifactId: Type.String(),
            path: Type.String(),
            overwrite: Type.Optional(Type.Boolean()),
        }),
        execute: async (_toolCallId, input) => {
            const manifestPath = await resolveExistingToolPath(
                ctx.config,
                'store',
                join('manifests', `${input.artifactId}.json`),
            )
            const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
                sha256: string
                byteLength: number
            }
            const source = await resolveExistingToolPath(
                ctx.config,
                'store',
                join('blobs', manifest.sha256),
            )
            const target = await resolveWriteTargetPath(
                ctx.config,
                'workspace',
                input.path,
                input.overwrite,
            )
            const destination = target.path
            await mkdir(dirname(destination), {
                recursive: true,
            })
            await copyFile(source, destination)
            const fileChange = {
                kind: 'artifact_export' as const,
                root: 'workspace' as const,
                path: destination,
                beforeSha256: target.previous ? sha256Buffer(target.previous) : null,
                afterSha256: manifest.sha256,
                byteLength: manifest.byteLength,
            }
            await audit(ctx, 'artifact_export', {
                path: destination,
                artifactId: input.artifactId,
                sha256: manifest.sha256,
                byteLength: manifest.byteLength,
                fileChange,
            })
            return textResult(`Exported ${input.artifactId} to ${input.path}`, {
                root: 'workspace',
                path: destination,
                artifactId: input.artifactId,
                sha256: manifest.sha256,
                byteLength: manifest.byteLength,
                fileChange,
            })
        },
    })
}

function createWorkspaceTreeTool(ctx: RoomToolContext): ToolDefinition {
    return defineTool({
        name: 'agent_room_workspace_tree',
        label: 'Workspace Tree',
        description: 'Return a bounded recursive tree of the room workspace.',
        promptSnippet: 'agent_room_workspace_tree shows a bounded room workspace tree.',
        parameters: Type.Object({
            path: Type.Optional(Type.String()),
            limit: Type.Optional(Type.Number()),
        }),
        execute: async (_toolCallId, input) => {
            const root = await resolveExistingToolPath(ctx.config, 'workspace', input.path ?? '.')
            const limit = clampPositiveInteger(input.limit, 200, 1000)
            const files = await walkFiles(root, limit)
            const text = files
                .map((file) => relative(ctx.config.paths.workspaceDir, file))
                .join('\n')
            const truncated = files.length >= limit
            await audit(ctx, 'workspace_tree', {
                path: root,
                byteLength: Buffer.byteLength(text),
                truncated,
            })
            return textResult(text, {
                root: 'workspace',
                path: root,
                byteLength: Buffer.byteLength(text),
                truncated,
            })
        },
    })
}

export function roomToolNamesForProfile(profile: string): string[] {
    const internalTools = [...internalStateToolNames]
    if (profile === 'read-only') {
        return [
            ...internalTools,
            'agent_room_read',
            'agent_room_list',
            'agent_room_search',
            'agent_room_workspace_tree',
        ]
    }
    if (profile === 'minimal') {
        return [
            ...internalTools,
            'agent_room_read',
            'agent_room_list',
            'agent_room_search',
            'agent_room_workspace_tree',
            'agent_room_shell',
        ]
    }
    return [
        ...internalTools,
        'agent_room_read',
        'agent_room_list',
        'agent_room_search',
        'agent_room_workspace_tree',
        'agent_room_write',
        'agent_room_edit',
        'agent_room_shell',
        'agent_room_artifact_import',
        'agent_room_artifact_export',
    ]
}

export function createRoomTools(ctx: RoomToolContext): ToolDefinition[] {
    const tools = [
        createReadTool(ctx),
        createListTool(ctx),
        createSearchTool(ctx),
        createWorkspaceTreeTool(ctx),
        createWriteTool(ctx),
        createEditTool(ctx),
        createShellTool(ctx),
        createArtifactImportTool(ctx),
        createArtifactExportTool(ctx),
    ]
    const enabled = new Set(roomToolNamesForProfile(ctx.config.tools.profile))
    return tools.filter((tool) => enabled.has(tool.name))
}
