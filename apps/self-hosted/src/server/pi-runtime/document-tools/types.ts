import type { PiRuntimeConfig } from '../../rooms/pi-runtime-config'
import type { ToolRoot } from '../room-tools/shared'

export interface DocumentToolContext {
    config: PiRuntimeConfig
    audit: (event: string, payload: unknown) => Promise<void>
}

export interface DocumentToolDetails {
    path?: string
    root?: ToolRoot
    artifactId?: string
    sha256?: string
    byteLength?: number
    mediaType?: string
    exportedPath?: string
    previewPath?: string
    operation?: string
    format?: string
    durationMs?: number
}
