import type { Dirent } from 'node:fs'
import { lstat, readdir, readFile, realpath } from 'node:fs/promises'
import { extname, isAbsolute, join, relative } from 'node:path'
import { defineTool, type ToolDefinition } from '@mariozechner/pi-coding-agent'
import { Type } from '@mariozechner/pi-ai'
import { bundledSkillsDirectory } from '../bundled-skills'
import { boundToolOutput } from '../tool-output-bounds'
import { assertPathInsideRoot } from '../../security/path-boundary'
import { audit, textResult, type RoomToolContext } from './shared'

const maxSkillSearchResults = 80

function rejectInvalidRelativePath(path: string): void {
    if (path.includes('\0')) {
        throw new Error('Skill path contains an invalid character')
    }
    if (isAbsolute(path)) {
        throw new Error('Skill path must be relative to the bundled skills directory')
    }
}

async function resolveSkillPath(inputPath: string | undefined): Promise<{
    root: string
    path: string
    relativePath: string
}> {
    const root = await realpath(bundledSkillsDirectory())
    const requested = inputPath?.trim() || '.'
    rejectInvalidRelativePath(requested)
    const candidate = assertPathInsideRoot(
        join(root, requested),
        root,
        'Skill path escapes bundled skills directory',
    )
    const resolved = await realpath(candidate)
    const path = assertPathInsideRoot(resolved, root, 'Skill path escapes bundled skills directory')
    return {
        root,
        path,
        relativePath: relative(root, path) || '.',
    }
}

function visibleSkillPath(root: string, path: string): string {
    return relative(root, path) || '.'
}

async function walkSkillFiles(root: string, path: string): Promise<string[]> {
    const stat = await lstat(path)
    if (stat.isFile()) {
        return [path]
    }
    if (!stat.isDirectory()) {
        return []
    }

    const entries = await readdir(path, {
        withFileTypes: true,
    })
    const nested = await Promise.all(
        entries.map(async (entry) => {
            const entryPath = join(path, entry.name)
            if (entry.isDirectory()) {
                return walkSkillFiles(root, entryPath)
            }
            if (entry.isFile()) {
                return [entryPath]
            }
            return []
        }),
    )
    return nested
        .flat()
        .sort((left, right) =>
            visibleSkillPath(root, left).localeCompare(visibleSkillPath(root, right)),
        )
}

function listEntry(root: string, entry: Dirent, parent: string): string {
    const type = entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other'
    return `${type}\t${visibleSkillPath(root, join(parent, entry.name))}`
}

function extensionForPath(path: string): string {
    return extname(path).replace(/^\./, '') || 'txt'
}

async function boundedSkillText(
    ctx: RoomToolContext,
    input: {
        label: string
        path: string
        text: string
    },
) {
    const bounded = await boundToolOutput({
        config: ctx.config,
        text: input.text,
        label: input.label,
        extension: extensionForPath(input.path),
        previewMode: 'head',
    })
    return textResult(bounded.text, {
        root: 'skills',
        path: input.path,
        byteLength: Buffer.byteLength(input.text, 'utf8'),
        truncated: bounded.modelVisibleTruncated,
        modelVisibleTruncated: bounded.modelVisibleTruncated,
        ...(bounded.outputArtifact ? { outputArtifact: bounded.outputArtifact } : {}),
    })
}

export function createSkillTools(ctx: RoomToolContext): ToolDefinition[] {
    return [
        defineTool({
            name: 'skill_list',
            label: 'List Skills',
            description: 'List bundled Agent Room skill files from the read-only skill surface.',
            promptSnippet:
                'skill_list lists bundled skill files. Paths are relative to the bundled skills directory.',
            parameters: Type.Object({
                path: Type.Optional(Type.String()),
            }),
            execute: async (_toolCallId, input) => {
                const resolved = await resolveSkillPath(input.path)
                const stat = await lstat(resolved.path)
                if (!stat.isDirectory()) {
                    throw new Error('skill_list requires a directory path')
                }
                const entries = await readdir(resolved.path, {
                    withFileTypes: true,
                })
                const text = entries
                    .sort((left, right) => left.name.localeCompare(right.name))
                    .map((entry) => listEntry(resolved.root, entry, resolved.path))
                    .join('\n')
                await audit(ctx, 'skill_list', {
                    path: resolved.relativePath,
                    byteLength: Buffer.byteLength(text, 'utf8'),
                })
                return textResult(text, {
                    root: 'skills',
                    path: resolved.relativePath,
                    byteLength: Buffer.byteLength(text, 'utf8'),
                })
            },
        }),
        defineTool({
            name: 'skill_read',
            label: 'Read Skill',
            description:
                'Read a bundled Agent Room skill file by path. This cannot read workspace, room, or host files.',
            promptSnippet:
                'skill_read reads bundled skill files. Paths are relative to the bundled skills directory.',
            parameters: Type.Object({
                path: Type.String(),
            }),
            execute: async (_toolCallId, input) => {
                const resolved = await resolveSkillPath(input.path)
                const stat = await lstat(resolved.path)
                if (!stat.isFile()) {
                    throw new Error('skill_read requires a file path')
                }
                const text = await readFile(resolved.path, 'utf8')
                await audit(ctx, 'skill_read', {
                    path: resolved.relativePath,
                    byteLength: Buffer.byteLength(text, 'utf8'),
                })
                return boundedSkillText(ctx, {
                    label: `skill-${resolved.relativePath}`,
                    path: resolved.relativePath,
                    text,
                })
            },
        }),
        defineTool({
            name: 'skill_search',
            label: 'Search Skills',
            description:
                'Search bundled Agent Room skill files by literal text. This cannot search workspace, room, or host files.',
            promptSnippet:
                'skill_search searches bundled skill files. Paths are relative to the bundled skills directory.',
            parameters: Type.Object({
                query: Type.String(),
                path: Type.Optional(Type.String()),
            }),
            execute: async (_toolCallId, input) => {
                const query = input.query.trim()
                if (!query) {
                    throw new Error('skill_search requires a non-empty query')
                }
                const resolved = await resolveSkillPath(input.path)
                const files = await walkSkillFiles(resolved.root, resolved.path)
                const queryLower = query.toLowerCase()
                const rows: string[] = []
                for (const file of files) {
                    const text = await readFile(file, 'utf8')
                    const lines = text.split(/\r?\n/)
                    for (let index = 0; index < lines.length; index += 1) {
                        const line = lines[index]
                        if (!line.toLowerCase().includes(queryLower)) continue
                        rows.push(`${visibleSkillPath(resolved.root, file)}:${index + 1}:${line}`)
                        if (rows.length >= maxSkillSearchResults) break
                    }
                    if (rows.length >= maxSkillSearchResults) break
                }
                const suffix =
                    rows.length >= maxSkillSearchResults
                        ? `\n[Search stopped at ${maxSkillSearchResults} matches]`
                        : ''
                const text = `${rows.join('\n')}${suffix}`
                await audit(ctx, 'skill_search', {
                    path: resolved.relativePath,
                    byteLength: Buffer.byteLength(text, 'utf8'),
                    truncated: rows.length >= maxSkillSearchResults,
                })
                return boundedSkillText(ctx, {
                    label: `skill-search-${query}`,
                    path: resolved.relativePath,
                    text,
                })
            },
        }),
    ]
}
