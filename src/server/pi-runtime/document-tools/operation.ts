import type { AgentToolResult } from '@mariozechner/pi-coding-agent'
import { textToolResult } from '../tool-helpers'
import { promoteArtifact } from './artifacts'
import { mediaTypeFor } from './paths'
import type { DocumentToolContext, DocumentToolDetails } from './types'
import type { ToolRoot } from '../room-tools/shared'

export async function completeOperation(
    ctx: DocumentToolContext,
    input: {
        path: string
        format: string
        operation: string
        startedAt: number
        message: string
        root?: ToolRoot
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
        root: input.root ?? 'workspace',
        format: input.format,
        operation: input.operation,
        artifactId: artifact?.artifactId,
        sha256: artifact?.sha256,
        byteLength: artifact?.byteLength,
        durationMs,
        mediaType: input.mediaPath ? mediaTypeFor(input.mediaPath) : undefined,
    })
}
