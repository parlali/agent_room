import { constants as fsConstants } from 'node:fs'
import { access, readFile, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative } from 'node:path'
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

async function workspaceAuditPath(
    config: PiRuntimeConfig,
    path: string | null,
): Promise<string | null> {
    if (!path) {
        return null
    }
    try {
        const candidate = workspacePath(config, path)
        const base = await realpath(config.paths.workspaceDir)
        try {
            return assertPathInsideRoot(await realpath(candidate), base, () => candidate)
        } catch {
            try {
                return assertPathInsideRoot(
                    join(await realpath(dirname(candidate)), basename(candidate)),
                    base,
                    () => candidate,
                )
            } catch {
                return assertPathInsideRoot(
                    join(base, relative(config.paths.workspaceDir, candidate)),
                    base,
                    () => candidate,
                )
            }
        }
    } catch {
        return null
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
            const path = await workspaceAuditPath(ctx.config, inputPath(input))
            const before = writableNativeTools.has(tool.name) ? await readExisting(path) : null
            const result = await tool.execute(toolCallId, input, signal, onUpdate, toolContext)
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
