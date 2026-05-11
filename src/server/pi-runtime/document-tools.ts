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
    existingWorkspacePath,
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

function createDocxTool(ctx: DocumentToolContext): ToolDefinition {
    return defineTool({
        name: 'agent_room_docx',
        label: 'Word Document',
        description: 'Create, inspect, edit, export, or preview DOCX documents.',
        promptSnippet:
            'agent_room_docx performs structured DOCX operations and promotes outputs as durable artifacts.',
        parameters: Type.Object({
            operation: Type.Union([
                Type.Literal('create'),
                Type.Literal('inspect'),
                Type.Literal('edit'),
                Type.Literal('export_pdf'),
                Type.Literal('preview'),
            ]),
            path: Type.String(),
            title: Type.Optional(Type.String()),
            paragraphs: Type.Optional(Type.Array(Type.String())),
            replacementsJson: Type.Optional(Type.String()),
            outputPath: Type.Optional(Type.String()),
        }),
        executionMode: 'sequential',
        execute: async (_toolCallId, input, signal) => {
            const startedAt = Date.now()
            if (input.operation === 'create') {
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
            const path = await existingWorkspacePath(ctx.config, input.path)
            if (input.operation === 'inspect') {
                return textToolResult<DocumentToolDetails>(await inspectDocx(path), {
                    path,
                    format: 'docx',
                    operation: input.operation,
                })
            }
            if (input.operation === 'edit') {
                const count = await editDocx(path, normalizeReplacements(input.replacementsJson))
                return completeOperation(ctx, {
                    path,
                    format: 'docx',
                    operation: input.operation,
                    startedAt,
                    message: `Edited DOCX ${relative(ctx.config.paths.workspaceDir, path)} with ${count} replacements`,
                    mediaPath: path,
                })
            }
            return completeOfficeExportOrPreview(ctx, {
                sourcePath: path,
                requestedPath: input.path,
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
        description: 'Create, inspect, edit, export, or preview XLSX workbooks.',
        promptSnippet:
            'agent_room_xlsx performs structured workbook operations with rows, formulas, charts, cell edits, and durable exports. workbookJson is a JSON array of sheets like [{"name":"Data","rows":[["Item","Qty"],["A",1]],"charts":[{"type":"bar","title":"Totals","labelsRange":"A2:A4","valuesRange":"D2:D4","anchor":"F2"}]}]. replacementsJson accepts [{"oldText":"A","newText":"B"}] or direct cell edits like [{"sheet":"Data","cell":"B2","value":12}].',
        parameters: Type.Object({
            operation: Type.Union([
                Type.Literal('create'),
                Type.Literal('inspect'),
                Type.Literal('edit'),
                Type.Literal('export_pdf'),
                Type.Literal('preview'),
            ]),
            path: Type.String(),
            workbookJson: Type.Optional(Type.String()),
            replacementsJson: Type.Optional(Type.String()),
            outputPath: Type.Optional(Type.String()),
        }),
        executionMode: 'sequential',
        execute: async (_toolCallId, input, signal) => {
            const startedAt = Date.now()
            if (input.operation === 'create') {
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
            const path = await existingWorkspacePath(ctx.config, input.path)
            if (input.operation === 'inspect') {
                return textToolResult<DocumentToolDetails>(await inspectXlsx(path), {
                    path,
                    format: 'xlsx',
                    operation: input.operation,
                })
            }
            if (input.operation === 'edit') {
                const count = await editXlsx(path, normalizeWorkbookEdits(input.replacementsJson))
                return completeOperation(ctx, {
                    path,
                    format: 'xlsx',
                    operation: input.operation,
                    startedAt,
                    message: `Edited XLSX ${relative(ctx.config.paths.workspaceDir, path)} with ${count} replacements`,
                    mediaPath: path,
                })
            }
            return completeOfficeExportOrPreview(ctx, {
                sourcePath: path,
                requestedPath: input.path,
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
        description: 'Create, inspect, edit, export, or preview PPTX presentations.',
        promptSnippet:
            'agent_room_pptx creates structured slides with text, images, charts, exports, and previews.',
        parameters: Type.Object({
            operation: Type.Union([
                Type.Literal('create'),
                Type.Literal('inspect'),
                Type.Literal('edit'),
                Type.Literal('export_pdf'),
                Type.Literal('preview'),
            ]),
            path: Type.String(),
            slidesJson: Type.Optional(Type.String()),
            replacementsJson: Type.Optional(Type.String()),
            outputPath: Type.Optional(Type.String()),
        }),
        executionMode: 'sequential',
        execute: async (_toolCallId, input, signal) => {
            const startedAt = Date.now()
            if (input.operation === 'create') {
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
            const path = await existingWorkspacePath(ctx.config, input.path)
            if (input.operation === 'inspect') {
                return textToolResult<DocumentToolDetails>(await inspectPptx(path), {
                    path,
                    format: 'pptx',
                    operation: input.operation,
                })
            }
            if (input.operation === 'edit') {
                const count = await editPptx(path, normalizeReplacements(input.replacementsJson))
                return completeOperation(ctx, {
                    path,
                    format: 'pptx',
                    operation: input.operation,
                    startedAt,
                    message: `Edited PPTX ${relative(ctx.config.paths.workspaceDir, path)} with ${count} replacements`,
                    mediaPath: path,
                })
            }
            return completeOfficeExportOrPreview(ctx, {
                sourcePath: path,
                requestedPath: input.path,
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
        description: 'Create, inspect, or preview PDF files.',
        promptSnippet:
            'agent_room_pdf creates durable PDF outputs and renders page previews when requested.',
        parameters: Type.Object({
            operation: Type.Union([
                Type.Literal('create'),
                Type.Literal('inspect'),
                Type.Literal('preview'),
            ]),
            path: Type.String(),
            title: Type.Optional(Type.String()),
            paragraphs: Type.Optional(Type.Array(Type.String())),
            outputPath: Type.Optional(Type.String()),
        }),
        executionMode: 'sequential',
        execute: async (_toolCallId, input, signal) => {
            const startedAt = Date.now()
            if (input.operation === 'create') {
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
            const path = await existingWorkspacePath(ctx.config, input.path)
            if (input.operation === 'inspect') {
                return textToolResult<DocumentToolDetails>(await inspectPdf(path), {
                    path,
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
