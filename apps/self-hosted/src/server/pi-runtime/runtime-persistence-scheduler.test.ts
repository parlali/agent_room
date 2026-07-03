import { describe, expect, it } from 'vitest'
import { createDebouncedPersister } from './runtime-persistence-scheduler'

function deferred<T = void>(): {
    promise: Promise<T>
    resolve: (value: T) => void
    reject: (error: unknown) => void
} {
    let resolve!: (value: T) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}

function delay(ms: number): Promise<void> {
    return new Promise((done) => {
        setTimeout(done, ms)
    })
}

describe('createDebouncedPersister', () => {
    it('coalesces many scheduled calls into a single trailing persist', async () => {
        let persistCount = 0
        const persister = createDebouncedPersister({
            intervalMs: 20,
            persist: async () => {
                persistCount += 1
            },
            onError: () => {},
        })

        for (let index = 0; index < 25; index += 1) {
            persister.schedule()
        }
        expect(persistCount).toBe(0)

        await delay(60)
        expect(persistCount).toBe(1)
    })

    it('lets delta broadcasts proceed without awaiting a slow persist', async () => {
        const release = deferred()
        let persistStarted = 0
        const broadcasts: number[] = []
        const persister = createDebouncedPersister({
            intervalMs: 5,
            persist: async () => {
                persistStarted += 1
                await release.promise
            },
            onError: () => {},
        })

        for (let index = 0; index < 10; index += 1) {
            persister.schedule()
            broadcasts.push(index)
        }

        expect(broadcasts).toHaveLength(10)
        expect(persistStarted).toBe(0)

        await delay(20)
        expect(persistStarted).toBe(1)
        release.resolve()
        await persister.flush()
    })

    it('flush forces an immediate persist and resolves after it completes', async () => {
        const order: string[] = []
        const persister = createDebouncedPersister({
            intervalMs: 10_000,
            persist: async () => {
                order.push('persist')
            },
            onError: () => {},
        })

        persister.schedule()
        await persister.flush()
        order.push('flush-resolved')

        expect(order).toEqual(['persist', 'flush-resolved'])
    })

    it('flush waits for an in-flight persist and then persists the latest state', async () => {
        const first = deferred()
        const events: string[] = []
        let state = 'a'
        const persisted: string[] = []
        const persister = createDebouncedPersister({
            intervalMs: 5,
            persist: async () => {
                const captured = state
                events.push(`start:${captured}`)
                if (captured === 'a') {
                    await first.promise
                }
                persisted.push(captured)
                events.push(`end:${captured}`)
            },
            onError: () => {},
        })

        persister.schedule()
        await delay(15)
        expect(events).toEqual(['start:a'])

        state = 'b'
        const flushed = persister.flush()
        first.resolve()
        await flushed

        expect(events).toEqual(['start:a', 'end:a', 'start:b', 'end:b'])
        expect(persisted).toEqual(['a', 'b'])
    })

    it('reports background persist failures to onError without throwing', async () => {
        const errors: unknown[] = []
        let attempts = 0
        const persister = createDebouncedPersister({
            intervalMs: 10,
            persist: async () => {
                attempts += 1
                throw new Error('sync round-trip failed')
            },
            onError: (error) => {
                errors.push(error)
            },
        })

        persister.schedule()
        await delay(40)
        expect(attempts).toBe(1)
        expect(errors).toHaveLength(1)

        await expect(persister.flush()).rejects.toThrow('sync round-trip failed')
        expect(attempts).toBe(2)
    })

    it('flush surfaces persist errors so terminal events can fail closed', async () => {
        const persister = createDebouncedPersister({
            intervalMs: 1000,
            persist: async () => {
                throw new Error('terminal persist failed')
            },
            onError: () => {},
        })

        await expect(persister.flush()).rejects.toThrow('terminal persist failed')
    })

    it('shutdown flushes pending scheduled state and ignores later schedules', async () => {
        let persistCount = 0
        const persister = createDebouncedPersister({
            intervalMs: 10_000,
            persist: async () => {
                persistCount += 1
            },
            onError: () => {},
        })

        persister.schedule()
        await persister.shutdown()
        expect(persistCount).toBe(1)

        persister.schedule()
        await delay(20)
        expect(persistCount).toBe(1)
    })
})
