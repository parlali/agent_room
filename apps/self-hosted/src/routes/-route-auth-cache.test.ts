import { describe, expect, it } from 'vitest'
import { createRouteAuthCache } from './-route-auth-cache'

interface Snapshot {
    user: { userId: string } | null
}

function snapshotCache(input: {
    results: Array<Snapshot | Error>
    ttlMs?: number
    now?: () => number
}) {
    let calls = 0
    const cache = createRouteAuthCache<Snapshot>({
        fetchSnapshot: () => {
            const result = input.results[Math.min(calls, input.results.length - 1)]
            calls += 1
            if (result instanceof Error) {
                return Promise.reject(result)
            }
            if (!result) {
                return Promise.reject(new Error('no result configured'))
            }
            return Promise.resolve(result)
        },
        hasUser: (snapshot) => snapshot.user !== null,
        ttlMs: input.ttlMs ?? 30_000,
        now: input.now,
    })
    return {
        cache,
        callCount: () => calls,
    }
}

const authedSnapshot: Snapshot = {
    user: { userId: 'user-1' },
}

const anonymousSnapshot: Snapshot = {
    user: null,
}

describe('createRouteAuthCache', () => {
    it('reuses one fetch for repeated reads inside the ttl', async () => {
        const { cache, callCount } = snapshotCache({ results: [authedSnapshot] })
        const [first, second] = await Promise.all([cache.read(), cache.read()])
        const third = await cache.read()
        expect(first).toBe(authedSnapshot)
        expect(second).toBe(authedSnapshot)
        expect(third).toBe(authedSnapshot)
        expect(callCount()).toBe(1)
    })

    it('refetches after the ttl expires', async () => {
        let currentTime = 0
        const { cache, callCount } = snapshotCache({
            results: [authedSnapshot],
            ttlMs: 30_000,
            now: () => currentTime,
        })
        await cache.read()
        currentTime = 29_999
        await cache.read()
        expect(callCount()).toBe(1)
        currentTime = 30_000
        await cache.read()
        expect(callCount()).toBe(2)
    })

    it('does not retain snapshots without a user', async () => {
        const { cache, callCount } = snapshotCache({
            results: [anonymousSnapshot, authedSnapshot],
        })
        const first = await cache.read()
        expect(first.user).toBeNull()
        const second = await cache.read()
        expect(second.user).not.toBeNull()
        expect(callCount()).toBe(2)
    })

    it('does not retain failed fetches', async () => {
        const { cache, callCount } = snapshotCache({
            results: [new Error('network down'), authedSnapshot],
        })
        await expect(cache.read()).rejects.toThrow('network down')
        const second = await cache.read()
        expect(second).toBe(authedSnapshot)
        expect(callCount()).toBe(2)
    })

    it('clear forces the next read to refetch', async () => {
        const { cache, callCount } = snapshotCache({
            results: [authedSnapshot, anonymousSnapshot],
        })
        await cache.read()
        cache.clear()
        const second = await cache.read()
        expect(second.user).toBeNull()
        expect(callCount()).toBe(2)
    })
})
