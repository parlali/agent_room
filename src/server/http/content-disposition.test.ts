import { describe, expect, it } from 'vitest'
import { contentDispositionHeader } from './content-disposition'

describe('content disposition header', () => {
    it('keeps response headers ASCII-safe while preserving unicode filenames', () => {
        const header = contentDispositionHeader({
            disposition: 'inline',
            filename: 'Screenshot 2026-05-13 at 2.49.05 PM.png',
        })

        expect(header).toBe(
            'inline; filename="Screenshot 2026-05-13 at 2.49.05_PM.png"; filename*=UTF-8\'\'Screenshot%202026-05-13%20at%202.49.05%E2%80%AFPM.png',
        )
        expect([...header].every((char) => char.charCodeAt(0) <= 0x7e)).toBe(true)
    })

    it('strips path separators and control characters from the fallback filename', () => {
        const header = contentDispositionHeader({
            disposition: 'attachment',
            filename: '../bad\r\nname.pdf',
        })

        expect(header).toContain('attachment; filename=".._bad__name.pdf"')
        expect(header).toContain("filename*=UTF-8''..%2Fbad%0D%0Aname.pdf")
    })
})
