import { assertSafeUrl } from './web-url-safety'

interface FetchResult {
    url: string
    finalUrl: string
    status: number
    contentType: string
    title: string | null
    text: string
    byteLength: number
    truncated: boolean
}

const maxFetchBytes = 512000
const maxReturnedTextBytes = 128000
const maxRedirects = 5

function isAllowedContentType(contentType: string): boolean {
    const lower = contentType.toLowerCase()
    return (
        lower.startsWith('text/') ||
        lower.includes('json') ||
        lower.includes('xml') ||
        lower.includes('xhtml') ||
        lower === ''
    )
}

async function readBoundedBody(response: Response): Promise<{
    buffer: Buffer
    truncated: boolean
}> {
    if (!response.body) {
        return {
            buffer: Buffer.alloc(0),
            truncated: false,
        }
    }
    const reader = response.body.getReader()
    const chunks: Buffer[] = []
    let byteLength = 0
    let truncated = false
    while (true) {
        const next = await reader.read()
        if (next.done) {
            break
        }
        const chunk = Buffer.from(next.value)
        byteLength += chunk.byteLength
        if (byteLength > maxFetchBytes) {
            truncated = true
            const remaining = Math.max(
                0,
                maxFetchBytes - chunks.reduce((sum, item) => sum + item.byteLength, 0),
            )
            if (remaining > 0) {
                chunks.push(chunk.subarray(0, remaining))
            }
            await reader.cancel()
            break
        }
        chunks.push(chunk)
    }
    return {
        buffer: Buffer.concat(chunks),
        truncated,
    }
}

function extractTitle(html: string): string | null {
    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    return match ? decodeHtml(match[1]!.replace(/\s+/g, ' ').trim()) : null
}

function decodeHtml(value: string): string {
    return value
        .replaceAll('&amp;', '&')
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&quot;', '"')
        .replaceAll('&#39;', "'")
        .replaceAll('&nbsp;', ' ')
}

function extractText(
    content: string,
    contentType: string,
): {
    text: string
    title: string | null
} {
    if (!contentType.toLowerCase().includes('html')) {
        return {
            text: content.replace(/\s+/g, ' ').trim(),
            title: null,
        }
    }
    const withoutScripts = content
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    const title = extractTitle(withoutScripts)
    const text = decodeHtml(
        withoutScripts
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim(),
    )
    return {
        text,
        title,
    }
}

function boundReturnText(text: string): {
    text: string
    truncated: boolean
} {
    const buffer = Buffer.from(text)
    if (buffer.byteLength <= maxReturnedTextBytes) {
        return {
            text,
            truncated: false,
        }
    }
    return {
        text: buffer.subarray(0, maxReturnedTextBytes).toString('utf8'),
        truncated: true,
    }
}

export async function fetchUrl(input: {
    url: string
    timeoutMs: number
    signal?: AbortSignal
}): Promise<FetchResult> {
    let current = new URL(input.url)
    await assertSafeUrl(current)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs)
    timeout.unref?.()
    input.signal?.addEventListener('abort', () => controller.abort(), { once: true })

    try {
        let response: Response | null = null
        for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
            response = await fetch(current, {
                redirect: 'manual',
                headers: {
                    accept: 'text/html, text/plain, application/json, application/xml, text/xml;q=0.9, */*;q=0.1',
                    'user-agent': 'AgentRoomBot/1.0',
                },
                signal: controller.signal,
            })
            if (response.status < 300 || response.status >= 400) {
                break
            }
            const location = response.headers.get('location')
            if (!location) {
                break
            }
            current = new URL(location, current)
            await assertSafeUrl(current)
            response = null
        }
        if (!response) {
            throw new Error('Too many redirects')
        }
        const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? ''
        if (!isAllowedContentType(contentType)) {
            throw new Error(`Content type ${contentType || 'unknown'} is not fetchable as text`)
        }
        const body = await readBoundedBody(response)
        const content = body.buffer.toString('utf8')
        const extracted = extractText(content, contentType)
        const bounded = boundReturnText(extracted.text)
        return {
            url: input.url,
            finalUrl: current.toString(),
            status: response.status,
            contentType,
            title: extracted.title,
            text: bounded.text,
            byteLength: body.buffer.byteLength,
            truncated: body.truncated || bounded.truncated,
        }
    } finally {
        clearTimeout(timeout)
    }
}
