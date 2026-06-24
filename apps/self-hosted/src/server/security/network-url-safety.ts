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

function ipAddressVersion(value: string): 4 | 6 | 0 {
    if (parseIpv4(value) !== null) {
        return 4
    }
    if (value.includes(':')) {
        return 6
    }
    return 0
}

export function normalizedUrlHostname(url: URL): string {
    return url.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1')
}

export function isBlockedNetworkAddress(value: string): boolean {
    const version = ipAddressVersion(value)
    if (version === 4) {
        return isBlockedIpv4(value)
    }
    if (version === 6) {
        const mapped = ipv4FromMappedIpv6(value)
        return mapped ? isBlockedIpv4(mapped) : isBlockedIpv6(value)
    }
    return false
}

export function isBlockedNetworkHostname(hostname: string): boolean {
    const normalized = hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1')
    return (
        normalized === 'localhost' ||
        normalized.endsWith('.localhost') ||
        normalized.endsWith('.local') ||
        normalized === 'metadata' ||
        normalized === 'metadata.google.internal'
    )
}

export function assertNetworkUrlLiteralSafe(url: URL): void {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('Only http and https URLs can be fetched')
    }
    if (url.username || url.password) {
        throw new Error('URLs with embedded credentials cannot be fetched')
    }
    const hostname = normalizedUrlHostname(url)
    if (isBlockedNetworkHostname(hostname)) {
        throw new Error('Local and metadata hostnames cannot be fetched')
    }
    if (isBlockedNetworkAddress(hostname)) {
        throw new Error('Local and private network addresses cannot be fetched')
    }
}
