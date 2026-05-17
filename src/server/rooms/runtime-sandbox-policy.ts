import type { CapabilityConfig } from '../domain/types'

export function runtimeWritableToolsEnabled(capabilities: CapabilityConfig): boolean {
    return (
        capabilities.shellCoding ||
        capabilities.documents ||
        capabilities.spreadsheets ||
        capabilities.presentations ||
        capabilities.pdf ||
        capabilities.images
    )
}
