const hostedRuntimeCallbackMaxAttempts = 4
const hostedRuntimeCallbackBaseDelayMs = 200
const hostedRuntimeCallbackTimeoutMs = 10000
const hostedRuntimeThrottleFallbackMessage =
    'This room is temporarily rate limited. It will recover shortly.'

async function hostedRuntimeThrottleMessage(response: Response): Promise<string> {
    try {
        const body = (await response.json()) as unknown
        if (body && typeof body === 'object' && !Array.isArray(body)) {
            const message = (body as Record<string, unknown>).message
            if (typeof message === 'string' && message.trim()) {
                return message.trim()
            }
        }
    } catch {
        return hostedRuntimeThrottleFallbackMessage
    }
    return hostedRuntimeThrottleFallbackMessage
}

export async function postHostedRuntimeCallback(input: {
    url: string
    token: string
    label: string
    body: unknown
}): Promise<void> {
    const body = JSON.stringify(input.body)
    for (let attempt = 1; attempt <= hostedRuntimeCallbackMaxAttempts; attempt += 1) {
        let response: Response
        try {
            response = await fetch(input.url, {
                method: 'POST',
                headers: {
                    authorization: `Bearer ${input.token}`,
                    'content-type': 'application/json',
                },
                body,
                signal: AbortSignal.timeout(hostedRuntimeCallbackTimeoutMs),
            })
        } catch (error) {
            console.warn(
                `${input.label} callback attempt ${attempt}/${hostedRuntimeCallbackMaxAttempts} failed`,
                error instanceof Error ? error.message : error,
            )
            if (attempt === hostedRuntimeCallbackMaxAttempts) {
                throw error instanceof Error ? error : new Error(`${input.label} callback failed`)
            }
            await new Promise<void>((done) => {
                setTimeout(done, hostedRuntimeCallbackBaseDelayMs * 2 ** (attempt - 1)).unref()
            })
            continue
        }
        if (response.ok) {
            return
        }
        if (response.status === 429) {
            const message = await hostedRuntimeThrottleMessage(response)
            console.warn(
                `${input.label} callback throttled with status 429; deferring to the next sync cycle`,
            )
            throw new Error(message)
        }
        const retryable = response.status >= 500
        console.warn(
            `${input.label} callback attempt ${attempt}/${hostedRuntimeCallbackMaxAttempts} failed with status ${response.status}`,
        )
        if (!retryable || attempt === hostedRuntimeCallbackMaxAttempts) {
            throw new Error(`${input.label} callback failed with status ${response.status}`)
        }
        await new Promise<void>((done) => {
            setTimeout(done, hostedRuntimeCallbackBaseDelayMs * 2 ** (attempt - 1)).unref()
        })
    }
}
