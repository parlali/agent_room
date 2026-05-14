import { rm } from 'node:fs/promises'
import { relative } from 'node:path'
import { defineTool, type ToolDefinition } from '@mariozechner/pi-coding-agent'
import { Type } from '@mariozechner/pi-ai'
import { textToolResult } from './tool-helpers'
import { createDocx, editDocx, inspectDocx } from './document-tools/docx'
import { createPdf, inspectPdf } from './document-tools/pdf'
import { createPptx, editPptx, inspectPptx, normalizeSlides } from './document-tools/pptx'
import { completeOfficeExportOrPreview, completeOperation } from './document-tools/operation'
import {
    existingDocumentPath,
    writableInternalPreviewPath,
    writableWorkspacePath,
} from './document-tools/paths'
import type { DocumentToolContext, DocumentToolDetails } from './document-tools/types'
import { renderPdfPreview } from './document-tools/worker'
import {
    createXlsx,
    editXlsx,
    inspectXlsx,
    normalizeWorkbook,
    normalizeWorkbookEdits,
} from './document-tools/xlsx'
import { normalizeReplacements } from './document-tools/xml'
import { normalizeRoot, rootPath } from './room-tools/file-helpers'
import type { ToolRoot } from './room-tools/shared'

const rootParameter = Type.Optional(Type.Union([Type.Literal('workspace'), Type.Literal('store')]))

function sourceRoot(input: { root?: unknown }): ToolRoot {
    return normalizeRoot(input.root)
}

function relativeToRoot(ctx: DocumentToolContext, root: ToolRoot, path: string): string {
    return relative(rootPath(ctx.config, root), path)
}

function assertWorkspaceMutation(root: ToolRoot, operation: string): void {
    if (root === 'workspace') return
    throw new Error(
        `Document ${operation} writes are only supported in the workspace. Copy the file into the workspace before editing it.`,
    )
}

function createDocxTool(ctx: DocumentToolContext): ToolDefinition {
    return defineTool({
        name: 'agent_room_docx',
        label: 'Word Document',
        description:
            'Create or edit workspace DOCX documents, and inspect, export, or preview room-local DOCX files.',
        promptSnippet:
            'agent_room_docx performs structured DOCX operations for room-local files and promotes workspace outputs as durable artifacts.',
        parameters: Type.Object({
            operation: Type.Union([
                Type.Literal('create'),
                Type.Literal('inspect'),
                Type.Literal('edit'),
                Type.Literal('export_pdf'),
                Type.Literal('preview'),
            ]),
            path: Type.String(),
            root: rootParameter,
            title: Type.Optional(Type.String()),
            paragraphs: Type.Optional(Type.Array(Type.String())),
            replacementsJson: Type.Optional(Type.String()),
            outputPath: Type.Optional(Type.String()),
        }),
        executionMode: 'sequential',
        execute: async (_toolCallId, input, signal) => {
            const startedAt = Date.now()
            const root = sourceRoot(input)
            if (input.operation === 'create') {
                assertWorkspaceMutation(root, input.operation)
                const path = await writableWorkspacePath(ctx.config, input.path)
                await createDocx(path, input.title, input.paragraphs ?? [])
                return completeOperation(ctx, {
                    path,
                    format: 'docx',
                    operation: input.operation,
                    startedAt,
                    message: `Created DOCX ${relative(ctx.config.paths.workspaceDir, path)}`,
                    mediaPath: path,
                })
            }
            const path = await existingDocumentPath(ctx.config, root, input.path)
            if (input.operation === 'inspect') {
                return textToolResult<DocumentToolDetails>(await inspectDocx(path), {
                    path,
                    root,
                    format: 'docx',
                    operation: input.operation,
                })
            }
            if (input.operation === 'edit') {
                assertWorkspaceMutation(root, input.operation)
                const count = await editDocx(path, normalizeReplacements(input.replacementsJson))
                return completeOperation(ctx, {
                    path,
                    format: 'docx',
                    operation: input.operation,
                    startedAt,
                    message: `Edited DOCX ${relativeToRoot(ctx, root, path)} with ${count} replacements`,
                    root,
                    mediaPath: path,
                })
            }
            return completeOfficeExportOrPreview(ctx, {
                sourcePath: path,
                requestedPath: input.path,
                sourceRoot: root,
                outputPath: input.outputPath,
                format: 'docx',
                operation: input.operation === 'preview' ? 'preview' : 'export_pdf',
                startedAt,
                signal,
            })
        },
    })
}

