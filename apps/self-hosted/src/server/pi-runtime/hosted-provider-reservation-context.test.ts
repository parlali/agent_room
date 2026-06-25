import { afterEach, describe, expect, it } from 'vitest'
import {
    hostedProviderReservationCollectionFromError,
    installHostedProviderReservationFetchRecorder,
    withHostedProviderReservationCollection,
} from './hosted-provider-reservation-context'

const originalFetch = globalThis.fetch
let cleanupRecorder: (() => void) | null = null

afterEach(() => {
    cleanupRecorder?.()
    cleanupRecorder = null
    globalThis.fetch = originalFetch
})

describe('hosted provider reservation collection', () => {
    it('preserves reservation evidence when a provider prompt rejects with a primitive', async () => {
        let requestHeaders = new Headers()
        globalThis.fetch = (async (input, init) => {
            requestHeaders =
                input instanceof Request
                    ? new Headers(input.headers)
                    : new Headers(init?.headers ?? {})
            return new Response(
                JSON.stringify({
                    usage: {
                        cost: 0.012345,
                    },
                }),
                {
                    headers: {
                        'x-agent-room-billing-reservation-id': 'reservation_1',
                    },
                },
            )
        }) as typeof fetch
        cleanupRecorder = installHostedProviderReservationFetchRecorder()

        let thrown: unknown = null
        try {
            await withHostedProviderReservationCollection(
                async () => {
                    await fetch(
                        'https://rooms.example.test/api/hosted/runtime/provider/openrouter/v1/chat/completions',
                    )
                    await Promise.reject('primitive provider failure')
                },
                {
                    sessionKey: 'thread_1',
                    runId: 'run_1',
                    jobId: 'job_1',
                },
            )
        } catch (error) {
            thrown = error
        }

        expect(requestHeaders.get('x-agent-room-usage-request-id')).toMatch(/^[0-9a-f-]{36}$/i)
        expect(requestHeaders.get('x-agent-room-session-key')).toBe('thread_1')
        expect(requestHeaders.get('x-agent-room-run-id')).toBe('run_1')
        expect(requestHeaders.get('x-agent-room-job-id')).toBe('job_1')
        expect(thrown).toBeInstanceOf(Error)
        expect(thrown).toMatchObject({
            message: 'primitive provider failure',
        })
        expect(hostedProviderReservationCollectionFromError(thrown)).toEqual({
            reservationIds: ['reservation_1'],
            usageCharges: [
                {
                    provider: 'openrouter',
                    reservationId: 'reservation_1',
                    costMicros: 12345,
                },
            ],
        })
    })

    it('adds runtime usage context to Brave proxy requests without collecting OpenRouter charges', async () => {
        let requestHeaders = new Headers()
        globalThis.fetch = (async (input, init) => {
            requestHeaders =
                input instanceof Request
                    ? new Headers(input.headers)
                    : new Headers(init?.headers ?? {})
            return new Response(
                JSON.stringify({
                    web: {
                        results: [],
                    },
                }),
                {
                    headers: {
                        'x-agent-room-billing-reservation-id': 'reservation_brave_1',
                    },
                },
            )
        }) as typeof fetch
        cleanupRecorder = installHostedProviderReservationFetchRecorder()

        const collection = await withHostedProviderReservationCollection(
            async () => {
                await fetch(
                    'https://rooms.example.test/api/hosted/runtime/provider/brave/v1/workspaces/workspace_1/rooms/room_1/res/v1/web/search?q=test',
                )
            },
            {
                sessionKey: 'thread_1',
                runId: 'run_1',
                jobId: 'job_1',
            },
        )

        expect(requestHeaders.get('x-agent-room-usage-request-id')).toMatch(/^[0-9a-f-]{36}$/i)
        expect(requestHeaders.get('x-agent-room-session-key')).toBe('thread_1')
        expect(requestHeaders.get('x-agent-room-run-id')).toBe('run_1')
        expect(requestHeaders.get('x-agent-room-job-id')).toBe('job_1')
        expect(collection.reservationIds).toEqual(['reservation_brave_1'])
        expect(collection.usageCharges).toEqual([])
    })
})
