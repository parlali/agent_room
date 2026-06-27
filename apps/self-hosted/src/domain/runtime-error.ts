const GENERIC_RUNTIME_ERROR = 'Something went wrong. Try again in a moment.'

const JARGON_PATTERN = /runtime|endpoint|pi runtime|uuid|[0-9a-f]{8}-[0-9a-f]{4}/i

const MAX_SAFE_LENGTH = 200

export function sanitizeRuntimeError(message: string | null | undefined): string {
    const text = typeof message === 'string' ? message.trim() : ''
    if (!text) return GENERIC_RUNTIME_ERROR
    if (JARGON_PATTERN.test(text)) return GENERIC_RUNTIME_ERROR
    if (text.length > MAX_SAFE_LENGTH) return GENERIC_RUNTIME_ERROR
    return text
}
