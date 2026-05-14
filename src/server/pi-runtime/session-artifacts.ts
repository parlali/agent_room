import { basename, isAbsolute, relative, sep } from 'node:path'
import type { SessionEntry } from '@mariozechner/pi-coding-agent'
import { extractTextFromRuntimeContent } from '#/lib/runtime-message'
import { parseRoomMessageAttachments } from '#/lib/room-attachments'
import type { RoomSessionArtifact, RoomSessionArtifactKind } from '../rooms/execution-types'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import { entryTimestamp } from './session-entry-mapper'
import { isRecord } from './runtime-redaction'
import {
    promptAttachmentMetadataByEntryId,
    type PromptAttachmentMetadata,
} from './prompt-attachments'

type ArtifactSurface = RoomSessionArtifact['surface']

interface ToolCallRecord {
    toolName: string | null
    arguments: Record<string, unknown>
    messageId: string | null
    timestamp: number | null
}

interface ArtifactDraft {
    surface: ArtifactSurface
    relativePath: string
    kind: RoomSessionArtifactKind
    source: string
    toolName: string | null
    operation: string | null
    artifactId: string | null
    byteLength: number | null
    timestamp: number | null
    messageId: string | null
}

const internalStoreRoots = new Set(['blobs', 'manifests', 'previews'])

const writeToolNames = new Set([
    'agent_room_write',
    'agent_room_edit',
    'agent_room_artifact_export',
    'agent_room_docx',
    'agent_room_xlsx',
    'agent_room_pptx',
    'agent_room_pdf',
])

const readToolNames = new Set([
    'agent_room_read',
    'agent_room_docx',
    'agent_room_xlsx',
    'agent_room_pptx',
    'agent_room_pdf',
])

function artifactId(surface: ArtifactSurface, relativePath: string): string {
    return `${surface}:${relativePath}`
}

function artifactPriority(kind: RoomSessionArtifactKind): number {
    if (kind === 'edited') return 4
    if (kind === 'created') return 3
    if (kind === 'attached') return 2
    return 1
}

function rootPath(config: PiRuntimeConfig, surface: ArtifactSurface): string {
    return surface === 'store' ? config.paths.storeDir : config.paths.workspaceDir
}

function normalizePath(path: string): string {
    return path
        .split(sep)
        .join('/')
        .replace(/^\.\/+/, '')
}

function visibleRelativePath(
    config: PiRuntimeConfig,
    surface: ArtifactSurface,
    path: string,
): string | null {
    const trimmed = path.trim()
    if (!trimmed) return null
    let relativePath = trimmed
    if (isAbsolute(trimmed)) {
        const display = relative(rootPath(config, surface), trimmed)
        if (display.startsWith('..') || isAbsolute(display)) return null
        relativePath = display
    }
    relativePath = normalizePath(relativePath)
    if (!relativePath || relativePath === '.') return null
    if (surface === 'store') {
        const root = relativePath.split('/')[0] ?? relativePath
        if (internalStoreRoots.has(root)) return null
    }
    return relativePath
}

function normalizeSurface(value: unknown): ArtifactSurface {
    return value === 'store' ? 'store' : 'workspace'
}

function stringValue(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value : null
}

