import { lookup } from 'node:dns/promises'
import {
    assertNetworkUrlLiteralSafe,
    isBlockedNetworkAddress,
    normalizedUrlHostname,
} from '../security/network-url-safety'

export { isBlockedNetworkAddress } from '../security/network-url-safety'

export async function assertSafeUrl(url: URL): Promise<void> {
    assertNetworkUrlLiteralSafe(url)
    const hostname = normalizedUrlHostname(url)
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
