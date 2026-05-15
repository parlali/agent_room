import { rm } from 'node:fs/promises'
import { relative } from 'node:path'
import { defineTool, type ToolDefinition } from '@mariozechner/pi-coding-agent'
import { Type } from '@mariozechner/pi-ai'
import { textToolResult } from './tool-helpers'
import { createDocx, editDocx, inspectDocx } from './document-tools/docx'
import {
    createPdf,
    editPdf,
    extractPdfText,
    inspectPdf,
    normalizePdfEdits,
} from './document-tools/pdf'
import { createPptx, editPptx, inspectPptx, normalizeSlides } from './document-tools/pptx'
import { completeOfficeExportOrPreview, completeOperation } from './document-tools/operation'
import {
    existingDocumentPath,
    writableInternalPreviewPath,
    writableWorkspacePath,
} from './document-tools/paths'
import type { DocumentToolContext, DocumentToolDetails } from './document-tools/types'
import { renderPdfPreview } from './document-tools/worker'
import { materializePdfRead } from './pdf-ingestion'
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
            'Legacy DOCX compatibility tool. Prefer the bundled office-documents skill for create, inspect, and edit; use this tool for export or preview compatibility.',
        promptSnippet:
            'agent_room_docx is a legacy compatibility path. Prefer the office-documents skill through agent_room_shell for DOCX create, inspect, and edit. Use agent_room_docx only when export_pdf, preview, or legacy structured compatibility is needed.',
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
            'Legacy XLSX compatibility tool. Prefer the bundled office-documents skill for create, inspect, and edit; use this tool for export, preview, or workbook chart compatibility.',
        promptSnippet:
            'agent_room_xlsx is a legacy compatibility path. Prefer the office-documents skill through agent_room_shell for XLSX create, inspect, and edit. Use agent_room_xlsx when export_pdf, preview, or structured workbook chart compatibility is needed. workbookJson is a JSON array of sheets like [{"name":"Data","rows":[["Item","Qty"],["A",1]],"charts":[{"type":"bar","title":"Totals","labelsRange":"A2:A4","valuesRange":"D2:D4","anchor":"F2"}]}]. replacementsJson accepts [{"oldText":"A","newText":"B"}] or direct cell edits like [{"sheet":"Data","cell":"B2","value":12}].',
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
            'Legacy PPTX compatibility tool. Prefer the bundled office-documents skill for create, inspect, and edit; use this tool for export or preview compatibility.',
        promptSnippet:
            'agent_room_pptx is a legacy compatibility path. Prefer the office-documents skill through agent_room_shell for PPTX create, inspect, and edit. Use agent_room_pptx only when export_pdf, preview, or legacy structured compatibility is needed.',
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
        description:
            'Create workspace PDF files, inspect PDF metadata, edit PDFs, and preview room-local PDF files.',
        promptSnippet:
            'agent_room_pdf creates and edits durable workspace PDF outputs, inspects metadata, and renders previews. Use agent_room_read_pdf to read PDF content by default, and agent_room_pdf_extract_text only when explicit text extraction is requested. editsJson accepts [{"type":"append_text_page","title":"...","paragraphs":["..."]}], [{"type":"stamp_text","text":"...","page":1,"x":54,"y":54}], or [{"type":"delete_pages","pages":[2]}].',
        parameters: Type.Object({
            operation: Type.Union([
                Type.Literal('create'),
                Type.Literal('inspect'),
                Type.Literal('edit'),
                Type.Literal('preview'),
            ]),
            path: Type.String(),
            root: rootParameter,
            title: Type.Optional(Type.String()),
            paragraphs: Type.Optional(Type.Array(Type.String())),
            editsJson: Type.Optional(Type.String()),
            outputPath: Type.Optional(Type.String()),
            maxChars: Type.Optional(Type.Number()),
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
            if (input.operation === 'edit') {
                assertWorkspaceMutation(root, input.operation)
                const count = await editPdf(path, normalizePdfEdits(input.editsJson))
                return completeOperation(ctx, {
                    path,
                    format: 'pdf',
                    operation: input.operation,
                    startedAt,
                    message: `Edited PDF ${relativeToRoot(ctx, root, path)} with ${count} edits`,
                    root,
                    mediaPath: path,
                })
            }
            if (input.operation === 'inspect') {
                return textToolResult<DocumentToolDetails>(
                    await inspectPdf(ctx, path, {
                        signal,
                        maxChars: input.maxChars,
                    }),
                    {
                        path,
                        root,
                        format: 'pdf',
                        operation: input.operation,
                    },
                )
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

function createReadPdfTool(ctx: DocumentToolContext): ToolDefinition {
    return defineTool({
        name: 'agent_room_read_pdf',
        label: 'Read PDF',
        description:
            'Read a room-local PDF through the highest-fidelity configured provider path. Anthropic rooms receive native PDF document input; other vision-capable rooms receive rendered page images.',
        promptSnippet:
            'agent_room_read_pdf is the default PDF reading path. Use pages like "1", "1-3", or "1,4-5" to bound rendered pages. It reports whether the model received a native PDF document or rendered page images.',
        parameters: Type.Object({
            path: Type.String(),
            root: rootParameter,
            pages: Type.Optional(Type.String()),
        }),
        executionMode: 'sequential',
        execute: async (_toolCallId, input, signal, _onUpdate, toolContext) => {
            const root = sourceRoot(input)
            const path = await existingDocumentPath(ctx.config, root, input.path)
            const pdf = await materializePdfRead({
                config: ctx.config,
                path,
                pages: input.pages,
                model: toolContext?.model,
                signal,
            })
            const details = {
                path,
                root,
                format: 'pdf',
                operation: 'read',
                ingestionMode: pdf.mode,
                backend: pdf.backend,
                pageCount: pdf.pageCount,
                pages: pdf.selectedPages.label,
                requestedPages: pdf.requestedPages,
                inputBlocks: pdf.content.length,
                degraded: pdf.degraded,
                degradedReason: pdf.degradedReason,
            }
            await ctx.audit('tool.pdf', details)
            const message =
                pdf.mode === 'native_document'
                    ? `PDF read prepared as Anthropic native document input (${pdf.selectedPages.label}; ${pdf.pageCount} total pages).${pdf.requestedPages ? ` Requested ${pdf.requestedPages}; native document input sends the full PDF.` : ''}`
                    : pdf.mode === 'image_render'
                      ? `PDF read prepared as rendered page images (${pdf.selectedPages.label}; ${pdf.pageCount} total pages).`
                      : `PDF read is unsupported for the configured provider/model (${pdf.selectedPages.label}; ${pdf.pageCount} total pages).`
            return {
                content: [
                    {
                        type: 'text' as const,
                        text:
                            pdf.degraded && pdf.degradedReason
                                ? `${message}\nDegraded: ${pdf.degradedReason}`
                                : message,
                    },
                    ...pdf.content,
                ],
                details,
            }
        },
    })
}

function createPdfExtractTextTool(ctx: DocumentToolContext): ToolDefinition {
    return defineTool({
        name: 'agent_room_pdf_extract_text',
        label: 'Extract PDF Text',
        description:
            'Explicitly extract text from a room-local PDF. This is not the default PDF reading path and may return no text for scanned PDFs.',
        promptSnippet:
            'agent_room_pdf_extract_text is only for explicit text extraction requests or when agent_room_read_pdf reports that native document or image rendering is unavailable.',
        parameters: Type.Object({
            path: Type.String(),
            root: rootParameter,
            pageStart: Type.Optional(Type.Number()),
            pageEnd: Type.Optional(Type.Number()),
            maxChars: Type.Optional(Type.Number()),
        }),
        executionMode: 'sequential',
        execute: async (_toolCallId, input, signal) => {
            const root = sourceRoot(input)
            const path = await existingDocumentPath(ctx.config, root, input.path)
            const text = await extractPdfText(ctx, path, {
                pageStart: input.pageStart,
                pageEnd: input.pageEnd,
                maxChars: input.maxChars,
                signal,
            })
            await ctx.audit('tool.pdf', {
                path,
                root,
                format: 'pdf',
                operation: 'extract_text',
                ingestionMode: 'text_extract',
            })
            return textToolResult<DocumentToolDetails & { ingestionMode: 'text_extract' }>(text, {
                path,
                root,
                format: 'pdf',
                operation: 'extract_text',
                ingestionMode: 'text_extract',
            })
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
        tools.push(createReadPdfTool(ctx))
        tools.push(createPdfExtractTextTool(ctx))
        tools.push(createPdfTool(ctx))
    }
    return tools
}
