import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

export class HttpError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message)
    }
}

export function getRequestBody(request: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
        let body = ''
        request.on('data', (chunk) => {
            body += String(chunk)
            if (body.length > 1_000_000) {
                reject(new Error('Request body is too large'))
                request.destroy()
            }
        })
        request.on('end', () => {
            if (!body.trim()) {
                resolve(null)
                return
            }
            try {
                resolve(JSON.parse(body))
            } catch {
                reject(new Error('Request body is not valid JSON'))
            }
        })
        request.on('error', reject)
    })
}

export function assertAuthorized(request: IncomingMessage, token: string): void {
    const expected = `Bearer ${token}`
    const received = request.headers.authorization ?? ''
    const expectedBytes = Buffer.from(expected)
    const receivedBytes = Buffer.from(received)
    const matches =
        expectedBytes.byteLength === receivedBytes.byteLength &&
        timingSafeEqual(expectedBytes, receivedBytes)
    if (!matches) {
        throw new HttpError(401, 'Invalid runtime token')
    }
}

export function sendJson(response: ServerResponse, status: number, payload: unknown): void {
    response.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
    })
    response.end(JSON.stringify(payload))
}

export function sendError(
    response: ServerResponse,
    error: unknown,
    errorMessage: (error: unknown) => string,
): void {
    const status = error instanceof HttpError ? error.status : 500
    sendJson(response, status, { message: errorMessage(error) })
}
