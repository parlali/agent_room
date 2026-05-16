import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import { boundTextByChars } from './bounded-text'
import { ensureMemory, readMemory } from './memory'

export interface InternalStateSummary {
    text: string
    byteLength: number
    maxBytes: number
    truncated: boolean
}

export const internalStatePolicy = {
    maxInjectedBytes: 12000,
} as const

export async function ensureInternalState(config: PiRuntimeConfig): Promise<void> {
    await ensureMemory(config)
}

export async function buildInternalStateSummary(
    config: PiRuntimeConfig,
): Promise<InternalStateSummary> {
    await ensureMemory(config)
    const snapshot = await readMemory(config)
    const bounded = boundTextByChars(snapshot.brief, internalStatePolicy.maxInjectedBytes)
    return {
        text: bounded.text,
        byteLength: Buffer.byteLength(snapshot.brief),
        maxBytes: internalStatePolicy.maxInjectedBytes,
        truncated: bounded.truncated,
    }
}
