import { stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

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

async function serveClientFile(pathname: string): Promise<Response | null> {
    const absolutePath = resolveClientPath(pathname)
    if (!absolutePath) {
        return null
    }

    try {
        const fileStat = await stat(absolutePath)
        if (!fileStat.isFile()) {
            return null
        }
    } catch {
        return null
    }

    return new Response(bunRuntime.file(absolutePath))
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
        if (request.method === 'GET' || request.method === 'HEAD') {
            const url = new URL(request.url)
            const staticResponse = await serveClientFile(url.pathname)
            if (staticResponse) {
                return staticResponse
            }
        }

        return await serverEntry.fetch(request)
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
