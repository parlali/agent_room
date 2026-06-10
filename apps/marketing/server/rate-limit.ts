type RateLimitBucket = {
    count: number
    resetAt: number
}

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number }

export function createRateLimiter(options: { limit: number; windowMs: number }) {
    const buckets = new Map<string, RateLimitBucket>()

    return {
        check(key: string, now = Date.now()): RateLimitResult {
            const bucket = buckets.get(key)

            if (!bucket || bucket.resetAt <= now) {
                buckets.set(key, {
                    count: 1,
                    resetAt: now + options.windowMs,
                })
                return { allowed: true }
            }

            if (bucket.count >= options.limit) {
                return {
                    allowed: false,
                    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
                }
            }

            bucket.count += 1
            return { allowed: true }
        },
    }
}

export function clientIp(request: Request): string {
    const forwarded = request.headers.get('x-forwarded-for')

    if (forwarded) {
        const first = forwarded.split(',')[0]?.trim()
        if (first) {
            return first
        }
    }

    return request.headers.get('x-real-ip') ?? 'unknown'
}
