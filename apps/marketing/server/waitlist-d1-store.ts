import type { WaitlistSubmission } from '../src/content/types'
import type { WaitlistRateLimiter, WaitlistStore } from './waitlist-handler'

type D1RateLimitRow = {
    count: number
    reset_at: number
}

export function createD1WaitlistStore(database: D1Database): WaitlistStore {
    return {
        async save(submission: WaitlistSubmission, sourceIp: string): Promise<void> {
            await database
                .prepare(
                    `
                    INSERT INTO waitlist_submissions (
                        created_at,
                        source_ip,
                        name,
                        email,
                        company,
                        use_case,
                        interest
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                `,
                )
                .bind(
                    new Date().toISOString(),
                    sourceIp,
                    submission.name,
                    submission.email,
                    submission.company,
                    submission.useCase,
                    submission.interest,
                )
                .run()
        },
    }
}

export function createD1RateLimiter(
    database: D1Database,
    options: { limit: number; windowMs: number },
): WaitlistRateLimiter {
    return {
        async check(key: string, now = Date.now()) {
            await database
                .prepare('DELETE FROM waitlist_rate_limits WHERE reset_at <= ?')
                .bind(now)
                .run()

            const bucket = await database
                .prepare(
                    `
                    INSERT INTO waitlist_rate_limits (
                        key,
                        count,
                        reset_at
                    ) VALUES (?, ?, ?)
                    ON CONFLICT(key) DO UPDATE SET
                        count = CASE
                            WHEN waitlist_rate_limits.reset_at <= ? THEN 1
                            WHEN waitlist_rate_limits.count > ? THEN waitlist_rate_limits.count
                            ELSE waitlist_rate_limits.count + 1
                        END,
                        reset_at = CASE
                            WHEN waitlist_rate_limits.reset_at <= ? THEN excluded.reset_at
                            ELSE waitlist_rate_limits.reset_at
                        END
                    RETURNING count, reset_at
                `,
                )
                .bind(key, 1, now + options.windowMs, now, options.limit, now)
                .first<D1RateLimitRow>()

            if (!bucket) {
                throw new Error('D1 rate-limit bucket was not returned.')
            }

            if (bucket.count > options.limit) {
                return {
                    allowed: false,
                    retryAfterSeconds: Math.max(1, Math.ceil((bucket.reset_at - now) / 1000)),
                }
            }

            return { allowed: true }
        },
    }
}
