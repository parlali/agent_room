export function hostedJsonResponse(payload: unknown, init?: ResponseInit): Response {
    const headers = new Headers(init?.headers)
    headers.set('content-type', 'application/json; charset=utf-8')
    headers.set('cache-control', 'no-store')
    return new Response(JSON.stringify(payload), {
        ...init,
        headers,
    })
}
