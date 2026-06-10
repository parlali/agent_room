import { describe, expect, it } from 'vitest'

import { resolveHttpByteRange } from './byte-range'

describe('HTTP byte range parsing', () => {
    it('returns none when no range header is present', () => {
        expect(resolveHttpByteRange(null, 100)).toEqual({ kind: 'none' })
    })

    it('resolves explicit open-ended ranges', () => {
        expect(resolveHttpByteRange('bytes=10-', 100)).toEqual({
            kind: 'satisfiable',
            range: {
                start: 10,
                end: 99,
                contentLength: 90,
            },
        })
    })

    it('resolves explicit bounded ranges', () => {
        expect(resolveHttpByteRange('bytes=10-19', 100)).toEqual({
            kind: 'satisfiable',
            range: {
                start: 10,
                end: 19,
                contentLength: 10,
            },
        })
    })

    it('clamps ranges that run beyond the file length', () => {
        expect(resolveHttpByteRange('bytes=90-200', 100)).toEqual({
            kind: 'satisfiable',
            range: {
                start: 90,
                end: 99,
                contentLength: 10,
            },
        })
    })

    it('resolves suffix ranges', () => {
        expect(resolveHttpByteRange('bytes=-12', 100)).toEqual({
            kind: 'satisfiable',
            range: {
                start: 88,
                end: 99,
                contentLength: 12,
            },
        })
    })

    it('rejects unsupported and unsatisfiable ranges', () => {
        expect(resolveHttpByteRange('items=0-10', 100)).toEqual({ kind: 'unsatisfiable' })
        expect(resolveHttpByteRange('bytes=100-120', 100)).toEqual({ kind: 'unsatisfiable' })
        expect(resolveHttpByteRange('bytes=10-1', 100)).toEqual({ kind: 'unsatisfiable' })
        expect(resolveHttpByteRange('bytes=0-1,4-5', 100)).toEqual({ kind: 'unsatisfiable' })
        expect(resolveHttpByteRange('bytes=-0', 100)).toEqual({ kind: 'unsatisfiable' })
        expect(resolveHttpByteRange('bytes=0-', 0)).toEqual({ kind: 'unsatisfiable' })
    })
})
