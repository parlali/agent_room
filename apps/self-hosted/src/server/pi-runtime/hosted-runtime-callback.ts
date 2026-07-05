const hostedRuntimeCallbackMaxAttempts = 4
const hostedRuntimeCallbackBaseDelayMs = 200
const hostedRuntimeCallbackTimeoutMs = 10000
const hostedRuntimeThrottleFallbackMessage =
    'This room is temporarily rate limited. It will recover shortly.'

async function hostedRuntimeJsonStringField(
    response: Response,
    fieldName: string,
): Promise<string | null> {
    try {
        const body = (await response.json()) as unknown
        if (body && typeof body === 'object' && !Array.isArray(body)) {
            const value = (body as Record<string, unknown>)[fieldName]
            if (typeof value === 'string' && value.trim()) {
                return value.trim()
            }
        }
    } catch {
        return null
    }
    return null
}

async function hostedRuntimeThrottleMessage(response: Response): Promise<string> {
    return (
        (await hostedRuntimeJsonStringField(response, 'message')) ??
        hostedRuntimeThrottleFallbackMessage
    )
}

async function hostedRuntimeCallbackCode(response: Response): Promise<string | null> {
    return hostedRuntimeJsonStringField(response, 'code')
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
        if (response.status === 403) {
            const code = await hostedRuntimeCallbackCode(response)
            if (code === 'runtime_token_stale') {
                console.error(
                    `${input.label} callback rejected because runtime credentials rotated; this container generation is terminal`,
                )
                throw new Error(
                    `${input.label} callback rejected because runtime credentials rotated`,
                )
            }
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
