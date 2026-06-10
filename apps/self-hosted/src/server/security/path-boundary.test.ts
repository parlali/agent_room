import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertPathInsideRoot } from './path-boundary'

describe('path boundary checks', () => {
    it('returns normalized paths inside the root', () => {
        const root = resolve('/tmp/agent-room-root')
        const child = join(root, 'workspace', 'file.txt')

        expect(assertPathInsideRoot(child, root, 'escaped')).toBe(child)
        expect(assertPathInsideRoot(root, root, 'escaped')).toBe(root)
    })

    it('rejects paths outside the root with caller-owned messages', () => {
        const root = resolve('/tmp/agent-room-root')
        const outside = resolve(root, '..', 'outside.txt')

        expect(() => assertPathInsideRoot(outside, root, 'fixed message')).toThrow('fixed message')
        expect(() => assertPathInsideRoot(outside, root, (path) => `escaped ${path}`)).toThrow(
            `escaped ${outside}`,
        )
    })
})
