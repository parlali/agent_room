export function roomIdFromPathname(pathname: string): string | null {
    return /^\/rooms\/([^/]+)/.exec(pathname)?.[1] ?? null
}

export function resolveActiveRoomId(input: {
    routeRoomId: string | null
    optimisticRoomId: string | null
}): string | null {
    return input.optimisticRoomId ?? input.routeRoomId
}

export function shouldClearOptimisticRoomId(input: {
    routeRoomId: string | null
    optimisticRoomId: string | null
}): boolean {
    return input.optimisticRoomId !== null && input.optimisticRoomId === input.routeRoomId
}
