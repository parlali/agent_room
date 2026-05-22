import { statSync } from 'node:fs'
import { basename, join } from 'node:path'
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
import { visibleRoomRelativePath } from './room-visible-paths'

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

const writeToolNames = new Set([
    'write',
    'edit',
    'artifact_export',
    'pdf',
    'agent_room_write',
    'agent_room_edit',
    'agent_room_artifact_export',
    'agent_room_pdf',
])

const explicitArtifactToolNames = new Set([
    'artifact_export',
    'pdf',
    'artifact_import',
    'agent_room_artifact_export',
    'agent_room_pdf',
    'agent_room_artifact_import',
])

const officeSkillScripts = [
    {
        format: 'docx',
        scriptPath: 'skills/docx/scripts/docx_document.ts',
    },
    {
        format: 'xlsx',
        scriptPath: 'skills/xlsx/scripts/xlsx_workbook.ts',
    },
    {
        format: 'pptx',
        scriptPath: 'skills/pptx/scripts/pptx_deck.ts',
    },
] as const

const officeArtifactOperations = new Set(['create', 'edit'])
const shellToolNames = new Set(['shell', 'agent_room_shell'])

function artifactId(surface: ArtifactSurface, relativePath: string): string {
    return `${surface}:${relativePath}`
}

function artifactPriority(kind: RoomSessionArtifactKind): number {
    if (kind === 'edited') return 4
    if (kind === 'created') return 3
    if (kind === 'attached') return 2
    return 1
}

function visibleRelativePath(
    config: PiRuntimeConfig,
    surface: ArtifactSurface,
    path: string,
): string | null {
    return visibleRoomRelativePath({
        config,
        surface,
        path,
    })
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

function booleanValue(value: unknown): boolean {
    return value === true
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
    if (operation === 'edit' || toolName === 'edit' || toolName === 'agent_room_edit') {
        return 'edited'
    }
    if (
        operation === 'create' ||
        operation === 'export_pdf' ||
        operation === 'preview' ||
        toolName === 'write' ||
        toolName === 'artifact_export' ||
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

function hasExplicitArtifactPromotion(input: {
    toolName: string | null
    artifactId: string | null
    operation: string | null
}): boolean {
    if (input.artifactId) return true
    if (input.operation === 'artifact_export' || input.operation === 'export_pdf') return true
    return input.toolName ? explicitArtifactToolNames.has(input.toolName) : false
}

function fileByteLength(input: {
    config: PiRuntimeConfig
    surface: ArtifactSurface
    path: string | null
}): number | null {
    if (!input.path) return null
    const relativePath = visibleRelativePath(input.config, input.surface, input.path)
    if (!relativePath) return null
    const root =
        input.surface === 'store' ? input.config.paths.storeDir : input.config.paths.workspaceDir
    try {
        const stat = statSync(join(root, relativePath))
        return stat.isFile() ? stat.size : null
    } catch {
        return null
    }
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

function normalizeCommandPath(value: string): string {
    return value.replace(/\\/g, '/')
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function officeSkillFormatForCommand(command: string | null): string | null {
    if (!command) return null
    const normalizedCommand = normalizeCommandPath(command)
    if (!/(^|[\s"';&|])(?:\S*\/)?bun([\s"';&|]|$)/.test(normalizedCommand)) {
        return null
    }
    const match = officeSkillScripts.find((script) =>
        new RegExp(`${escapeRegex(script.scriptPath)}(["'\\s;&|]|$)`).test(normalizedCommand),
    )
    return match?.format ?? null
}

function pathMatchesOfficeFormat(path: string, format: string): boolean {
    return path.toLowerCase().endsWith(`.${format}`)
}

function toolResultText(message: Record<string, unknown>): string {
    return extractTextFromRuntimeContent(message.content)
}

function trailingJsonObject(text: string): Record<string, unknown> | null {
    const trimmed = text.trim()
    const candidates = [
        trimmed,
        ...trimmed
            .split(/\n\n+/)
            .map((part) => part.trim())
            .filter(Boolean)
            .reverse(),
    ]
    for (const candidate of candidates) {
        if (!candidate.startsWith('{') || !candidate.endsWith('}')) continue
        try {
            const parsed = JSON.parse(candidate) as unknown
            return isRecord(parsed) ? parsed : null
        } catch {}
    }
    return null
}

function officeShellArtifacts(input: {
    config: PiRuntimeConfig
    message: Record<string, unknown>
    call: ToolCallRecord | null
    details: Record<string, unknown> | null
    timestamp: number | null
    messageId: string | null
}): ArtifactDraft[] {
    const toolName = stringValue(input.message.toolName) ?? input.call?.toolName ?? null
    if (!shellToolNames.has(toolName ?? '')) return []
    if (numberValue(input.details?.exitCode) !== 0) return []
    if (
        booleanValue(input.details?.truncated) ||
        booleanValue(input.details?.modelVisibleTruncated)
    ) {
        return []
    }

    const format = officeSkillFormatForCommand(stringValue(input.call?.arguments.command))
    if (!format) return []

    const result = trailingJsonObject(toolResultText(input.message))
    if (!result) return []
    if (stringValue(result.format) !== format) return []

    const operation = stringValue(result.operation)
    if (!operation) return []

    const inputRoot = stringValue(result.root)
    const outputRoot = stringValue(result.outputRoot)
    if (inputRoot !== 'workspace' && !(operation === 'render' && outputRoot === 'workspace')) {
        return []
    }
    const surface = 'workspace'

    const drafts: ArtifactDraft[] = []
    const path = stringValue(result.path)
    if (
        inputRoot === 'workspace' &&
        path &&
        officeArtifactOperations.has(operation) &&
        pathMatchesOfficeFormat(path, format)
    ) {
        const byteLength = fileByteLength({
            config: input.config,
            surface,
            path,
        })
        const draft = artifactFromPath({
            config: input.config,
            surface,
            path,
            kind: operation === 'edit' ? 'edited' : 'created',
            toolName: format,
            operation,
            artifactId: null,
            byteLength,
            timestamp: input.timestamp,
            messageId: input.messageId,
        })
        if (draft) drafts.push(draft)
    }

    const pdfPath = stringValue(result.pdfPath)
    if (operation === 'render' && pdfPath?.toLowerCase().endsWith('.pdf')) {
        const draft = artifactFromPath({
            config: input.config,
            surface,
            path: pdfPath,
            kind: 'created',
            toolName: format,
            operation,
            artifactId: null,
            byteLength: fileByteLength({
                config: input.config,
                surface,
                path: pdfPath,
            }),
            timestamp: input.timestamp,
            messageId: input.messageId,
        })
        if (draft) drafts.push(draft)
    }
    return drafts
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
    const explicitlyPromoted = hasExplicitArtifactPromotion({
        toolName,
        artifactId: artifactIdValue,
        operation,
    })

    for (const artifact of officeShellArtifacts({
        config: input.config,
        message,
        call: call ?? null,
        details,
        timestamp,
        messageId,
    })) {
        addArtifact(input.artifacts, artifact)
    }

    if (fileChange && explicitlyPromoted) {
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

    if (
        explicitlyPromoted &&
        (toolName === 'artifact_import' || toolName === 'agent_room_artifact_import')
    ) {
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

    if (explicitlyPromoted && writeToolNames.has(toolName ?? '')) {
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
