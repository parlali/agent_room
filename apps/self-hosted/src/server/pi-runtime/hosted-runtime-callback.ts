const hostedRuntimeCallbackMaxAttempts = 4
const hostedRuntimeCallbackBaseDelayMs = 200

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
        const retryable = response.status >= 500 || response.status === 429
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
