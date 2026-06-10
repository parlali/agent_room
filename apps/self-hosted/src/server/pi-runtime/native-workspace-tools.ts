import { constants as fsConstants } from 'node:fs'
import { access, lstat, readFile, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import {
    createEditToolDefinition,
    createFindToolDefinition,
    createGrepToolDefinition,
    createLsToolDefinition,
    createReadToolDefinition,
    createWriteToolDefinition,
    type ToolDefinition,
} from '@mariozechner/pi-coding-agent'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import { assertPathInsideRoot } from '../security/path-boundary'
import { ensureShellWritableDirectory, ensureShellWritableFile } from './shell-sandbox'
import { sha256Buffer } from './runtime-artifacts'
import { audit, type RoomToolContext } from './room-tools/shared'

const writableNativeTools = new Set(['edit', 'write'])

function textByteLength(result: Awaited<ReturnType<ToolDefinition['execute']>>): number {
    const text = result.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n')
    return Buffer.byteLength(text)
}

function inputPath(input: unknown): string | null {
    if (!input || typeof input !== 'object') {
        return null
    }
    const record = input as Record<string, unknown>
    return typeof record.path === 'string' && record.path.trim() ? record.path : null
}

function workspacePath(config: PiRuntimeConfig, path: string): string {
    const requested = path.trim()
    const candidate = isAbsolute(requested) ? requested : join(config.paths.workspaceDir, requested)
    return assertPathInsideRoot(
        candidate,
        config.paths.workspaceDir,
        (escaped) => `Path escapes workspace: ${escaped}`,
    )
}

async function nearestExistingParent(path: string): Promise<{
    existingParent: string
    missingParts: string[]
}> {
    const missingParts: string[] = []
    let current = path
    while (true) {
        const stat = await lstat(current).catch((error: unknown) => {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
                return null
            }
            throw error
        })
        if (stat) {
            return {
                existingParent: current,
                missingParts,
            }
        }
        missingParts.unshift(basename(current))
        const parent = dirname(current)
        if (parent === current) {
            throw new Error(`Path parent does not exist: ${path}`)
        }
        current = parent
    }
}

async function resolveWorkspaceToolPath(config: PiRuntimeConfig, path: string): Promise<string> {
    const candidate = workspacePath(config, path)
    const base = await realpath(config.paths.workspaceDir)
    try {
        return assertPathInsideRoot(await realpath(candidate), base, () => candidate)
    } catch {
        const { existingParent, missingParts } = await nearestExistingParent(candidate)
        const canonicalParent = assertPathInsideRoot(
            await realpath(existingParent),
            base,
            () => candidate,
        )
        return assertPathInsideRoot(join(canonicalParent, ...missingParts), base, () => candidate)
    }
}

async function resolveInputPath(config: PiRuntimeConfig, input: unknown): Promise<string | null> {
    const path = inputPath(input)
    return path ? await resolveWorkspaceToolPath(config, path) : null
}

function rewriteInputPath(input: unknown, path: string | null): unknown {
    if (!path || !input || typeof input !== 'object' || Array.isArray(input)) {
        return input
    }
    return {
        ...(input as Record<string, unknown>),
        path,
    }
}

async function boundedInput(
    config: PiRuntimeConfig,
    input: unknown,
): Promise<{
    input: unknown
    path: string | null
}> {
    const path = await resolveInputPath(config, input)
    return {
        input: rewriteInputPath(input, path),
        path,
    }
}

async function readExisting(path: string | null): Promise<Buffer | null> {
    if (!path) {
        return null
    }
    try {
        await access(path, fsConstants.F_OK)
        return await readFile(path)
    } catch {
        return null
    }
}

async function ensureWritableResult(
    config: PiRuntimeConfig,
    path: string | null,
): Promise<Buffer | null> {
    if (!path) {
        return null
    }
    await ensureShellWritableDirectory(config, dirname(path))
    await ensureShellWritableFile(config, path)
    return await readExisting(path)
}

type NativeWorkspaceToolDefinition = ToolDefinition<any, any, any>

function nativeWorkspaceDefinitions(cwd: string): NativeWorkspaceToolDefinition[] {
    return [
        createReadToolDefinition(cwd),
        createGrepToolDefinition(cwd),
        createFindToolDefinition(cwd),
        createLsToolDefinition(cwd),
        createEditToolDefinition(cwd),
        createWriteToolDefinition(cwd),
    ] as NativeWorkspaceToolDefinition[]
}

function wrapNativeWorkspaceTool(
    ctx: RoomToolContext,
    tool: NativeWorkspaceToolDefinition,
): NativeWorkspaceToolDefinition {
    return {
        ...tool,
        execute: async (toolCallId, input, signal, onUpdate, toolContext) => {
            const bounded = await boundedInput(ctx.config, input)
            const path = bounded.path
            const before = writableNativeTools.has(tool.name) ? await readExisting(path) : null
            const result = await tool.execute(
                toolCallId,
                bounded.input,
                signal,
                onUpdate,
                toolContext,
            )
            const after = writableNativeTools.has(tool.name)
                ? await ensureWritableResult(ctx.config, path)
                : null
            const fileChange =
                writableNativeTools.has(tool.name) && path && after
                    ? {
                          kind: tool.name === 'edit' ? ('edit' as const) : ('write' as const),
                          root: 'workspace' as const,
                          path,
                          beforeSha256: before ? sha256Buffer(before) : null,
                          afterSha256: sha256Buffer(after),
                          byteLength: after.byteLength,
                      }
                    : undefined
            await audit(ctx, tool.name, {
                path,
                byteLength: textByteLength(result),
                details: result.details ?? null,
                ...(fileChange ? { fileChange } : {}),
            })
            return result
        },
    }
}

export function createNativeWorkspaceTools(ctx: RoomToolContext): NativeWorkspaceToolDefinition[] {
    const enabled = new Set(
        ctx.config.capabilities.shellCoding
            ? ['read', 'grep', 'find', 'ls', 'edit', 'write']
            : ['read', 'grep', 'find', 'ls'],
    )
    return nativeWorkspaceDefinitions(ctx.config.paths.workspaceDir)
        .filter((tool) => enabled.has(tool.name))
        .map((tool) => wrapNativeWorkspaceTool(ctx, tool))
}
