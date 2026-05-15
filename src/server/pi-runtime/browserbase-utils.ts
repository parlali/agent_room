export function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null
}

export function browserErrorMessage(
    error: unknown,
    sensitiveValues: Array<string | null | undefined> = [],
): string {
    const message = error instanceof Error ? error.message : 'Unknown browser automation error'
    return redactBrowserbaseSensitiveText(message, sensitiveValues)
}

export function redactBrowserbaseSensitiveText(
    value: string,
    sensitiveValues: Array<string | null | undefined> = [],
): string {
    let redacted = value
    for (const sensitive of sensitiveValues) {
        if (sensitive) {
            redacted = redacted.split(sensitive).join('[redacted Browserbase connection URL]')
        }
    }
    return redacted
        .replace(/\bwss?:\/\/[^\s"'<>)]*/gi, '[redacted WebSocket URL]')
        .replace(/\bhttps?:\/\/[^\s"'<>)]*browserbase[^\s"'<>)]*/gi, '[redacted Browserbase URL]')
}

export async function delay(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
        throw new Error('Browser action was cancelled')
    }
    await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
            cleanup()
            resolve()
        }, ms)
        timeout.unref?.()
        signal?.addEventListener('abort', abort, { once: true })

        function cleanup() {
            clearTimeout(timeout)
            signal?.removeEventListener('abort', abort)
        }

        function abort() {
            cleanup()
            reject(new Error('Browser action was cancelled'))
        }
    })
}