function createXlsxTool(ctx: DocumentToolContext): ToolDefinition {
    return defineTool({
        name: 'agent_room_xlsx',
        label: 'Workbook',
        description:
            'Create or edit workspace XLSX workbooks, and inspect, export, or preview room-local XLSX files.',
        promptSnippet:
            'agent_room_xlsx performs structured workbook operations for room-local files with rows, formulas, charts, cell edits, and durable workspace exports. workbookJson is a JSON array of sheets like [{"name":"Data","rows":[["Item","Qty"],["A",1]],"charts":[{"type":"bar","title":"Totals","labelsRange":"A2:A4","valuesRange":"D2:D4","anchor":"F2"}]}]. replacementsJson accepts [{"oldText":"A","newText":"B"}] or direct cell edits like [{"sheet":"Data","cell":"B2","value":12}].',
        parameters: Type.Object({
            operation: Type.Union([
                Type.Literal('create'),
                Type.Literal('inspect'),
                Type.Literal('edit'),
                Type.Literal('export_pdf'),
                Type.Literal('preview'),
            ]),
            path: Type.String(),
            root: rootParameter,
            workbookJson: Type.Optional(Type.String()),
            replacementsJson: Type.Optional(Type.String()),
            outputPath: Type.Optional(Type.String()),
        }),
        executionMode: 'sequential',
        execute: async (_toolCallId, input, signal) => {
            const startedAt = Date.now()
            const root = sourceRoot(input)
            if (input.operation === 'create') {
                assertWorkspaceMutation(root, input.operation)
                const path = await writableWorkspacePath(ctx.config, input.path)
                await createXlsx(path, normalizeWorkbook(input.workbookJson))
                return completeOperation(ctx, {
                    path,
                    format: 'xlsx',
                    operation: input.operation,
                    startedAt,
                    message: `Created XLSX ${relative(ctx.config.paths.workspaceDir, path)}`,
                    mediaPath: path,
                })
            }
            const path = await existingDocumentPath(ctx.config, root, input.path)
            if (input.operation === 'inspect') {
                return textToolResult<DocumentToolDetails>(await inspectXlsx(path), {
                    path,
                    root,
                    format: 'xlsx',
                    operation: input.operation,
                })
            }
            if (input.operation === 'edit') {
                assertWorkspaceMutation(root, input.operation)
                const count = await editXlsx(path, normalizeWorkbookEdits(input.replacementsJson))
                return completeOperation(ctx, {
                    path,
                    format: 'xlsx',
                    operation: input.operation,
                    startedAt,
                    message: `Edited XLSX ${relativeToRoot(ctx, root, path)} with ${count} replacements`,
                    root,
                    mediaPath: path,
                })
            }
            return completeOfficeExportOrPreview(ctx, {
                sourcePath: path,
                requestedPath: input.path,
                sourceRoot: root,
                outputPath: input.outputPath,
                format: 'xlsx',
                operation: input.operation === 'preview' ? 'preview' : 'export_pdf',
                startedAt,
                signal,
            })
        },
    })
}

function createPptxTool(ctx: DocumentToolContext): ToolDefinition {
    return defineTool({
        name: 'agent_room_pptx',
        label: 'Presentation',
        description:
            'Create or edit workspace PPTX presentations, and inspect, export, or preview room-local PPTX files.',
        promptSnippet:
            'agent_room_pptx creates structured workspace slides and inspects, exports, or previews room-local presentations.',
        parameters: Type.Object({
            operation: Type.Union([
                Type.Literal('create'),
                Type.Literal('inspect'),
                Type.Literal('edit'),
                Type.Literal('export_pdf'),
                Type.Literal('preview'),
            ]),
            path: Type.String(),
            root: rootParameter,
            slidesJson: Type.Optional(Type.String()),
            replacementsJson: Type.Optional(Type.String()),
            outputPath: Type.Optional(Type.String()),
        }),
        executionMode: 'sequential',
        execute: async (_toolCallId, input, signal) => {
            const startedAt = Date.now()
            const root = sourceRoot(input)
            if (input.operation === 'create') {
                assertWorkspaceMutation(root, input.operation)
                const path = await writableWorkspacePath(ctx.config, input.path)
                await createPptx(ctx, path, normalizeSlides(input.slidesJson))
                return completeOperation(ctx, {
                    path,
                    format: 'pptx',
                    operation: input.operation,
                    startedAt,
                    message: `Created PPTX ${relative(ctx.config.paths.workspaceDir, path)}`,
                    mediaPath: path,
                })
            }
            const path = await existingDocumentPath(ctx.config, root, input.path)
            if (input.operation === 'inspect') {
                return textToolResult<DocumentToolDetails>(await inspectPptx(path), {
                    path,
                    root,
                    format: 'pptx',
                    operation: input.operation,
                })
            }
            if (input.operation === 'edit') {
                assertWorkspaceMutation(root, input.operation)
                const count = await editPptx(path, normalizeReplacements(input.replacementsJson))
                return completeOperation(ctx, {
                    path,
                    format: 'pptx',
                    operation: input.operation,
                    startedAt,
                    message: `Edited PPTX ${relativeToRoot(ctx, root, path)} with ${count} replacements`,
                    root,
                    mediaPath: path,
                })
            }
            return completeOfficeExportOrPreview(ctx, {
                sourcePath: path,
                requestedPath: input.path,
                sourceRoot: root,
                outputPath: input.outputPath,
                format: 'pptx',
                operation: input.operation === 'preview' ? 'preview' : 'export_pdf',
                startedAt,
                signal,
            })
        },
    })
}

