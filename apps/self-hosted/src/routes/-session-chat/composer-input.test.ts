import { describe, expect, it } from 'vitest'
import { shouldSendOnEnter } from './composer-input'

describe('shouldSendOnEnter', () => {
    it('sends on a plain Enter press', () => {
        expect(shouldSendOnEnter({ key: 'Enter', shiftKey: false, isComposing: false })).toBe(true)
    })

    it('inserts a newline on Shift+Enter', () => {
        expect(shouldSendOnEnter({ key: 'Enter', shiftKey: true, isComposing: false })).toBe(false)
    })

    it('does not send while an IME composition is active', () => {
        expect(shouldSendOnEnter({ key: 'Enter', shiftKey: false, isComposing: true })).toBe(false)
    })

    it('ignores other keys', () => {
        expect(shouldSendOnEnter({ key: 'a', shiftKey: false, isComposing: false })).toBe(false)
    })
})