function numberValue(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function artifactName(relativePath: string): string {
    return basename(relativePath) || relativePath
}

function operationFrom(
    input: Record<string, unknown> | null,
    details: Record<string, unknown> | null,
): string | null {
    return stringValue(details?.operation) ?? stringValue(input?.operation)
}

function sourceFor(input: {
    kind: RoomSessionArtifactKind
    toolName: string | null
    operation: string | null
}): string {
    if (input.kind === 'attached') return 'Attached by user'
    const tool = input.toolName ? toolLabel(input.toolName) : 'session'
    if (input.kind === 'created')
        return input.operation ? `${tool} ${input.operation}` : `Created by ${tool}`
    if (input.kind === 'edited')
        return input.operation ? `${tool} ${input.operation}` : `Edited by ${tool}`
    return input.operation ? `${tool} ${input.operation}` : `Referenced by ${tool}`
}

function toolLabel(toolName: string): string {
    return toolName.replace(/^agent_room_/, '').replace(/_/g, ' ')
}

function kindFromFileChange(fileChange: Record<string, unknown>): RoomSessionArtifactKind {
    const kind = stringValue(fileChange.kind)
    if (kind === 'edit') return 'edited'
    if (kind === 'artifact_export') {
        return fileChange.beforeSha256 ? 'edited' : 'created'
    }
    if (kind === 'write') {
        return fileChange.beforeSha256 ? 'edited' : 'created'
    }
    return 'created'
}

function kindFromTool(toolName: string | null, operation: string | null): RoomSessionArtifactKind {
    if (operation === 'edit') return 'edited'
    if (
        operation === 'create' ||
        operation === 'export_pdf' ||
        operation === 'preview' ||
        toolName === 'agent_room_write' ||
        toolName === 'agent_room_artifact_export'
    ) {
        return 'created'
    }
    return 'referenced'
}

function makeArtifact(input: ArtifactDraft): RoomSessionArtifact {
    return {
        id: artifactId(input.surface, input.relativePath),
        name: artifactName(input.relativePath),
        surface: input.surface,
        relativePath: input.relativePath,
        kind: input.kind,
        source: input.source,
        toolName: input.toolName,
        operation: input.operation,
        artifactId: input.artifactId,
        byteLength: input.byteLength,
        timestamp: input.timestamp,
        messageId: input.messageId,
    }
}

function addArtifact(
    artifacts: Map<string, RoomSessionArtifact>,
    draft: ArtifactDraft | null,
): void {
    if (!draft) return
    const next = makeArtifact(draft)
    const existing = artifacts.get(next.id)
    if (!existing) {
        artifacts.set(next.id, next)
        return
    }
    const nextPriority = artifactPriority(next.kind)
    const existingPriority = artifactPriority(existing.kind)
    artifacts.set(next.id, {
        ...(nextPriority >= existingPriority ? next : existing),
        byteLength: next.byteLength ?? existing.byteLength,
        timestamp:
            next.timestamp && existing.timestamp
                ? Math.max(next.timestamp, existing.timestamp)
                : (next.timestamp ?? existing.timestamp),
        artifactId: next.artifactId ?? existing.artifactId,
        messageId: next.messageId ?? existing.messageId,
    })
}

function artifactFromPath(input: {
    config: PiRuntimeConfig
    surface: ArtifactSurface
    path: string | null
    kind: RoomSessionArtifactKind
    toolName: string | null
    operation: string | null
    artifactId: string | null
    byteLength: number | null
    timestamp: number | null
    messageId: string | null
}): ArtifactDraft | null {
    if (!input.path) return null
    const relativePath = visibleRelativePath(input.config, input.surface, input.path)
    if (!relativePath) return null
    return {
        surface: input.surface,
        relativePath,
        kind: input.kind,
        source: sourceFor({
            kind: input.kind,
            toolName: input.toolName,
            operation: input.operation,
        }),
        toolName: input.toolName,
        operation: input.operation,
        artifactId: input.artifactId,
        byteLength: input.byteLength,
        timestamp: input.timestamp,
        messageId: input.messageId,
    }
}

function collectToolCalls(entry: SessionEntry, calls: Map<string, ToolCallRecord>): void {
    if (entry.type !== 'message') return
    const message = entry.message as unknown
    if (!isRecord(message)) return
    if (message.role !== 'assistant' || !Array.isArray(message.content)) return
    for (const block of message.content) {
        if (!isRecord(block) || block.type !== 'toolCall') continue
        const id = stringValue(block.id)
        if (!id) continue
        calls.set(id, {
            toolName: stringValue(block.name),
            arguments: isRecord(block.arguments) ? block.arguments : {},
            messageId: entry.id || null,
            timestamp: entryTimestamp(entry),
        })
    }
}

function collectAttachments(
    config: PiRuntimeConfig,
    entry: SessionEntry,
    artifacts: Map<string, RoomSessionArtifact>,
    attachmentMetadata: Map<string, PromptAttachmentMetadata>,
): void {
    if (entry.type !== 'message') return
    const message = entry.message as unknown
    if (!isRecord(message) || message.role !== 'user') return
    const metadata = entry.parentId ? (attachmentMetadata.get(entry.parentId) ?? null) : null
    const attachments =
        metadata?.attachments ??
        parseRoomMessageAttachments(extractTextFromRuntimeContent(message.content)).attachments
    for (const attachment of attachments) {
        addArtifact(
            artifacts,
            artifactFromPath({
                config,
                surface: attachment.surface,
                path: attachment.relativePath,
                kind: 'attached',
                toolName: null,
                operation: null,
                artifactId: null,
                byteLength: attachment.byteLength,
                timestamp: entryTimestamp(entry),
                messageId: entry.id || null,
            }),
        )
    }
}

function collectToolResult(input: {
    config: PiRuntimeConfig
    entry: SessionEntry
    calls: Map<string, ToolCallRecord>
    artifacts: Map<string, RoomSessionArtifact>
}): void {
    if (input.entry.type !== 'message') return
    const message = input.entry.message as unknown
    if (!isRecord(message) || message.role !== 'toolResult') return
    const toolCallId = stringValue(message.toolCallId)
    const call = toolCallId ? input.calls.get(toolCallId) : null
    const details = isRecord(message.details) ? message.details : null
    const args = call?.arguments ?? {}
    const toolName = stringValue(message.toolName) ?? call?.toolName ?? null
    const timestamp = entryTimestamp(input.entry)
    const messageId = input.entry.id || null
    const operation = operationFrom(args, details)
    const byteLength = numberValue(details?.byteLength)
    const artifactIdValue = stringValue(details?.artifactId)
    const fileChange = isRecord(details?.fileChange) ? details.fileChange : null
    const outputArtifact = isRecord(details?.outputArtifact) ? details.outputArtifact : null

    if (outputArtifact) {
        addArtifact(
            input.artifacts,
            artifactFromPath({
                config: input.config,
                surface: normalizeSurface(outputArtifact.root),
                path: stringValue(outputArtifact.path),
                kind: 'referenced',
                toolName,
                operation: 'tool_output',
                artifactId: null,
                byteLength: numberValue(outputArtifact.byteLength),
                timestamp,
                messageId,
            }),
        )
    }

    if (fileChange) {
        addArtifact(
            input.artifacts,
            artifactFromPath({
                config: input.config,
                surface: normalizeSurface(fileChange.root ?? details?.root),
                path: stringValue(fileChange.path),
                kind: kindFromFileChange(fileChange),
                toolName,
                operation,
                artifactId: artifactIdValue,
                byteLength: numberValue(fileChange.byteLength) ?? byteLength,
                timestamp,
                messageId,
            }),
        )
    }

    if (toolName === 'agent_room_artifact_import') {
        addArtifact(
            input.artifacts,
            artifactFromPath({
                config: input.config,
                surface: 'workspace',
                path: stringValue(args.path),
                kind: 'created',
                toolName,
                operation,
                artifactId: artifactIdValue,
                byteLength,
                timestamp,
                messageId,
            }),
        )
        return
    }

    if (writeToolNames.has(toolName ?? '')) {
        addArtifact(
            input.artifacts,
            artifactFromPath({
                config: input.config,
                surface: normalizeSurface(details?.root ?? args.root),
                path:
                    stringValue(details?.path) ??
                    stringValue(args.outputPath) ??
                    stringValue(args.path),
                kind: kindFromTool(toolName, operation),
                toolName,
                operation,
                artifactId: artifactIdValue,
                byteLength,
                timestamp,
                messageId,
            }),
        )
    }

    if (readToolNames.has(toolName ?? '')) {
        addArtifact(
            input.artifacts,
            artifactFromPath({
                config: input.config,
                surface: normalizeSurface(details?.root ?? args.root),
                path: stringValue(details?.path) ?? stringValue(args.path),
                kind: kindFromTool(toolName, operation),
                toolName,
                operation,
                artifactId: artifactIdValue,
                byteLength,
                timestamp,
                messageId,
            }),
        )
    }
}

export function extractSessionArtifacts(
    config: PiRuntimeConfig,
    entries: SessionEntry[],
): RoomSessionArtifact[] {
    const toolCalls = new Map<string, ToolCallRecord>()
    const artifacts = new Map<string, RoomSessionArtifact>()
    const attachmentMetadata = promptAttachmentMetadataByEntryId(entries)
    for (const entry of entries) {
        collectToolCalls(entry, toolCalls)
    }
    for (const entry of entries) {
        collectAttachments(config, entry, artifacts, attachmentMetadata)
        collectToolResult({
            config,
            entry,
            calls: toolCalls,
            artifacts,
        })
    }
    return [...artifacts.values()].sort((left, right) => {
        const timeDelta = (right.timestamp ?? 0) - (left.timestamp ?? 0)
        if (timeDelta !== 0) return timeDelta
        return left.name.localeCompare(right.name, undefined, { numeric: true })
    })
}
