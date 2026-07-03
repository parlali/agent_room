export interface RouteAuthCacheOptions<T> {
    fetchSnapshot: () => Promise<T>
    hasUser: (snapshot: T) => boolean
    ttlMs: number
    now?: () => number
}

export interface RouteAuthCache<T> {
    read: () => Promise<T>
    clear: () => void
}

export function createRouteAuthCache<T>(options: RouteAuthCacheOptions<T>): RouteAuthCache<T> {
    const now = options.now ?? Date.now
    let entry: { promise: Promise<T>; expiresAt: number } | null = null

    const clear = () => {
        entry = null
    }

    const read = (): Promise<T> => {
        if (entry && entry.expiresAt > now()) {
            return entry.promise
        }
        const current = {
            expiresAt: now() + options.ttlMs,
            promise: options.fetchSnapshot().then(
                (snapshot) => {
                    if (!options.hasUser(snapshot) && entry === current) {
                        clear()
                    }
                    return snapshot
                },
                (error: unknown) => {
                    if (entry === current) {
                        clear()
                    }
                    throw error
                },
            ),
        }
        entry = current
        return current.promise
    }

    return {
        read,
        clear,
    }
}
