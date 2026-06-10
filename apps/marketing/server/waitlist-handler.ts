import {
    jsonResponse,
    parseWaitlistBody,
    toWaitlistSubmission,
    validateWaitlistSubmission,
    waitlistApiPath,
    waitlistError,
    waitlistSuccess,
} from './waitlist-contract'
import { clientIp, createRateLimiter } from './rate-limit'
import { createWaitlistStore } from './waitlist-store'

export type WaitlistHandlerOptions = {
    databasePath: string
    rateLimitPerHour?: number
}

const defaultRateLimitPerHour = 8

export function createWaitlistHandler(options: WaitlistHandlerOptions) {
    const store = createWaitlistStore({ databasePath: options.databasePath })
    const rateLimiter = createRateLimiter({
        limit: options.rateLimitPerHour ?? defaultRateLimitPerHour,
        windowMs: 60 * 60 * 1000,
    })

    return {
        async handle(request: Request): Promise<Response | null> {
            const url = new URL(request.url)

            if (url.pathname !== waitlistApiPath) {
                return null
            }

            if (request.method === 'OPTIONS') {
                return new Response(null, {
                    status: 204,
                    headers: {
                        'access-control-allow-methods': 'POST, OPTIONS',
                        'access-control-allow-headers': 'content-type',
                    },
                })
            }

            if (request.method !== 'POST') {
                return jsonResponse(waitlistError('Method not allowed.'), 405)
            }

            const rateLimit = rateLimiter.check(clientIp(request))

            if (!rateLimit.allowed) {
                return new Response(
                    JSON.stringify(
                        waitlistError(
                            `Too many submissions. Try again in ${rateLimit.retryAfterSeconds} seconds.`,
                        ),
                    ),
                    {
                        status: 429,
                        headers: {
                            'content-type': 'application/json; charset=utf-8',
                            'cache-control': 'no-store',
                            'retry-after': String(rateLimit.retryAfterSeconds),
                        },
                    },
                )
            }

            let rawBody: unknown

            try {
                rawBody = await request.json()
            } catch {
                return jsonResponse(waitlistError('Request body must be valid JSON.'), 400)
            }

            const body = parseWaitlistBody(rawBody)

            if (!body) {
                return jsonResponse(waitlistError('Request body must be a JSON object.'), 400)
            }

            if (body.website) {
                return jsonResponse(waitlistSuccess())
            }

            const fieldErrors = validateWaitlistSubmission(body)

            if (fieldErrors) {
                return jsonResponse(
                    waitlistError('Fix the highlighted fields and try again.', fieldErrors),
                    422,
                )
            }

            store.save(toWaitlistSubmission(body), clientIp(request))

            return jsonResponse(waitlistSuccess())
        },
        close() {
            store.close()
        },
    }
}
