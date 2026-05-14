import { describe, expect, it } from 'vitest'
import { createSessionEventQueue } from './session-event-queue'

describe('session event queue', () => {
    it('handles enqueued events in order even when earlier work is slower', async () => {
        const handled: string[] = []
        let firstStarted!: () => void
        let releaseFirst!: () => void
        const firstStartedPromise = new Promise<void>((resolve) => {
            firstStarted = resolve
        })
        const firstReleasePromise = new Promise<void>((resolve) => {
            releaseFirst = resolve
        })
        const queue = createSessionEventQueue<string>({
            handle: async (event) => {
                handled.push(`start:${event}`)
                if (event === 'first') {
                    firstStarted()
                    await firstReleasePromise
                }
                handled.push(`end:${event}`)
            },
            onError: () => {},
        })

        queue.enqueue('first')
        await firstStartedPromise
        queue.enqueue('second')
        await Promise.resolve()

        expect(handled).toEqual(['start:first'])

        releaseFirst()
        await queue.idle()

        expect(handled).toEqual(['start:first', 'end:first', 'start:second', 'end:second'])
    })

    it('reports a failed event and continues with the next event', async () => {
        const handled: string[] = []
        const errors: string[] = []
        const queue = createSessionEventQueue<string>({
            handle: async (event) => {
                handled.push(event)
                if (event === 'first') {
                    throw new Error('boom')
                }
            },
            onError: (error, event) => {
                errors.push(`${event}:${error instanceof Error ? error.message : 'unknown'}`)
            },
        })

        queue.enqueue('first')
        queue.enqueue('second')
        await queue.idle()

        expect(handled).toEqual(['first', 'second'])
        expect(errors).toEqual(['first:boom'])
    })
})
