import { describe, expect, it } from 'vitest'
import { createAssistantMessageEventStream, type AssistantMessage } from '@mariozechner/pi-ai'
import {
    guardProviderStream,
    providerStreamStalledMessage,
    providerStreamTruncatedMessage,
} from './provider-stream-guard'

const model = {
    api: 'openai-completions',
    provider: 'openrouter',
    id: 'test-model',
}

function assistantMessage(overrides: Partial<AssistantMessage>): AssistantMessage {
    return {
        role: 'assistant',
        content: [{ type: 'text', text: 'hello' }],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: Date.now(),
        ...overrides,
    } as AssistantMessage
}

async function drain(stream: ReturnType<typeof guardProviderStream>): Promise<string[]> {
    const types: string[] = []
    for await (const event of stream) {
        types.push(event.type)
    }
    return types
}

describe('guardProviderStream', () => {
    it('forwards a normal completion untouched', async () => {
        const source = createAssistantMessageEventStream()
        const done = assistantMessage({ stopReason: 'stop' })
        const guarded = guardProviderStream({ source, idleTimeoutMs: 1000, model })
        source.push({ type: 'start', partial: done })
        source.push({ type: 'done', reason: 'stop', message: done })
        const types = await drain(guarded)
        expect(types).toEqual(['start', 'done'])
        await expect(guarded.result()).resolves.toMatchObject({ stopReason: 'stop' })
    })

    it('surfaces an error when the provider stream ends without a completion event', async () => {
        const source = createAssistantMessageEventStream()
        const guarded = guardProviderStream({ source, idleTimeoutMs: 1000, model })
        source.push({ type: 'start', partial: assistantMessage({}) })
        source.end()
        const types = await drain(guarded)
        expect(types).toEqual(['start', 'error'])
        const result = await guarded.result()
        expect(result.stopReason).toBe('error')
        expect(result.errorMessage).toBe(providerStreamTruncatedMessage)
    })

    it('terminates and aborts when the provider stream stalls', async () => {
        const source = createAssistantMessageEventStream()
        let stalled = false
        const guarded = guardProviderStream({
            source,
            idleTimeoutMs: 20,
            model,
            onStall: () => {
                stalled = true
            },
        })
        source.push({ type: 'start', partial: assistantMessage({}) })
        const types = await drain(guarded)
        expect(types).toEqual(['start', 'error'])
        expect(stalled).toBe(true)
        const result = await guarded.result()
        expect(result.stopReason).toBe('error')
        expect(result.errorMessage).toBe(providerStreamStalledMessage)
    })

    it('surfaces a thrown provider error as a terminal error event', async () => {
        const source = createAssistantMessageEventStream()
        const originalIterator = source[Symbol.asyncIterator].bind(source)
        source[Symbol.asyncIterator] = async function* () {
            yield { type: 'start', partial: assistantMessage({}) } as never
            throw new Error('socket hang up')
        } as never
        const guarded = guardProviderStream({ source, idleTimeoutMs: 1000, model })
        const types = await drain(guarded)
        void originalIterator
        expect(types).toEqual(['start', 'error'])
        const result = await guarded.result()
        expect(result.errorMessage).toBe('socket hang up')
    })
})
