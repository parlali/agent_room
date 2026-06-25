import { describe, expect, it, vi } from 'vitest'
import type { AgentRoomHostedEnv } from './bindings'
import type { HostedRequestContext } from './hosted-request-context'
import { readHostedRequestContext, runWithHostedRequestContext } from './hosted-request-context'

const { getRequestMock } = vi.hoisted(() => ({
    getRequestMock: vi.fn<() => Request>(() => {
        throw new Error('No request')
    }),
}))

vi.mock('@tanstack/react-start/server', () => ({
    getRequest: getRequestMock,
}))

function createHostedContext(request: Request): HostedRequestContext {
    return {
        env: {} as AgentRoomHostedEnv,
        request,
    }
}

describe('hosted request context', () => {
    it('prefers the async local context over the request fallback', () => {
        const activeRequest = new Request('https://app.example.test/login')
        const fallbackRequest = new Request('https://app.example.test/settings')
        const activeContext = createHostedContext(activeRequest)
        const fallbackContext = createHostedContext(fallbackRequest)

        getRequestMock.mockReturnValue(fallbackRequest)

        const result = runWithHostedRequestContext(fallbackContext, () =>
            runWithHostedRequestContext(activeContext, () => readHostedRequestContext()),
        )

        expect(result).toBe(activeContext)
    })

    it('keeps context available by request while an async handler is pending', async () => {
        const request = new Request('https://app.example.test/login')
        const context = createHostedContext(request)
        let resolvePending!: () => void

        getRequestMock.mockReturnValue(request)

        const pending = runWithHostedRequestContext(
            context,
            () =>
                new Promise<void>((resolve) => {
                    resolvePending = resolve
                }),
        )

        expect(readHostedRequestContext()).toBe(context)
        resolvePending()
        await pending
        expect(readHostedRequestContext()).toBeNull()
    })
})
