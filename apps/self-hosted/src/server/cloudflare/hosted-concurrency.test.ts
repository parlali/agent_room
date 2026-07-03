import { describe, expect, it } from 'vitest'
import { mapWithConcurrency } from './hosted-concurrency'

describe('mapWithConcurrency', () => {
    it('preserves input order in the results', async () => {
        const items = [30, 5, 20, 1, 10]
        const results = await mapWithConcurrency(items, 3, async (item) => {
            await new Promise((resolve) => setTimeout(resolve, item))
            return item * 2
        })
        expect(results).toEqual([60, 10, 40, 2, 20])
    })

    it('never exceeds the concurrency limit', async () => {
        let active = 0
        let peak = 0
        await mapWithConcurrency(
            Array.from({ length: 20 }, (_, i) => i),
            4,
            async () => {
                active += 1
                peak = Math.max(peak, active)
                await new Promise((resolve) => setTimeout(resolve, 5))
                active -= 1
            },
        )
        expect(peak).toBeLessThanOrEqual(4)
        expect(peak).toBeGreaterThan(1)
    })

    it('rejects on the first task failure and stops scheduling new tasks', async () => {
        const started: number[] = []
        await expect(
            mapWithConcurrency(
                Array.from({ length: 50 }, (_, i) => i),
                2,
                async (item) => {
                    started.push(item)
                    if (item === 3) {
                        throw new Error('task failed')
                    }
                    await new Promise((resolve) => setTimeout(resolve, 1))
                },
            ),
        ).rejects.toThrow('task failed')
        expect(started.length).toBeLessThan(50)
    })

    it('rejects an invalid concurrency limit', async () => {
        await expect(mapWithConcurrency([1], 0, async (item) => item)).rejects.toThrow(
            /positive integer/,
        )
    })
})
