import { copyFile, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { defineTool, type ToolDefinition } from '@mariozechner/pi-coding-agent'
import { Type } from '@mariozechner/pi-ai'
import type { CapabilityConfig, RoomMode } from '#/domain/domain-types'
import { promoteRuntimeArtifact, sha256Buffer } from './runtime-artifacts'
import { ensureShellWritableDirectory, ensureShellWritableFile } from './shell-sandbox'
import {
    createCommandPollTool,
    createCommandStartTool,
    createCommandStatusTool,
    createCommandTerminateTool,
    createShellTool,
} from './room-tools/command-tools'
import { createSkillTools } from './room-tools/skill-tools'
import { audit, textResult, type RoomToolContext } from './room-tools/shared'
import { resolveExistingToolPath, resolveWriteTargetPath } from './room-tools/file-helpers'

const nativeReadOnlyWorkspaceToolNames = ['read', 'grep', 'find', 'ls'] as const
const nativeWritableWorkspaceToolNames = ['edit', 'write'] as const
const skillToolNames = ['skill_list', 'skill_read', 'skill_search'] as const

function createArtifactImportTool(ctx: RoomToolContext): ToolDefinition {
    return defineTool({
        name: 'artifact_import',
        label: 'Import Artifact',
        description: 'Import a workspace file into the artifact store with provenance metadata.',
        promptSnippet: 'artifact_import copies workspace files into the artifact store.',
        parameters: Type.Object({
            path: Type.String(),
            mediaType: Type.Optional(Type.String()),
        }),
        execute: async (_toolCallId, input) => {
            const source = await resolveExistingToolPath(ctx.config, 'workspace', input.path)
            const artifact = await promoteRuntimeArtifact({
                config: ctx.config,
                path: source,
                mediaType: input.mediaType ?? 'application/octet-stream',
            })
            await audit(ctx, 'artifact_import', {
                path: source,
                artifactId: artifact.artifactId,
                sha256: artifact.sha256,
                byteLength: artifact.byteLength,
                fileChange: {
                    kind: 'artifact_import',
                    root: 'store',
                    path: artifact.manifestPath,
                    afterSha256: artifact.sha256,
                    byteLength: artifact.byteLength,
                },
            })
            return textResult(
                JSON.stringify(
                    {
                        artifactId: artifact.artifactId,
                        sha256: artifact.sha256,
                        byteLength: artifact.byteLength,
                    },
                    null,
                    4,
                ),
                {
                    root: 'store',
                    path: artifact.manifestPath,
                    artifactId: artifact.artifactId,
                    sha256: artifact.sha256,
                    byteLength: artifact.byteLength,
                    fileChange: {
                        kind: 'artifact_import',
                        root: 'store',
                        path: artifact.manifestPath,
                        afterSha256: artifact.sha256,
                        byteLength: artifact.byteLength,
                    },
                },
            )
        },
    })
}

function createArtifactExportTool(ctx: RoomToolContext): ToolDefinition {
    return defineTool({
        name: 'artifact_export',
        label: 'Export Artifact',
        description: 'Export an artifact store blob back into the workspace.',
        promptSnippet: 'artifact_export copies artifact store blobs into the workspace.',
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
            await ensureShellWritableDirectory(ctx.config, dirname(destination))
            await copyFile(source, destination)
            await ensureShellWritableFile(ctx.config, destination)
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

export function nativeWorkspaceToolNamesForCapabilities(capabilities: CapabilityConfig): string[] {
    return capabilities.shellCoding
        ? [...nativeReadOnlyWorkspaceToolNames, ...nativeWritableWorkspaceToolNames]
        : [...nativeReadOnlyWorkspaceToolNames]
}

export function roomToolNamesForMode(roomMode: RoomMode): string[] {
    if (roomMode === 'programmer') {
        return [
            ...skillToolNames,
            'shell',
            'command_start',
            'command_poll',
            'command_status',
            'command_terminate',
        ]
    }
    return [
        ...skillToolNames,
        'shell',
        'command_start',
        'command_poll',
        'command_status',
        'command_terminate',
        'artifact_import',
        'artifact_export',
    ]
}

export function roomToolNamesForCapabilities(
    roomMode: RoomMode,
    capabilities: CapabilityConfig,
): string[] {
    const enabled = new Set(roomToolNamesForMode(roomMode))
    if (!capabilities.shellCoding) {
        enabled.delete('shell')
        enabled.delete('command_start')
        enabled.delete('command_poll')
        enabled.delete('command_status')
        enabled.delete('command_terminate')
        enabled.delete('artifact_import')
        enabled.delete('artifact_export')
    }
    return roomToolNamesForMode(roomMode).filter((toolName) => enabled.has(toolName))
}

export function createRoomTools(ctx: RoomToolContext): ToolDefinition[] {
    const tools = [
        ...createSkillTools(ctx),
        createShellTool(ctx),
        createCommandStartTool(ctx),
        createCommandPollTool(ctx),
        createCommandStatusTool(ctx),
        createCommandTerminateTool(ctx),
        createArtifactImportTool(ctx),
        createArtifactExportTool(ctx),
    ]
    const enabled = new Set(
        roomToolNamesForCapabilities(ctx.config.roomMode, ctx.config.capabilities),
    )
    return tools.filter((tool) => enabled.has(tool.name))
}
