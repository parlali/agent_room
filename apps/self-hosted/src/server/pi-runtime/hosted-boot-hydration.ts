import { Buffer } from 'node:buffer'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { piRuntimeBootMaterializePath } from '../rooms/pi-runtime-contract'
import { assertAuthorized, HttpError, sendJson } from './runtime-http'

export const maxHostedBootBundleBytes = 64 * 1024 * 1024

export const hostedRuntimeBundleRoot = '/workspace/runtime'

export interface RuntimeFileBundleEntry {
    path: string
    contentBase64: string
    mode: number | undefined
}

export interface HostedBootHydration {
    server: Server
    hydrated: Promise<void>
    activate: (route: (request: IncomingMessage, response: ServerResponse) => void) => void
}

export function assertHostedRuntimeBundlePath(
    path: string,
    runtimeRoot = hostedRuntimeBundleRoot,
): void {
    if (!isAbsolute(path)) {
        throw new HttpError(400, 'Runtime file bundle path must be absolute')
    }
    const relativePath = relative(runtimeRoot, resolve(path))
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
        throw new HttpError(400, 'Runtime file bundle path is outside the hosted runtime root')
    }
}

function parseBundleEntries(raw: string, runtimeRoot: string): RuntimeFileBundleEntry[] {
    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        throw new HttpError(400, 'Runtime file bundle body is not valid JSON')
    }
    if (!Array.isArray(parsed)) {
        throw new HttpError(400, 'Runtime file bundle must be an array')
    }
    return parsed.map((entry) => {
        if (!entry || typeof entry !== 'object') {
            throw new HttpError(400, 'Runtime file bundle entry must be an object')
        }
        const record = entry as Record<string, unknown>
        if (typeof record.path !== 'string' || typeof record.contentBase64 !== 'string') {
            throw new HttpError(400, 'Runtime file bundle entry is missing path or content')
        }
        assertHostedRuntimeBundlePath(record.path, runtimeRoot)
        return {
            path: record.path,
            contentBase64: record.contentBase64,
            mode: typeof record.mode === 'number' ? record.mode : undefined,
        }
    })
}

function readBoundedBody(request: IncomingMessage, maxBytes: number): Promise<string> {
    return new Promise((resolveBody, rejectBody) => {
        const chunks: Buffer[] = []
        let totalBytes = 0
        request.on('data', (chunk: Buffer) => {
            totalBytes += chunk.byteLength
            if (totalBytes > maxBytes) {
                rejectBody(new HttpError(413, 'Runtime file bundle exceeds the size limit'))
                request.destroy()
                return
            }
            chunks.push(chunk)
        })
        request.on('end', () => {
            resolveBody(Buffer.concat(chunks).toString('utf8'))
        })
        request.on('error', rejectBody)
    })
}

export async function materializeRuntimeBundleEntries(
    entries: RuntimeFileBundleEntry[],
    runtimeRoot = hostedRuntimeBundleRoot,
): Promise<void> {
    for (const entry of entries) {
        assertHostedRuntimeBundlePath(entry.path, runtimeRoot)
        await mkdir(dirname(entry.path), {
            recursive: true,
            mode: 0o700,
        })
        await writeFile(entry.path, Buffer.from(entry.contentBase64, 'base64url'), {
            mode: entry.mode ?? 0o600,
        })
        if (entry.mode) {
            await chmod(entry.path, entry.mode)
        }
    }
}

export function startHostedBootHydration(input: {
    port: number
    bindHost: string
    token: string
    runtimeRoot?: string
}): Promise<HostedBootHydration> {
    const runtimeRoot = input.runtimeRoot ?? hostedRuntimeBundleRoot
    let activeRoute: ((request: IncomingMessage, response: ServerResponse) => void) | null = null
    let hydrating = false
    let hydratedDone = false
    let heldResponse: ServerResponse | null = null
    let resolveHydrated!: () => void
    const hydrated = new Promise<void>((resolvePromise) => {
        resolveHydrated = resolvePromise
    })

    async function handleBootRequest(
        request: IncomingMessage,
        response: ServerResponse,
    ): Promise<void> {
        try {
            assertAuthorized(request, input.token)
            if (request.method !== 'POST' || request.url !== piRuntimeBootMaterializePath) {
                sendJson(response, 503, {
                    message: 'Hosted runtime is waiting for boot hydration',
                })
                return
            }
            if (hydrating || hydratedDone) {
                sendJson(response, 409, {
                    message: 'Hosted runtime boot bundle was already delivered',
                })
                return
            }
            hydrating = true
            try {
                const entries = parseBundleEntries(
                    await readBoundedBody(request, maxHostedBootBundleBytes),
                    runtimeRoot,
                )
                await materializeRuntimeBundleEntries(entries, runtimeRoot)
                hydratedDone = true
            } finally {
                hydrating = hydratedDone
            }
            heldResponse = response
            resolveHydrated()
        } catch (error) {
            const status = error instanceof HttpError ? error.status : 500
            const message =
                error instanceof HttpError ? error.message : 'Hosted runtime boot hydration failed'
            if (!response.writableEnded && !response.destroyed) {
                sendJson(response, status, { message })
            }
        }
    }

    return new Promise((resolveServer, rejectServer) => {
        const server = createServer((request, response) => {
            if (activeRoute) {
                activeRoute(request, response)
                return
            }
            void handleBootRequest(request, response)
        })
        server.once('error', rejectServer)
        server.listen(input.port, input.bindHost, () => {
            resolveServer({
                server,
                hydrated,
                activate: (route) => {
                    activeRoute = route
                    if (heldResponse && !heldResponse.writableEnded && !heldResponse.destroyed) {
                        sendJson(heldResponse, 200, { ok: true })
                    }
                    heldResponse = null
                },
            })
        })
    })
}
