import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startHostedBootHydration, type HostedBootHydration } from './hosted-boot-hydration'

const runtimeToken = 'boot-hydration-test-token-aaaaaaaa'

let runtimeRoot: string
let hydration: HostedBootHydration

function serverUrl(path: string): string {
    const address = hydration.server.address()
    if (!address || typeof address === 'string') {
        throw new Error('Boot hydration server address is not available')
    }
    return `http://127.0.0.1:${address.port}${path}`
}

function pushBundle(input: { body: string; token?: string }): Promise<Response> {
    return fetch(serverUrl('/boot/materialize'), {
        method: 'POST',
        headers: {
            authorization: `Bearer ${input.token ?? runtimeToken}`,
            'content-type': 'application/json',
        },
        body: input.body,
    })
}

beforeEach(async () => {
    runtimeRoot = await mkdtemp(join(tmpdir(), 'agent-room-boot-hydration-'))
    hydration = await startHostedBootHydration({
        port: 0,
        bindHost: '127.0.0.1',
        token: runtimeToken,
        runtimeRoot,
    })
})

afterEach(async () => {
    await new Promise<void>((resolve) => {
        hydration.server.close(() => resolve())
    })
    await rm(runtimeRoot, { recursive: true, force: true })
})

describe('hosted boot hydration', () => {
    it('rejects bundle pushes without the runtime token', async () => {
        const response = await pushBundle({
            body: JSON.stringify([]),
            token: 'wrong-token',
        })
        expect(response.status).toBe(401)
    })

    it('rejects bundle entries outside the hosted runtime root', async () => {
        const response = await pushBundle({
            body: JSON.stringify([
                {
                    path: '/etc/passwd',
                    contentBase64: Buffer.from('nope', 'utf8').toString('base64url'),
                    mode: 0o600,
                },
            ]),
        })
        expect(response.status).toBe(400)
    })

    it('returns 503 for runtime routes before hydration completes', async () => {
        const response = await fetch(serverUrl('/snapshot'), {
            headers: {
                authorization: `Bearer ${runtimeToken}`,
            },
        })
        expect(response.status).toBe(503)
    })

    it('writes bundle files, holds the response until activation, then serves the runtime route', async () => {
        const configPath = join(runtimeRoot, 'pi-state', 'config.json')
        const pushPromise = pushBundle({
            body: JSON.stringify([
                {
                    path: configPath,
                    contentBase64: Buffer.from('{"ok":true}', 'utf8').toString('base64url'),
                    mode: 0o600,
                },
            ]),
        })
        await hydration.hydrated
        expect(await readFile(configPath, 'utf8')).toBe('{"ok":true}')

        const duplicate = await pushBundle({ body: JSON.stringify([]) })
        expect(duplicate.status).toBe(409)

        hydration.activate((_request, response) => {
            response.writeHead(200, { 'content-type': 'application/json' })
            response.end(JSON.stringify({ routed: true }))
        })
        const pushResponse = await pushPromise
        expect(pushResponse.status).toBe(200)
        expect(await pushResponse.json()).toEqual({ ok: true })

        const routed = await fetch(serverUrl('/snapshot'))
        expect(routed.status).toBe(200)
        expect(await routed.json()).toEqual({ routed: true })
    })
})
