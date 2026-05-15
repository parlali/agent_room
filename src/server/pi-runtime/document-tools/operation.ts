import type { AgentToolResult } from '@mariozechner/pi-coding-agent'
import { textToolResult } from '../tool-helpers'
import { promoteArtifact } from './artifacts'
import { mediaTypeFor } from './paths'
import type { DocumentToolContext, DocumentToolDetails } from './types'
import type { ToolRoot } from '../room-tools/shared'

/**
 * Finalizes a document-related tool operation by optionally promoting a media artifact, recording an audit event, and producing a structured text tool result.
 *
 * @param input - Operation details:
 *   - `path`: original document path
 *   - `format`: operation format used for auditing (e.g., "pdf", "png")
 *   - `operation`: name of the completed operation
 *   - `startedAt`: epoch milliseconds when the operation started (used to compute duration)
 *   - `message`: user-facing message included in the text tool result
 *   - `root` (optional): result root (defaults to `"workspace"`)
 *   - `mediaPath` (optional): path to a media artifact to promote and include in the result
 *   - `auditPath` (optional): path to record in the audit event instead of `path`
 *   - `displayPath` (optional): path to expose in the returned result instead of `path`
 * @returns The text tool result containing DocumentToolDetails:
 *   - `path`, `root`, `format`, and `operation`
 *   - `artifactId`, `sha256`, and `byteLength` when a media artifact was promoted
 *   - `durationMs` measured from `startedAt`
 *   - `mediaType` when `mediaPath` was provided
 */
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
