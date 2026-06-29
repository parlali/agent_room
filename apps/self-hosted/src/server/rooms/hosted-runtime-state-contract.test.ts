import { describe, expect, test } from 'vitest'
import { normalizeHostedRuntimeStateRelativePath } from './hosted-runtime-state-contract'
import {
    roomViewThreadRelativePath,
    roomViewThreadsRelativePath,
} from './room-view-readmodel-contract'

describe('hosted runtime state path allowlist', () => {
    test('allows the room view read-model paths', () => {
        expect(normalizeHostedRuntimeStateRelativePath(roomViewThreadsRelativePath)).toBe(
            roomViewThreadsRelativePath,
        )
        const threadPath = roomViewThreadRelativePath('main')
        expect(normalizeHostedRuntimeStateRelativePath(threadPath)).toBe(threadPath)
        const encodedPath = roomViewThreadRelativePath('abc/def 123')
        expect(normalizeHostedRuntimeStateRelativePath(encodedPath)).toBe(encodedPath)
    })

    test('keeps the existing runtime state paths allowed', () => {
        expect(normalizeHostedRuntimeStateRelativePath('threads.json')).toBe('threads.json')
        expect(normalizeHostedRuntimeStateRelativePath('sessions/abc.jsonl')).toBe(
            'sessions/abc.jsonl',
        )
    })

    test('rejects paths outside the allowlist', () => {
        expect(() => normalizeHostedRuntimeStateRelativePath('view/secrets.json')).toThrow()
        expect(() => normalizeHostedRuntimeStateRelativePath('view/../escape.json')).toThrow()
        expect(() => normalizeHostedRuntimeStateRelativePath('arbitrary.json')).toThrow()
    })
})
