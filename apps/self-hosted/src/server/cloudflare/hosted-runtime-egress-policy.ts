import {
    assertNetworkUrlLiteralSafe,
    isBlockedNetworkAddress,
    normalizedUrlHostname,
} from '../security/network-url-safety'

export type HostedRuntimeDnsResolver = (hostname: string) => Promise<string[]>

interface DnsJsonAnswer {
    type: number
    data: string
}

interface DnsJsonResponse {
    Answer?: DnsJsonAnswer[]
}

function parseHostedRuntimeEgressUrl(value: string, label: string): URL {
    try {
        return new URL(value)
    } catch {
        throw new Error(`${label} URL is invalid`)
    }
}

function assertHostedRuntimeEgressUrlLiteralSafe(url: URL, label: string): void {
    try {
        assertNetworkUrlLiteralSafe(url)
    } catch (error) {
        const message = error instanceof Error ? error.message : 'unsafe URL'
        throw new Error(`${label} URL is not allowed for hosted runtime egress: ${message}`)
    }
}

async function queryDnsJson(hostname: string, type: 'A' | 'AAAA'): Promise<string[]> {
    const response = await fetch(
        `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`,
        {
            headers: {
                accept: 'application/dns-json',
            },
        },
    )
    if (!response.ok) {
        throw new Error(`DNS lookup failed with ${response.status}`)
    }
    const body = (await response.json()) as DnsJsonResponse
    const expectedType = type === 'A' ? 1 : 28
    return (body.Answer ?? [])
        .filter((answer) => answer.type === expectedType)
        .map((answer) => answer.data)
}

export async function resolveHostedRuntimeDns(hostname: string): Promise<string[]> {
    const [ipv4, ipv6] = await Promise.all([
        queryDnsJson(hostname, 'A'),
        queryDnsJson(hostname, 'AAAA'),
    ])
    return [...new Set([...ipv4, ...ipv6])]
}

export function assertHostedRuntimeEgressUrlLiteral(value: string, label: string): string {
    const url = parseHostedRuntimeEgressUrl(value, label)
    assertHostedRuntimeEgressUrlLiteralSafe(url, label)
    return normalizedUrlHostname(url)
}

export async function assertHostedRuntimeEgressUrl(input: {
    value: string
    label: string
    resolveHostnameAddresses?: HostedRuntimeDnsResolver
}): Promise<string> {
    const url = parseHostedRuntimeEgressUrl(input.value, input.label)
    assertHostedRuntimeEgressUrlLiteralSafe(url, input.label)
    const hostname = normalizedUrlHostname(url)
    if (hostname.includes(':') || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
        return hostname
    }
    let addresses: string[]
    try {
        addresses = await (input.resolveHostnameAddresses ?? resolveHostedRuntimeDns)(hostname)
    } catch (error) {
        const message = error instanceof Error ? error.message : 'lookup failed'
        throw new Error(
            `${input.label} URL hostname could not be verified for hosted runtime egress: ${message}`,
        )
    }
    if (addresses.length === 0) {
        throw new Error(
            `${input.label} URL hostname could not be verified for hosted runtime egress`,
        )
    }
    if (addresses.some((address) => isBlockedNetworkAddress(address))) {
        throw new Error(`${input.label} URL resolves to a local or private network address`)
    }
    return hostname
}
