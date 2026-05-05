import { relative } from 'node:path'
import type { AgentToolResult } from '@mariozechner/pi-coding-agent'
import { textToolResult } from '../tool-helpers'
import { promoteArtifact } from './artifacts'
import { mediaTypeFor, writableWorkspacePath } from './paths'
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
    },
): Promise<AgentToolResult<DocumentToolDetails>> {
    const artifact = input.mediaPath ? await promoteArtifact(ctx, input.mediaPath) : null
    const durationMs = Date.now() - input.startedAt
    await ctx.audit(`tool.${input.format}`, {
        operation: input.operation,
        path: input.path,
        durationMs,
        artifactId: artifact?.artifactId,
        sha256: artifact?.sha256,
        byteLength: artifact?.byteLength,
    })
    return textToolResult<DocumentToolDetails>(input.message, {
        path: input.path,
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
    const outputPath = await writableWorkspacePath(
        ctx.config,
        input.outputPath ?? `${input.requestedPath.replace(format.extensionPattern, '')}.pdf`,
    )
    await exportOfficeToPdf(ctx, input.sourcePath, outputPath, input.signal)
    if (input.operation === 'preview') {
        const previewPath = await writableWorkspacePath(
            ctx.config,
            `${input.outputPath ?? input.requestedPath}.preview.png`,
        )
        await renderPdfPreview(ctx, outputPath, previewPath, input.signal)
        return completeOperation(ctx, {
            path: previewPath,
            format: input.format,
            operation: input.operation,
            startedAt: input.startedAt,
            message: `Rendered ${format.label} preview ${relative(ctx.config.paths.workspaceDir, previewPath)}`,
            mediaPath: previewPath,
        })
    }
    return completeOperation(ctx, {
        path: outputPath,
        format: input.format,
        operation: input.operation,
        startedAt: input.startedAt,
        message: `Exported ${format.label} PDF ${relative(ctx.config.paths.workspaceDir, outputPath)}`,
        mediaPath: outputPath,
    })
}
