import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchPublicTextUrl } from './web-fetch-core'

describe('fetchPublicTextUrl', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    it('removes the forwarded abort listener after fetch completion', async () => {
        const abortController = new AbortController()
        const addListener = vi.spyOn(abortController.signal, 'addEventListener')
        const removeListener = vi.spyOn(abortController.signal, 'removeEventListener')
        const fetchMock = vi.fn(async () => {
            return new Response('hello', {
                headers: {
                    'content-type': 'text/plain',
                },
            })
        })
        vi.stubGlobal('fetch', fetchMock)

        await expect(
            fetchPublicTextUrl({
                url: 'https://example.test/page',
                timeoutMs: 1000,
                signal: abortController.signal,
                assertSafeUrl: async () => {},
            }),
        ).resolves.toMatchObject({
            text: 'hello',
            truncated: false,
        })

        const abortListener = addListener.mock.calls[0]?.[1]
        expect(addListener).toHaveBeenCalledWith('abort', expect.any(Function), { once: true })
        expect(removeListener).toHaveBeenCalledWith('abort', abortListener)
    })

    it('passes an aborted fetch signal when the input signal is already aborted', async () => {
        const abortController = new AbortController()
        abortController.abort()
        const fetchMock = vi.fn(async (_url: URL, init?: RequestInit) => {
            if (init?.signal?.aborted) {
                throw new DOMException('This operation was aborted', 'AbortError')
            }
            return new Response('unexpected')
        })
        vi.stubGlobal('fetch', fetchMock)

        await expect(
            fetchPublicTextUrl({
                url: 'https://example.test/page',
                timeoutMs: 1000,
                signal: abortController.signal,
                assertSafeUrl: async () => {},
            }),
        ).rejects.toThrow('This operation was aborted')

        expect(fetchMock).toHaveBeenCalled()
    })
})
