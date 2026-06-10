import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createWaitlistHandler } from './waitlist-handler'
import { createWaitlistStore } from './waitlist-store'

const packageRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const distRoot = join(packageRoot, 'dist')
const defaultDatabasePath = join(packageRoot, '.data', 'waitlist.sqlite')

const port = Number(process.env.PORT ?? '4173')
const databasePath = process.env.MARKETING_WAITLIST_DB ?? defaultDatabasePath
const rateLimitPerHour = Number(process.env.MARKETING_WAITLIST_RATE_LIMIT ?? '8')

if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid PORT value: ${String(process.env.PORT)}`)
}

if (!existsSync(distRoot)) {
    throw new Error('Marketing dist/ is missing. Run `bun run marketing:build` first.')
}

const waitlistStore = createWaitlistStore({ databasePath })
const waitlist = createWaitlistHandler({
    store: waitlistStore,
    rateLimitPerHour: Number.isFinite(rateLimitPerHour) ? rateLimitPerHour : undefined,
})

const server = Bun.serve({
    port,
    async fetch(request) {
        const waitlistResponse = await waitlist.handle(request)

        if (waitlistResponse) {
            return waitlistResponse
        }

        const url = new URL(request.url)
        const pathname = decodeURIComponent(url.pathname)
        const relativePath = pathname === '/' ? '/index.html' : pathname
        const filePath = join(distRoot, relativePath)
        const file = Bun.file(filePath)

        if (await file.exists()) {
            return new Response(file)
        }

        const spaFallback = Bun.file(join(distRoot, 'index.html'))

        if (await spaFallback.exists()) {
            return new Response(spaFallback, {
                headers: {
                    'content-type': 'text/html; charset=utf-8',
                },
            })
        }

        return new Response('Not found', { status: 404 })
    },
})

console.log(`Marketing site serving ${distRoot} on http://localhost:${server.port}`)
