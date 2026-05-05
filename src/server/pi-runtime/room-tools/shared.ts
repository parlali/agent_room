import type { PiRuntimeConfig } from '../../rooms/pi-runtime-config'
import { clampPositiveInteger as sharedClampPositiveInteger, textToolResult } from '../tool-helpers'

export type ToolRoot = 'workspace' | 'store'

export interface RoomToolDetails {
    root?: ToolRoot
    path?: string
    artifactId?: string
    sha256?: string
    byteLength?: number
    truncated?: boolean
    exitCode?: number | null
    timedOut?: boolean
    aborted?: boolean
    durationMs?: number
    sandboxMode?: 'dropped' | 'test-unsafe'
    commandId?: string
    status?: string
    fileChange?: {
        kind: 'write' | 'edit' | 'artifact_import' | 'artifact_export'
        root: ToolRoot
        path: string
        beforeSha256?: string | null
        afterSha256: string
        byteLength: number
        diff?: string[]
    }
}

export interface RoomToolContext {
    config: PiRuntimeConfig
    audit: (event: string, payload: unknown) => Promise<void>
}

export function textResult(
    text: string,
    details: RoomToolDetails = {},
): ReturnType<typeof textToolResult<RoomToolDetails>> {
    return textToolResult<RoomToolDetails>(text, details)
}

export const clampPositiveInteger = sharedClampPositiveInteger

export async function audit(ctx: RoomToolContext, event: string, payload: unknown): Promise<void> {
    await ctx.audit(`tool.${event}`, payload)
}