function createPdfTool(ctx: DocumentToolContext): ToolDefinition {
    return defineTool({
        name: 'agent_room_pdf',
        label: 'PDF',
        description: 'Create workspace PDF files, and inspect or preview room-local PDF files.',
        promptSnippet:
            'agent_room_pdf creates durable workspace PDF outputs and inspects or renders room-local PDF page previews when requested.',
        parameters: Type.Object({
            operation: Type.Union([
                Type.Literal('create'),
                Type.Literal('inspect'),
                Type.Literal('preview'),
            ]),
            path: Type.String(),
            root: rootParameter,
            title: Type.Optional(Type.String()),
            paragraphs: Type.Optional(Type.Array(Type.String())),
            outputPath: Type.Optional(Type.String()),
        }),
        executionMode: 'sequential',
        execute: async (_toolCallId, input, signal) => {
            const startedAt = Date.now()
            const root = sourceRoot(input)
            if (input.operation === 'create') {
                assertWorkspaceMutation(root, input.operation)
                const path = await writableWorkspacePath(ctx.config, input.path)
                await createPdf(path, input.title, input.paragraphs ?? [])
                return completeOperation(ctx, {
                    path,
                    format: 'pdf',
                    operation: input.operation,
                    startedAt,
                    message: `Created PDF ${relative(ctx.config.paths.workspaceDir, path)}`,
                    mediaPath: path,
                })
            }
            const path = await existingDocumentPath(ctx.config, root, input.path)
            if (input.operation === 'inspect') {
                return textToolResult<DocumentToolDetails>(await inspectPdf(path), {
                    path,
                    root,
                    format: 'pdf',
                    operation: input.operation,
                })
            }
            const hiddenPreview = !input.outputPath
            const previewPath = input.outputPath
                ? await writableWorkspacePath(ctx.config, input.outputPath)
                : await writableInternalPreviewPath(ctx.config, input.path, 'png')
            try {
                await renderPdfPreview(ctx, path, previewPath, signal)
                const visiblePath = input.outputPath
                    ? relative(ctx.config.paths.workspaceDir, previewPath)
                    : null
                return completeOperation(ctx, {
                    path: previewPath,
                    format: 'pdf',
                    operation: input.operation,
                    startedAt,
                    message: visiblePath
                        ? `Rendered PDF preview ${visiblePath}`
                        : 'Verified PDF preview rendering internally',
                    mediaPath: hiddenPreview ? undefined : previewPath,
                    auditPath: hiddenPreview ? 'internal-preview' : undefined,
                    displayPath: visiblePath ?? 'internal-preview',
                })
            } finally {
                if (hiddenPreview) {
                    await rm(previewPath, {
                        force: true,
                    })
                }
            }
        },
    })
}

export function createDocumentTools(ctx: DocumentToolContext): ToolDefinition[] {
    const tools: ToolDefinition[] = []
    if (ctx.config.capabilities.documents) {
        tools.push(createDocxTool(ctx))
    }
    if (ctx.config.capabilities.spreadsheets) {
        tools.push(createXlsxTool(ctx))
    }
    if (ctx.config.capabilities.presentations) {
        tools.push(createPptxTool(ctx))
    }
    if (ctx.config.capabilities.pdf) {
        tools.push(createPdfTool(ctx))
    }
    return tools
}
