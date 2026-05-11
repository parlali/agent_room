import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

function parseIpv4(value: string): number | null {
    const parts = value.split('.').map((part) => Number(part))
    if (
        parts.length !== 4 ||
        parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
    ) {
        return null
    }
    return (((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!) >>> 0
}

function ipv4InRange(value: string, base: string, mask: number): boolean {
    const address = parseIpv4(value)
    const baseAddress = parseIpv4(base)
    if (address === null || baseAddress === null) {
        return false
    }
    const maskValue = mask === 0 ? 0 : (0xffffffff << (32 - mask)) >>> 0
    return (address & maskValue) === (baseAddress & maskValue)
}

function isBlockedIpv4(value: string): boolean {
    return [
        ['0.0.0.0', 8],
        ['10.0.0.0', 8],
        ['100.64.0.0', 10],
        ['127.0.0.0', 8],
        ['169.254.0.0', 16],
        ['172.16.0.0', 12],
        ['192.0.0.0', 24],
        ['192.168.0.0', 16],
        ['224.0.0.0', 4],
        ['240.0.0.0', 4],
    ].some(([base, mask]) => ipv4InRange(value, String(base), Number(mask)))
}

function isBlockedIpv6(value: string): boolean {
    const normalized = value.toLowerCase()
    return (
        normalized === '::' ||
        normalized === '::1' ||
        normalized.startsWith('fc') ||
        normalized.startsWith('fd') ||
        normalized.startsWith('fe8') ||
        normalized.startsWith('fe9') ||
        normalized.startsWith('fea') ||
        normalized.startsWith('feb') ||
        normalized.startsWith('ff')
    )
}

function ipv4FromMappedIpv6(value: string): string | null {
    const normalized = value.toLowerCase()
    const dotted = normalized.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/)
    if (dotted) {
        return dotted[1]!
    }
    const hex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
    if (!hex) {
        return null
    }
    const high = Number.parseInt(hex[1]!, 16)
    const low = Number.parseInt(hex[2]!, 16)
    if (!Number.isFinite(high) || !Number.isFinite(low)) {
        return null
    }
    return `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`
}

export function isBlockedNetworkAddress(value: string): boolean {
    if (isIP(value) === 4) {
        return isBlockedIpv4(value)
    }
    if (isIP(value) === 6) {
        const mapped = ipv4FromMappedIpv6(value)
        return mapped ? isBlockedIpv4(mapped) : isBlockedIpv6(value)
    }
    return false
}

export async function assertSafeUrl(url: URL): Promise<void> {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('Only http and https URLs can be fetched')
    }
    if (url.username || url.password) {
        throw new Error('URLs with embedded credentials cannot be fetched')
    }
    const hostname = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1')
    if (
        hostname === 'localhost' ||
        hostname.endsWith('.localhost') ||
        hostname.endsWith('.local') ||
        hostname === 'metadata' ||
        hostname === 'metadata.google.internal'
    ) {
        throw new Error('Local and metadata hostnames cannot be fetched')
    }
    if (isBlockedNetworkAddress(hostname)) {
        throw new Error('Local and private network addresses cannot be fetched')
    }
    const addresses = await lookup(hostname, {
        all: true,
        verbatim: true,
    })
    if (addresses.some((entry) => isBlockedNetworkAddress(entry.address))) {
        throw new Error('URL resolves to a local or private network address')
    }
}

export function sanitizeUrlForAudit(value: string): string {
    try {
        const url = new URL(value)
        const hadSearch = url.search.length > 0
        const hadHash = url.hash.length > 0
        url.username = ''
        url.password = ''
        url.search = ''
        url.hash = ''
        return `${url.toString()}${hadSearch ? '?[redacted]' : ''}${hadHash ? '#[redacted]' : ''}`
    } catch {
        return '[invalid-url]'
    }
}
