import { rm } from 'node:fs/promises'
import { relative } from 'node:path'
import { defineTool, type ToolDefinition } from '@mariozechner/pi-coding-agent'
import { Type } from '@mariozechner/pi-ai'
import { textToolResult } from './tool-helpers'
import { createPdf, editPdf, inspectPdf, normalizePdfEdits } from './document-tools/pdf'
import { completeOperation } from './document-tools/operation'
import {
    existingDocumentPath,
    writableInternalPreviewPath,
    writableWorkspacePath,
} from './document-tools/paths'
import type { DocumentToolContext, DocumentToolDetails } from './document-tools/types'
import { renderPdfPreview } from './document-tools/worker'
import { materializePdfRead } from './pdf-ingestion'
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
        `PDF ${operation} writes are only supported in the workspace. Copy the file into the workspace before editing it.`,
    )
}

function createPdfTool(ctx: DocumentToolContext): ToolDefinition {
    return defineTool({
        name: 'pdf',
        label: 'PDF',
        description:
            'Create workspace PDF files, inspect PDF metadata, edit PDFs, and preview PDF files.',
        promptSnippet:
            'pdf creates and edits durable workspace PDF outputs, inspects metadata, and renders previews. Use read_pdf to read PDF content. editsJson accepts [{"type":"append_text_page","title":"...","paragraphs":["..."]}], [{"type":"stamp_text","text":"...","page":1,"x":54,"y":54}], or [{"type":"delete_pages","pages":[2]}].',
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
        }),
        executionMode: 'sequential',
        execute: async (_toolCallId, input, signal) => {
            const startedAt = Date.now()
            const root = sourceRoot(input)
            if (input.operation === 'create') {
                assertWorkspaceMutation(root, input.operation)
                const path = await writableWorkspacePath(ctx.config, input.path)
                await createPdf(ctx.config, path, input.title, input.paragraphs ?? [])
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
                const count = await editPdf(ctx.config, path, normalizePdfEdits(input.editsJson))
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

function createReadPdfTool(ctx: DocumentToolContext): ToolDefinition {
    return defineTool({
        name: 'read_pdf',
        label: 'Read PDF',
        description:
            'Read a PDF through the highest-fidelity configured provider path. Anthropic models receive native PDF document input; other vision-capable models receive rendered page images.',
        promptSnippet:
            'read_pdf is the default PDF reading path. Use pages like "1", "1-3", or "1,4-5" to bound rendered pages. It reports whether the model received a native PDF document or rendered page images.',
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

export function createDocumentTools(ctx: DocumentToolContext): ToolDefinition[] {
    const tools: ToolDefinition[] = []
    if (ctx.config.capabilities.pdf) {
        tools.push(createReadPdfTool(ctx))
        tools.push(createPdfTool(ctx))
    }
    return tools
}
