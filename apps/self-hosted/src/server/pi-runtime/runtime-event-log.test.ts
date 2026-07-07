import { mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRuntimeEventAppender } from './runtime-event-log'
import { createTestPiRuntimeConfig, ensureTestPiRuntimeDirectories } from './test-runtime-defaults'
import {
    hostedRuntimeFileCallbackUrlEnvKey,
    hostedRuntimeUsageCallbackTokenEnvKey,
    hostedRuntimeWorkspaceIdEnvKey,
} from '../rooms/pi-runtime-contract'
import { sha256Buffer } from './runtime-artifacts'

const fileCallbackUrl = 'https://rooms.example.test/api/hosted/runtime/file'
const callbackToken = 'runtime-token-value-123456'
const workspaceId = 'workspace_1'

interface CapturedCallback {
    url: string
    body: Record<string, unknown>
}

async function makeHostedConfig() {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'agent-room-file-callback-')))
    const config = createTestPiRuntimeConfig({ root })
    await ensureTestPiRuntimeDirectories(config)
    return config
}

describe('runtime event appender hosted file callback', () => {
    const previousEnv: Record<string, string | undefined> = {}

    beforeEach(() => {
        for (const key of [
            hostedRuntimeFileCallbackUrlEnvKey,
            hostedRuntimeUsageCallbackTokenEnvKey,
            hostedRuntimeWorkspaceIdEnvKey,
        ]) {
            previousEnv[key] = process.env[key]
        }
        process.env[hostedRuntimeFileCallbackUrlEnvKey] = fileCallbackUrl
        process.env[hostedRuntimeUsageCallbackTokenEnvKey] = callbackToken
        process.env[hostedRuntimeWorkspaceIdEnvKey] = workspaceId
    })

    afterEach(() => {
        for (const [key, value] of Object.entries(previousEnv)) {
            if (value === undefined) {
                delete process.env[key]
            } else {
                process.env[key] = value
            }
        }
        vi.unstubAllGlobals()
    })

    it('posts the created workspace file to the hosted file callback', async () => {
        const config = await makeHostedConfig()
        const relativePath = 'poem.txt'
        const absolutePath = join(config.paths.workspaceDir, relativePath)
        const content = Buffer.from('roses are red\n')
        await writeFile(absolutePath, content)

        const captured: CapturedCallback[] = []
        const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
            captured.push({
                url,
                body: JSON.parse(String(init.body)) as Record<string, unknown>,
            })
            return new Response(JSON.stringify({ ok: true }), { status: 200 })
        })
        vi.stubGlobal('fetch', fetchMock)

        const appendRuntimeEvent = createRuntimeEventAppender({
            config,
            redactPayload: (payload) => payload,
            broadcast: () => {},
        })

        await appendRuntimeEvent('tool.write', {
            path: absolutePath,
            byteLength: content.byteLength,
            fileChange: {
                kind: 'write',
                root: 'workspace',
                path: absolutePath,
                beforeSha256: null,
                afterSha256: sha256Buffer(content),
                byteLength: content.byteLength,
            },
        })

        const fileCallbacks = captured.filter((call) => call.url === fileCallbackUrl)
        expect(fileCallbacks).toHaveLength(1)
        const file = fileCallbacks[0]!.body.file as Record<string, unknown>
        expect(file).toMatchObject({
            surface: 'workspace',
            relativePath,
        })
        expect(Buffer.from(String(file.contentBase64), 'base64url').toString('utf8')).toBe(
            content.toString('utf8'),
        )
    })

    it('posts the created file even when the workspace is reached through a symlinked mount', async () => {
        const realRoot = await realpath(
            await mkdtemp(join(tmpdir(), 'agent-room-file-callback-real-')),
        )
        const linkRoot = `${realRoot}-link`
        await symlink(realRoot, linkRoot)
        const config = createTestPiRuntimeConfig({ root: linkRoot })
        await ensureTestPiRuntimeDirectories(config)

        const relativePath = 'recovered.txt'
        const absoluteThroughLink = join(config.paths.workspaceDir, relativePath)
        const content = Buffer.from('recovered contents\n')
        await writeFile(absoluteThroughLink, content)
        const canonicalPath = await realpath(absoluteThroughLink)
        expect(canonicalPath).not.toBe(absoluteThroughLink)

        const captured: CapturedCallback[] = []
        const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
            captured.push({
                url,
                body: JSON.parse(String(init.body)) as Record<string, unknown>,
            })
            return new Response(JSON.stringify({ ok: true }), { status: 200 })
        })
        vi.stubGlobal('fetch', fetchMock)

        const appendRuntimeEvent = createRuntimeEventAppender({
            config,
            redactPayload: (payload) => payload,
            broadcast: () => {},
        })

        await appendRuntimeEvent('tool.write', {
            path: canonicalPath,
            byteLength: content.byteLength,
            fileChange: {
                kind: 'write',
                root: 'workspace',
                path: canonicalPath,
                beforeSha256: null,
                afterSha256: sha256Buffer(content),
                byteLength: content.byteLength,
            },
        })

        const fileCallbacks = captured.filter((call) => call.url === fileCallbackUrl)
        expect(fileCallbacks).toHaveLength(1)
        expect(fileCallbacks[0]!.body.file).toMatchObject({
            surface: 'workspace',
            relativePath,
        })
    })
})
