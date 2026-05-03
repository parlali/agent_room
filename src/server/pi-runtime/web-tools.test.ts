import { describe, expect, it } from 'vitest'
import {
    assertSafeUrl,
    isBlockedNetworkAddress,
    normalizeSearxngSafeSearch,
    parseSearxngResults,
    sanitizeUrlForAudit,
} from './web-tools'

describe('web tools', () => {
    it('parses bounded SearXNG results into canonical search results', () => {
        const results = parseSearxngResults(
            {
                results: [
                    {
                        title: 'Example',
                        url: 'https://example.com/page',
                        content: 'A short result snippet.',
                        engines: ['duckduckgo', 'brave'],
                    },
                    {
                        title: '',
                        url: 'not-a-url',
                        content: 'ignored',
                    },
                ],
            },
            '2026-05-03T10:00:00.000Z',
        )

        expect(results).toEqual([
            {
                title: 'Example',
                url: 'https://example.com/page',
                snippet: 'A short result snippet.',
                engine: 'duckduckgo, brave',
                fetchedAt: '2026-05-03T10:00:00.000Z',
                rank: 1,
            },
        ])
    })

    it('blocks local, private, link-local, and metadata network addresses', () => {
        expect(isBlockedNetworkAddress('127.0.0.1')).toBe(true)
        expect(isBlockedNetworkAddress('10.1.2.3')).toBe(true)
        expect(isBlockedNetworkAddress('172.20.1.1')).toBe(true)
        expect(isBlockedNetworkAddress('192.168.1.1')).toBe(true)
        expect(isBlockedNetworkAddress('169.254.169.254')).toBe(true)
        expect(isBlockedNetworkAddress('::1')).toBe(true)
        expect(isBlockedNetworkAddress('::ffff:127.0.0.1')).toBe(true)
        expect(isBlockedNetworkAddress('::ffff:7f00:1')).toBe(true)
        expect(isBlockedNetworkAddress('8.8.8.8')).toBe(false)
    })

    it('rejects unsafe fetch URL schemes and hostnames before network fetch', async () => {
        await expect(assertSafeUrl(new URL('file:///etc/passwd'))).rejects.toThrow(
            'Only http and https URLs can be fetched',
        )
        await expect(assertSafeUrl(new URL('http://localhost/status'))).rejects.toThrow(
            'Local and metadata hostnames cannot be fetched',
        )
        await expect(assertSafeUrl(new URL('http://[::1]/status'))).rejects.toThrow(
            'Local and private network addresses cannot be fetched',
        )
        await expect(
            assertSafeUrl(new URL('http://metadata.google.internal/computeMetadata/v1')),
        ).rejects.toThrow('Local and metadata hostnames cannot be fetched')
        await expect(
            assertSafeUrl(new URL('https://user:pass@example.com/private')),
        ).rejects.toThrow('URLs with embedded credentials cannot be fetched')
    })

    it('normalizes SearXNG safe search values before they reach the backend', () => {
        expect(normalizeSearxngSafeSearch('off')).toBe('0')
        expect(normalizeSearxngSafeSearch('moderate')).toBe('1')
        expect(normalizeSearxngSafeSearch('strict')).toBe('2')
        expect(() => normalizeSearxngSafeSearch('unbounded')).toThrow(
            'safeSearch must be off, moderate, strict, 0, 1, or 2',
        )
    })

    it('redacts URL credentials, queries, and fragments before audit persistence', () => {
        expect(sanitizeUrlForAudit('https://user:pass@example.com/path?token=secret#frag')).toBe(
            'https://example.com/path?[redacted]#[redacted]',
        )
    })
})
