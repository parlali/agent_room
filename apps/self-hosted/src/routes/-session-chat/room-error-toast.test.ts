import { describe, expect, it } from 'vitest'

import {
    isRecurringRoomErrorClass,
    roomErrorToastId,
    roomRuntimeErrorClass,
} from './room-error-toast'

describe('roomRuntimeErrorClass', () => {
    it('classifies hosted runtime callback failures as runtime regardless of the 5xx status', () => {
        expect(roomRuntimeErrorClass('Hosted runtime state callback failed with status 500')).toBe(
            'runtime',
        )
        expect(roomRuntimeErrorClass('Hosted runtime state callback failed with status 503')).toBe(
            'runtime',
        )
    })

    it('classifies rate limited and credit exhaustion messages as quota', () => {
        expect(roomRuntimeErrorClass('Hosted runtime state callback failed with status 429')).toBe(
            'quota',
        )
        expect(roomRuntimeErrorClass('You have hit the spend cap for this room')).toBe('quota')
        expect(roomRuntimeErrorClass('Too many requests, please retry')).toBe('quota')
    })

    it('treats unknown and disconnect messages as transient', () => {
        expect(roomRuntimeErrorClass('Message could not be sent')).toBe('transient')
        expect(roomRuntimeErrorClass('Lost live updates for this room. Refresh to retry.')).toBe(
            'transient',
        )
        expect(roomRuntimeErrorClass(null)).toBe('transient')
        expect(roomRuntimeErrorClass(undefined)).toBe('transient')
    })
})

describe('isRecurringRoomErrorClass', () => {
    it('marks runtime and quota conditions as recurring room conditions', () => {
        expect(isRecurringRoomErrorClass('runtime')).toBe(true)
        expect(isRecurringRoomErrorClass('quota')).toBe(true)
        expect(isRecurringRoomErrorClass('transient')).toBe(false)
    })
})

describe('roomErrorToastId', () => {
    it('derives a stable id per room and error class so repeats replace instead of stacking', () => {
        expect(roomErrorToastId('room-1', 'runtime')).toBe('room-error:runtime:room-1')
        expect(roomErrorToastId('room-1', 'runtime')).toBe(roomErrorToastId('room-1', 'runtime'))
    })

    it('keeps 429 and 500 runtime failures on the same id so a fluctuating status does not restack', () => {
        const first = roomErrorToastId(
            'room-1',
            roomRuntimeErrorClass('Hosted runtime state callback failed with status 500'),
        )
        const second = roomErrorToastId(
            'room-1',
            roomRuntimeErrorClass('Hosted runtime state callback failed with status 503'),
        )
        expect(first).toBe(second)
    })

    it('scopes ids by room so one room error cannot target another room toast', () => {
        expect(roomErrorToastId('room-1', 'runtime')).not.toBe(
            roomErrorToastId('room-2', 'runtime'),
        )
    })
})
