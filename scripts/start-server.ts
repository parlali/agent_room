import { readFile, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import {
    createPerformanceTraceId,
    elapsedPerformanceMs,
    logPerformanceEvent,
    performanceNow,
    summarizeRoutePath,
    withPerformanceTrace,
} from '../src/server/telemetry/performance'

type TanStackServerEntry = {
    fetch: (request: Request) => Promise<Response> | Response
}

type BunRuntime = {
    file: (path: string) => Blob
    serve: (options: {
        port: number
        fetch: (request: Request) => Promise<Response> | Response
    }) => {
        port: number
    }
}

const bunRuntimeCandidate = (globalThis as { Bun?: BunRuntime }).Bun
if (!bunRuntimeCandidate) {
    throw new Error('Bun runtime is required to start this server')
}
const bunRuntime = bunRuntimeCandidate

const clientRoot = resolve(fileURLToPath(new URL('../dist/client/', import.meta.url)))
const minimumCompressedAssetBytes = 1024
const maximumCompressedAssetBytes = 5 * 1024 * 1024
const compressibleClientExtensions = new Set([
    '.css',
    '.html',
    '.js',
    '.json',
    '.mjs',
    '.svg',
    '.txt',
    '.xml',
])
const contentTypesByExtension = new Map([
    ['.css', 'text/css; charset=utf-8'],
    ['.html', 'text/html; charset=utf-8'],
    ['.js', 'text/javascript; charset=utf-8'],
    ['.json', 'application/json; charset=utf-8'],
    ['.mjs', 'text/javascript; charset=utf-8'],
    ['.svg', 'image/svg+xml'],
    ['.txt', 'text/plain; charset=utf-8'],
    ['.woff2', 'font/woff2'],
    ['.xml', 'application/xml; charset=utf-8'],
])

function resolveClientPath(pathname: string): string | null {
    if (pathname === '/' || pathname.length === 0) {
        return null
    }

    let decodedPathname: string
    try {
        decodedPathname = decodeURIComponent(pathname)
    } catch {
        return null
    }

    const relativePath = decodedPathname.replace(/^\/+/, '')
    if (relativePath.length === 0) {
        return null
    }

    const absolutePath = resolve(clientRoot, relativePath)
    const rootPrefix = `${clientRoot}${sep}`
    if (absolutePath !== clientRoot && !absolutePath.startsWith(rootPrefix)) {
        return null
    }

    return absolutePath
}

async function serveClientFile(pathname: string, request: Request): Promise<Response | null> {
    const absolutePath = resolveClientPath(pathname)
    if (!absolutePath) {
        return null
    }

    let fileSize = 0
    try {
        const fileStat = await stat(absolutePath)
        if (!fileStat.isFile()) {
            return null
        }
        fileSize = fileStat.size
    } catch {
        return null
    }

    const headers = clientFileHeaders(pathname)
    if (request.method === 'HEAD') {
        headers.set('content-length', String(fileSize))
        return new Response(null, { headers })
    }

    if (shouldServeGzip(pathname, fileSize, request.headers.get('accept-encoding'))) {
        const raw = await readFile(absolutePath)
        const compressed = gzipSync(raw)
        if (compressed.byteLength < raw.byteLength) {
            headers.set('content-encoding', 'gzip')
            headers.set('content-length', String(compressed.byteLength))
            headers.set('vary', 'accept-encoding')
            return new Response(compressed, { headers })
        }
    }

    headers.set('content-length', String(fileSize))
    return new Response(bunRuntime.file(absolutePath), { headers })
}

function clientFileHeaders(pathname: string): Headers {
    const headers = new Headers()
    const contentType = contentTypesByExtension.get(extname(pathname).toLowerCase())
    if (contentType) {
        headers.set('content-type', contentType)
    }
    if (isHashedClientAsset(pathname)) {
        headers.set('cache-control', 'public, max-age=31536000, immutable')
    }
    return headers
}

function isHashedClientAsset(pathname: string): boolean {
    if (!pathname.startsWith('/assets/')) return false
    return /-[A-Za-z0-9_-]{6,}\.[A-Za-z0-9]+$/.test(pathname)
}

function shouldServeGzip(
    pathname: string,
    fileSize: number,
    acceptEncoding: string | null,
): boolean {
    if (!acceptEncoding?.toLowerCase().includes('gzip')) return false
    if (fileSize < minimumCompressedAssetBytes || fileSize > maximumCompressedAssetBytes) {
        return false
    }
    return compressibleClientExtensions.has(extname(pathname).toLowerCase())
}

const serverEntryPath = '../dist/server/server.js'
const serverEntry = ((await import(serverEntryPath)) as { default: TanStackServerEntry }).default

const rawPort = Number(process.env.PORT ?? '3000')
if (!Number.isInteger(rawPort) || rawPort <= 0) {
    throw new Error(`Invalid PORT value: ${String(process.env.PORT)}`)
}

const server = bunRuntime.serve({
    port: rawPort,
    async fetch(request) {
        const traceId = createPerformanceTraceId()
        return withPerformanceTrace(traceId, async () => {
            const startedAt = performanceNow()
            const url = new URL(request.url)
            const route = summarizeRoutePath(`${url.pathname}${url.search}`)
            try {
                if (request.method === 'GET' || request.method === 'HEAD') {
                    const staticResponse = await serveClientFile(url.pathname, request)
                    if (staticResponse) {
                        logPerformanceEvent('http.request', {
                            method: request.method,
                            routePath: route.routePath,
                            queryKeys: route.queryKeys,
                            statusCode: staticResponse.status,
                            source: 'static',
                            contentEncoding: staticResponse.headers.get('content-encoding'),
                            cacheControl: staticResponse.headers.get('cache-control'),
                            durationMs: elapsedPerformanceMs(startedAt),
                        })
                        return staticResponse
                    }
                }

                const response = await serverEntry.fetch(request)
                logPerformanceEvent('http.request', {
                    method: request.method,
                    routePath: route.routePath,
                    queryKeys: route.queryKeys,
                    statusCode: response.status,
                    source: 'app',
                    durationMs: elapsedPerformanceMs(startedAt),
                })
                return response
            } catch (error) {
                logPerformanceEvent('http.request', {
                    method: request.method,
                    routePath: route.routePath,
                    queryKeys: route.queryKeys,
                    statusCode: null,
                    source: 'app',
                    status: 'error',
                    durationMs: elapsedPerformanceMs(startedAt),
                    errorName: error instanceof Error ? error.name : typeof error,
                })
                throw error
            }
        })
    },
})

console.log(`Started server: http://localhost:${String(server.port)}`)

void import('../src/server/rooms/runtime-supervisor-bootstrap')
    .then(({ ensureRuntimeSupervisorBoot }) => ensureRuntimeSupervisorBoot())
    .then(() => {
        console.log('Runtime supervisor reconciled desired running rooms')
    })
    .catch((error) => {
        console.error(
            'Runtime supervisor startup reconcile failed',
            error instanceof Error ? error.message : error,
        )
    })

void import('../src/server/rooms/cron-scheduler')
    .then(({ startRoomCronScheduler }) => {
        startRoomCronScheduler()
        console.log('Room cron scheduler started')
    })
    .catch((error) => {
        console.error(
            'Room cron scheduler startup failed',
            error instanceof Error ? error.message : error,
        )
    })
