import type { D1Result } from '@cloudflare/workers-types'

export function assertChanged(result: D1Result<unknown>, message: string): void {
    if (!result.meta || result.meta.changes < 1) {
        throw new Error(message)
    }
}
