import {
    createAssistantMessageEventStream,
    type AssistantMessage,
    type AssistantMessageEvent,
    type AssistantMessageEventStream,
    type Usage,
} from '@mariozechner/pi-ai'

const zeroUsage: Usage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
    },
}

export const providerStreamStalledMessage =
    'The model provider stopped sending output before the response finished.'
export const providerStreamTruncatedMessage =
    'The model provider closed the response stream before it finished.'

interface GuardModelIdentity {
    api: string
    provider: string
    id: string
}

export interface GuardProviderStreamInput {
    source: AssistantMessageEventStream
    idleTimeoutMs: number
    model: GuardModelIdentity
    onStall?: () => void
}

function isTerminalEvent(event: AssistantMessageEvent): boolean {
    return event.type === 'done' || event.type === 'error'
}

function partialFromEvent(event: AssistantMessageEvent): AssistantMessage | null {
    if (event.type === 'done' || event.type === 'error') {
        return null
    }
    return event.partial ?? null
}

function syntheticErrorMessage(
    model: GuardModelIdentity,
    latestPartial: AssistantMessage | null,
    message: string,
): AssistantMessage {
    const base: AssistantMessage = latestPartial
        ? { ...latestPartial }
        : {
              role: 'assistant',
              content: [{ type: 'text', text: '' }],
              api: model.api,
              provider: model.provider,
              model: model.id,
              usage: zeroUsage,
              stopReason: 'error',
              errorMessage: message,
              timestamp: Date.now(),
          }
    base.stopReason = 'error'
    base.errorMessage = message
    return base
}

export function guardProviderStream(input: GuardProviderStreamInput): AssistantMessageEventStream {
    const guarded = createAssistantMessageEventStream()
    let latestPartial: AssistantMessage | null = null
    let settled = false

    const settleWithError = (message: string) => {
        if (settled) {
            return
        }
        settled = true
        guarded.push({
            type: 'error',
            reason: 'error',
            error: syntheticErrorMessage(input.model, latestPartial, message),
        })
        guarded.end()
    }

    const forward = (event: AssistantMessageEvent) => {
        if (settled) {
            return
        }
        const partial = partialFromEvent(event)
        if (partial) {
            latestPartial = partial
        }
        guarded.push(event)
        if (isTerminalEvent(event)) {
            settled = true
            guarded.end()
        }
    }

    void (async () => {
        const iterator = input.source[Symbol.asyncIterator]()
        try {
            for (;;) {
                let idleTimer: ReturnType<typeof setTimeout> | null = null
                const idleSignal = new Promise<'idle'>((resolve) => {
                    idleTimer = setTimeout(() => resolve('idle'), input.idleTimeoutMs)
                    idleTimer.unref?.()
                })
                let outcome: IteratorResult<AssistantMessageEvent> | 'idle'
                try {
                    outcome = await Promise.race([iterator.next(), idleSignal])
                } finally {
                    if (idleTimer) {
                        clearTimeout(idleTimer)
                    }
                }
                if (outcome === 'idle') {
                    input.onStall?.()
                    settleWithError(providerStreamStalledMessage)
                    return
                }
                if (outcome.done) {
                    settleWithError(providerStreamTruncatedMessage)
                    return
                }
                forward(outcome.value)
                if (settled) {
                    return
                }
            }
        } catch (error) {
            settleWithError(error instanceof Error ? error.message : String(error))
        }
    })()

    return guarded
}
