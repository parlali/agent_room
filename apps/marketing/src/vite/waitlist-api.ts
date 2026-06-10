import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Connect } from 'vite'

export type MarketingWaitlistApiOptions = {
    databasePath: string
    rateLimitPerHour?: number
}

function readRequestBody(request: IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = []

        request.on('data', (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        })
        request.on('end', () => {
            resolve(Buffer.concat(chunks))
        })
        request.on('error', reject)
    })
}

export function marketingWaitlistApi(options: MarketingWaitlistApiOptions) {
    return {
        name: 'agent-room-marketing-waitlist-api',
        async configureServer(server: { middlewares: Connect.Server }) {
            const { createWaitlistHandler } = await import('../../server/waitlist-handler')
            const handler = createWaitlistHandler(options)

            server.middlewares.use(
                async (
                    request: IncomingMessage,
                    response: ServerResponse,
                    next: Connect.NextFunction,
                ) => {
                    if (!request.url) {
                        next()
                        return
                    }

                    const url = new URL(request.url, 'http://localhost')
                    const headers = new Headers()

                    for (const [key, value] of Object.entries(request.headers)) {
                        if (value === undefined) {
                            continue
                        }

                        if (Array.isArray(value)) {
                            for (const entry of value) {
                                headers.append(key, entry)
                            }
                        } else {
                            headers.set(key, value)
                        }
                    }

                    const init: RequestInit = {
                        method: request.method,
                        headers,
                    }

                    if (request.method !== 'GET' && request.method !== 'HEAD') {
                        const body = await readRequestBody(request)
                        init.body = new Uint8Array(body)
                    }

                    const waitlistResponse = await handler.handle(
                        new Request(`http://localhost${url.pathname}${url.search}`, init),
                    )

                    if (!waitlistResponse) {
                        next()
                        return
                    }

                    response.statusCode = waitlistResponse.status

                    waitlistResponse.headers.forEach((value, key) => {
                        response.setHeader(key, value)
                    })

                    response.end(Buffer.from(await waitlistResponse.arrayBuffer()))
                },
            )
        },
    }
}
