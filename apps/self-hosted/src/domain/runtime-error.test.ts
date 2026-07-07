import { describe, expect, it } from 'vitest'
import { isThreadNotFoundError, sanitizeRuntimeError } from './runtime-error'

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

    it('passes through the hosted credential refresh restart message', () => {
        const message = 'Room access was refreshed. The room is restarting.'
        expect(sanitizeRuntimeError(message)).toBe(message)
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

describe('isThreadNotFoundError', () => {
    it('detects the runtime thread-not-found error from an Error instance', () => {
        expect(isThreadNotFoundError(new Error('Thread main does not exist'))).toBe(true)
        expect(isThreadNotFoundError(new Error('Thread 4f1c2a3b-9d0e does not exist'))).toBe(true)
    })

    it('detects the message when passed as a raw string', () => {
        expect(isThreadNotFoundError('Thread nightly-report does not exist')).toBe(true)
    })

    it('does not match unrelated runtime errors', () => {
        expect(isThreadNotFoundError(new Error('Room room_1 does not exist'))).toBe(false)
        expect(isThreadNotFoundError(new Error('Pi runtime request failed with status 500'))).toBe(
            false,
        )
        expect(isThreadNotFoundError(null)).toBe(false)
        expect(isThreadNotFoundError(undefined)).toBe(false)
    })
})
