import { describe, expect, it } from 'vitest'
import { sanitizeRuntimeError } from './runtime-error'

describe('sanitizeRuntimeError', () => {
    it('passes through the user-facing room limit and subscription messages', () => {
        const roomLimit =
            'Room limit reached (3 rooms running). Pause a room to create or start another one.'
        expect(sanitizeRuntimeError(roomLimit)).toBe(roomLimit)

        const subscription =
            'An active subscription is required to run rooms. Update billing to continue.'
        expect(sanitizeRuntimeError(subscription)).toBe(subscription)
    })

    it('passes through the duplicate room name message', () => {
        const duplicate = 'A room named "my-room" already exists. Choose a different name.'
        expect(sanitizeRuntimeError(duplicate)).toBe(duplicate)
    })

    it('still masks provider and infrastructure jargon', () => {
        expect(sanitizeRuntimeError('Hosted runtime access denied')).toBe(
            'Something went wrong. Try again in a moment.',
        )
        expect(sanitizeRuntimeError('endpoint 10.0.0.1 unreachable')).toBe(
            'Something went wrong. Try again in a moment.',
        )
        expect(sanitizeRuntimeError('x'.repeat(300))).toBe(
            'Something went wrong. Try again in a moment.',
        )
        expect(sanitizeRuntimeError(null)).toBe('Something went wrong. Try again in a moment.')
    })
})
