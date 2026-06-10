import {
    jsonResponse,
    parseWaitlistBody,
    toWaitlistSubmission,
    validateWaitlistSubmission,
    waitlistApiPath,
    waitlistError,
    waitlistSuccess,
} from './waitlist-contract'
import { clientIp, createRateLimiter, type RateLimitResult } from './rate-limit'
import type { WaitlistSubmission } from '../src/content/types'

export type WaitlistStore = {
    save: (submission: WaitlistSubmission, sourceIp: string) => unknown | Promise<unknown>
    close?: () => void | Promise<void>
}

export type WaitlistRateLimiter = {
    check: (key: string, now?: number) => RateLimitResult | Promise<RateLimitResult>
}

export type WaitlistHandlerOptions = {
    store: WaitlistStore
    rateLimitPerHour?: number
    rateLimiter?: WaitlistRateLimiter
}

const defaultRateLimitPerHour = 8

export function createWaitlistHandler(options: WaitlistHandlerOptions) {
    const rateLimiter =
        options.rateLimiter ??
        createRateLimiter({
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

            const sourceIp = clientIp(request)
            const rateLimit = await rateLimiter.check(sourceIp)

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

            await options.store.save(toWaitlistSubmission(body), sourceIp)

            return jsonResponse(waitlistSuccess())
        },
        async close() {
            await options.store.close?.()
        },
    }
}
