import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { createRuntimeEventAppender } from './runtime-event-log'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'

function testConfig(root: string): PiRuntimeConfig {
    const roomRootDir = join(root, 'rooms', 'r-opaque')
    return {
        runtime: {
            roomId: '11111111-1111-4111-8111-111111111111',
            displayName: 'Test Room',
        },
        paths: {
            roomRootDir,
            runtimeEventsPath: join(root, 'runtime-events.jsonl'),
            workspaceDir: join(roomRootDir, 'workspace'),
            storeDir: join(roomRootDir, 'store'),
        },
    } as PiRuntimeConfig
}

describe('runtime event log', () => {
    it('summarizes streaming text deltas instead of persisting repeated text bodies', async () => {
        const root = await mkdtemp(join(tmpdir(), 'agent-room-events-'))
        const append = createRuntimeEventAppender({
            config: testConfig(root),
            redactPayload: (payload) => payload,
            broadcast: () => {},
        })

        await append('message_update', {
            sessionKey: 'thread-1',
            event: {
                type: 'message_update',
                assistantMessageEvent: {
                    type: 'text_delta',
                    contentIndex: 0,
                    delta: 'secret streamed text',
                },
            },
        })

        const line = (await readFile(join(root, 'runtime-events.jsonl'), 'utf8')).trim()
        const entry = JSON.parse(line)
        expect(JSON.stringify(entry)).not.toContain('secret streamed text')
        expect(entry.payload.event.assistantMessageEvent).toEqual({
            type: 'text_delta',
            contentIndex: 0,
            textLength: 20,
        })
    })

    it('rotates the event log before appending when the active file is too large', async () => {
        const root = await mkdtemp(join(tmpdir(), 'agent-room-events-'))
        const config = testConfig(root)
        await writeFile(config.paths.runtimeEventsPath, 'x'.repeat(5 * 1024 * 1024 + 1))
        const append = createRuntimeEventAppender({
            config,
            redactPayload: (payload) => payload,
            broadcast: () => {},
        })

        await append('runtime.started', {
            roomId: config.runtime.roomId,
        })

        const rotated = await stat(`${config.paths.runtimeEventsPath}.1`)
        const current = await readFile(config.paths.runtimeEventsPath, 'utf8')
        expect(rotated.size).toBe(5 * 1024 * 1024 + 1)
        expect(current).toContain('runtime.started')
    })

    it('broadcasts file changes for legacy absolute room-id paths', async () => {
        const root = await mkdtemp(join(tmpdir(), 'agent-room-events-'))
        const config = testConfig(root)
        const broadcasts: unknown[] = []
        const append = createRuntimeEventAppender({
            config,
            redactPayload: (payload) => payload,
            broadcast: (_sessionKey, _event, payload) => broadcasts.push(payload),
        })
        const legacyPath = join(
            dirname(config.paths.roomRootDir),
            config.runtime.roomId,
            'workspace',
            'notes.md',
        )

        await append('tool.write', {
            fileChange: {
                kind: 'write',
                root: 'workspace',
                path: legacyPath,
                byteLength: 5,
            },
        })

        expect(broadcasts).toEqual([
            expect.objectContaining({
                roomId: config.runtime.roomId,
                surface: 'workspace',
                relativePath: 'notes.md',
                operation: 'write',
                byteLength: 5,
            }),
        ])
    })
})
