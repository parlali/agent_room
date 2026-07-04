import type { AgentRoomHostedEnv } from '#/server/cloudflare/bindings'
import type { ExecutionContext } from '@cloudflare/workers-types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from './worker'

const mocks = vi.hoisted(() => ({
    hostedRuntimeWorkerRoute: vi.fn(),
}))

vi.mock('cloudflare:workers', () => ({
    DurableObject: class {},
}))

vi.mock('@cloudflare/containers', () => ({
    Container: class {},
    ContainerProxy: class {},
}))

vi.mock('#/server/cloudflare/hosted-worker-runtime-routes', () => ({
    hostedRuntimeWorkerRoute: mocks.hostedRuntimeWorkerRoute,
}))

describe('hosted worker runtime callback dispatch', () => {
    afterEach(() => {
        vi.clearAllMocks()
    })

    it('returns a coded 500 and logs when the runtime callback route throws', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        mocks.hostedRuntimeWorkerRoute.mockRejectedValue(new Error('token store exploded'))

        try {
            const response = await worker.fetch(
                new Request('https://rooms.example.test/api/hosted/runtime/state', {
                    method: 'POST',
                    body: '{}',
                }),
                {} as AgentRoomHostedEnv,
                {
                    waitUntil: () => {},
                    passThroughOnException: () => {},
                } as unknown as ExecutionContext,
            )

            expect(response.status).toBe(500)
            await expect(response.json()).resolves.toMatchObject({
                ok: false,
                code: 'runtime_callback_internal_error',
            })
            expect(errorSpy).toHaveBeenCalledWith(
                'Hosted runtime callback route dispatch failed',
                expect.objectContaining({
                    path: '/api/hosted/runtime/state',
                    method: 'POST',
                }),
            )
        } finally {
            errorSpy.mockRestore()
        }
    })
})
