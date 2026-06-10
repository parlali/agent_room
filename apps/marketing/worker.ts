import { createD1RateLimiter, createD1WaitlistStore } from './server/waitlist-d1-store'
import { createWaitlistHandler } from './server/waitlist-handler'

type MarketingWorkerEnv = {
    ASSETS: Fetcher
    WAITLIST_DB: D1Database
    MARKETING_WAITLIST_RATE_LIMIT?: string
}

const defaultRateLimitPerHour = 8

function rateLimitFromEnv(raw: string | undefined): number {
    const parsed = Number(raw)

    if (!Number.isFinite(parsed) || parsed <= 0) {
        return defaultRateLimitPerHour
    }

    return parsed
}

export default {
    async fetch(request, env) {
        const rateLimitPerHour = rateLimitFromEnv(env.MARKETING_WAITLIST_RATE_LIMIT)
        const waitlist = createWaitlistHandler({
            store: createD1WaitlistStore(env.WAITLIST_DB),
            rateLimiter: createD1RateLimiter(env.WAITLIST_DB, {
                limit: rateLimitPerHour,
                windowMs: 60 * 60 * 1000,
            }),
        })
        const waitlistResponse = await waitlist.handle(request)

        if (waitlistResponse) {
            return waitlistResponse
        }

        return env.ASSETS.fetch(request)
    },
} satisfies ExportedHandler<MarketingWorkerEnv>
