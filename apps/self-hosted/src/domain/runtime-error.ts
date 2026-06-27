const GENERIC_NOT_READY = 'This room is not ready yet. Finish setup and try again.'

const JARGON_PATTERN = /runtime|endpoint|pi runtime|uuid|[0-9a-f]{8}-[0-9a-f]{4}/i

const MAX_SAFE_LENGTH = 200

export function sanitizeRuntimeError(message: string | null | undefined): string {
    const text = typeof message === 'string' ? message.trim() : ''
    if (!text) return GENERIC_NOT_READY
    if (JARGON_PATTERN.test(text)) return GENERIC_NOT_READY
    if (text.length > MAX_SAFE_LENGTH) return GENERIC_NOT_READY
    return text
}
