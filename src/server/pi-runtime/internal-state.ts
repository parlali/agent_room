import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
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
    const text =
        snapshot.brief.length <= internalStatePolicy.maxInjectedBytes
            ? snapshot.brief
            : `${snapshot.brief.slice(0, internalStatePolicy.maxInjectedBytes)}\n[truncated]`
    return {
        text,
        byteLength: Buffer.byteLength(snapshot.brief),
        maxBytes: internalStatePolicy.maxInjectedBytes,
        truncated: snapshot.brief.length > internalStatePolicy.maxInjectedBytes,
    }
}
