import { describe, expect, it } from 'vitest'
import { friendlyNotice } from './-notice-copy'

describe('friendly notice copy', () => {
    it('hides runtime endpoint wording from room notices', () => {
        expect(
            friendlyNotice(
                'Room 24aad039-d537-469e-919e-30230a63d5a0 has no active runtime endpoint',
            ),
        ).toBe('Room is paused. Resume it before starting or continuing sessions.')
    })

    it('hides diagnostics filesystem paths from operator-facing startup errors', () => {
        expect(
            friendlyNotice(
                'Room startup failed: model key missing. Diagnostic files preserved at /tmp/openclaw/room-1.',
            ),
        ).toBe(
            'Room startup failed: model key missing. Diagnostic files were preserved for support review.',
        )
    })
})
