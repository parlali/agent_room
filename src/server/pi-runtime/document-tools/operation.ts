import { mkdtemp, rm } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type { AgentToolResult } from '@mariozechner/pi-coding-agent'
import { textToolResult } from '../tool-helpers'
import { promoteArtifact } from './artifacts'
import { mediaTypeFor, writableInternalPreviewPath, writableWorkspacePath } from './paths'
import type {
    DocumentToolContext,
    DocumentToolDetails,
    OfficeExportFormat,
    OfficeExportOperation,
} from './types'
import { officeExportFormats } from './types'
import { exportOfficeToPdf, renderPdfPreview } from './worker'

export async function completeOperation(
    ctx: DocumentToolContext,
    input: {
        path: string
        format: string
        operation: string
        startedAt: number
        message: string
        mediaPath?: string
        auditPath?: string
        displayPath?: string
    },
): Promise<AgentToolResult<DocumentToolDetails>> {
    const artifact = input.mediaPath ? await promoteArtifact(ctx, input.mediaPath) : null
    const durationMs = Date.now() - input.startedAt
    await ctx.audit(`tool.${input.format}`, {
        operation: input.operation,
        path: input.auditPath ?? input.path,
        durationMs,
        artifactId: artifact?.artifactId,
        sha256: artifact?.sha256,
        byteLength: artifact?.byteLength,
    })
    return textToolResult<DocumentToolDetails>(input.message, {
        path: input.displayPath ?? input.path,
        format: input.format,
        operation: input.operation,
        artifactId: artifact?.artifactId,
        sha256: artifact?.sha256,
        byteLength: artifact?.byteLength,
        durationMs,
        mediaType: input.mediaPath ? mediaTypeFor(input.mediaPath) : undefined,
    })
}

export async function completeOfficeExportOrPreview(
    ctx: DocumentToolContext,
    input: {
        sourcePath: string
        requestedPath: string
        outputPath?: string
        format: OfficeExportFormat
        operation: OfficeExportOperation
        startedAt: number
        signal?: AbortSignal
    },
): Promise<AgentToolResult<DocumentToolDetails>> {
    const format = officeExportFormats[input.format]
    if (input.operation === 'preview') {
        const hiddenPreview = !input.outputPath
        const previewPath = input.outputPath
            ? await writableWorkspacePath(ctx.config, input.outputPath)
            : await writableInternalPreviewPath(ctx.config, input.requestedPath, 'png')
        const tempDir = await mkdtemp(join(ctx.config.paths.tmpDir, 'office-preview-'))
        try {
            const pdfPath = join(tempDir, 'preview.pdf')
            await exportOfficeToPdf(ctx, input.sourcePath, pdfPath, input.signal)
            await renderPdfPreview(ctx, pdfPath, previewPath, input.signal)
            const visiblePath = input.outputPath
                ? relative(ctx.config.paths.workspaceDir, previewPath)
                : null
            return completeOperation(ctx, {
                path: previewPath,
                format: input.format,
                operation: input.operation,
                startedAt: input.startedAt,
                message: visiblePath
                    ? `Rendered ${format.label} preview ${visiblePath}`
                    : `Verified ${format.label} preview rendering internally`,
                mediaPath: hiddenPreview ? undefined : previewPath,
                auditPath: hiddenPreview ? 'internal-preview' : undefined,
                displayPath: visiblePath ?? 'internal-preview',
            })
        } finally {
            await rm(tempDir, {
                recursive: true,
                force: true,
            })
            if (hiddenPreview) {
                await rm(previewPath, {
                    force: true,
                })
            }
        }
    }
    const outputPath = await writableWorkspacePath(
        ctx.config,
        input.outputPath ?? `${input.requestedPath.replace(format.extensionPattern, '')}.pdf`,
    )
    await exportOfficeToPdf(ctx, input.sourcePath, outputPath, input.signal)
    return completeOperation(ctx, {
        path: outputPath,
        format: input.format,
        operation: input.operation,
        startedAt: input.startedAt,
        message: `Exported ${format.label} PDF ${relative(ctx.config.paths.workspaceDir, outputPath)}`,
        mediaPath: outputPath,
    })
}
