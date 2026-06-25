import type { D1Database, R2Bucket } from '@cloudflare/workers-types'
import { describe, expect, it, vi } from 'vitest'
import type { AgentRoomHostedEnv } from './bindings'
import {
    deleteHostedRoomIndexedFile,
    upsertHostedRoomRuntimeFile,
    writeHostedRoomUploadedFile,
} from './hosted-file-store'

interface HostedFileIndexRow {
    workspaceId: string
    roomId: string
    surface: string
    relativePath: string
    objectKey: string
    kind: 'file' | 'directory'
    byteLength: number | null
    mediaType: string | null
    createdAt: string
    updatedAt: string
}

function hostedEnv(): {
    env: AgentRoomHostedEnv
    rows: HostedFileIndexRow[]
    objects: Map<string, Uint8Array>
    failDeletes: Set<string>
} {
    const rows: HostedFileIndexRow[] = []
    const objects = new Map<string, Uint8Array>()
    const failDeletes = new Set<string>()
    const db = {
        prepare: (sql: string) => ({
            bind: (...args: unknown[]) => ({
                first: async <T>() => {
                    if (/FROM hosted_room\b/.test(sql)) {
                        return { present: 1 } as T
                    }
                    if (/kind = 'file'[\s\S]*relative_path IN/.test(sql)) {
                        const ancestorPaths = args.slice(3).map(String)
                        return (rows.find(
                            (row) =>
                                row.workspaceId === args[0] &&
                                row.roomId === args[1] &&
                                row.surface === args[2] &&
                                row.kind === 'file' &&
                                ancestorPaths.includes(row.relativePath),
                        ) ?? null) as T | null
                    }
                    if (/SELECT 1\s+FROM hosted_room_file_index/.test(sql)) {
                        const row = rows.find(
                            (entry) =>
                                entry.workspaceId === args[0] &&
                                entry.roomId === args[1] &&
                                entry.surface === args[2] &&
                                entry.relativePath === args[3],
                        )
                        return (row ? { present: 1 } : null) as T | null
                    }
                    if (/FROM hosted_room_file_index/.test(sql)) {
                        const row = rows.find(
                            (entry) =>
                                entry.workspaceId === args[0] &&
                                entry.roomId === args[1] &&
                                entry.surface === args[2] &&
                                entry.relativePath === args[3] &&
                                (!/kind = 'file'/.test(sql) || entry.kind === 'file'),
                        )
                        return (row ?? null) as T | null
                    }
                    return null
                },
                all: async <T>() => ({
                    results: rows as T[],
                }),
                run: async () => {
                    const changes = runStatement(sql, args, rows)
                    return {
                        meta: {
                            changes,
                        },
                    }
                },
            }),
        }),
        batch: async (statements: Array<{ run: () => Promise<unknown> }>) => {
            const results = []
            for (const statement of statements) {
                results.push(await statement.run())
            }
            return results
        },
    } as unknown as D1Database

    return {
        env: {
            AGENT_ROOM_DB: db,
            AGENT_ROOM_WORKSPACE_BUCKET: {
                put: async (key: string, value: ArrayBuffer | ArrayBufferView | string) => {
                    objects.set(
                        key,
                        typeof value === 'string'
                            ? new TextEncoder().encode(value)
                            : value instanceof ArrayBuffer
                              ? new Uint8Array(value)
                              : new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
                    )
                    return null
                },
                delete: async (key: string | string[]) => {
                    for (const entry of Array.isArray(key) ? key : [key]) {
                        if (failDeletes.has(entry)) {
                            throw new Error(`delete failed: ${entry}`)
                        }
                        objects.delete(entry)
                    }
                },
            } as unknown as R2Bucket,
            AGENT_ROOM_RUNTIME_JOBS: {} as AgentRoomHostedEnv['AGENT_ROOM_RUNTIME_JOBS'],
            AGENT_ROOM_RUNTIME: {} as AgentRoomHostedEnv['AGENT_ROOM_RUNTIME'],
            AGENT_ROOM_AUTH_MODE: 'better-auth',
            AGENT_ROOM_BILLING_PLANS:
                '[{"key":"starter","priceId":"price_test_starter_000000","monthlyCents":700,"includedCents":0}]',
            AGENT_ROOM_BILLING_USAGE_MARKUP_BPS: '13000',
            AGENT_ROOM_BILLING_TAX_MODE: 'automatic',
            AGENT_ROOM_BILLING_MAX_CONCURRENT_ROOMS: '3',
            AGENT_ROOM_RUNTIME_BACKEND: 'cloudflare-containers',
            AGENT_ROOM_RUNTIME_STORAGE: 'r2',
            BETTER_AUTH_SECRET: 'a'.repeat(32),
            BETTER_AUTH_URL: 'https://rooms.example.test',
            AGENT_ROOM_HOSTED_ENCRYPTION_KEY_B64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
            STRIPE_SECRET_KEY: 'stripe-secret-test-value',
            STRIPE_WEBHOOK_SECRET: 'stripe-webhook-test-value',
            STRIPE_CREDIT_TOPUP_PRICE_ID: 'price_test_topup_000000',
            AGENT_ROOM_EMAIL_WEBHOOK_URL: 'https://mail.example.test/send',
            AGENT_ROOM_EMAIL_WEBHOOK_BEARER_TOKEN: 'b'.repeat(16),
            AGENT_ROOM_EMAIL_FROM: 'Agent Room <noreply@example.test>',
            AGENT_ROOM_HOSTED_OPENROUTER_API_KEY: 'openrouter-platform-key',
            AGENT_ROOM_HOSTED_BRAVE_API_KEY: 'brave-platform-key',
        },
        rows,
        objects,
        failDeletes,
    }
}

function runStatement(sql: string, args: unknown[], rows: HostedFileIndexRow[]): number {
    if (/DELETE FROM hosted_room_file_index/.test(sql)) {
        const existingIndex = /object_key = \?3/.test(sql)
            ? rows.findIndex(
                  (entry) =>
                      entry.workspaceId === args[0] &&
                      entry.roomId === args[1] &&
                      entry.objectKey === args[2] &&
                      entry.kind === 'file',
              )
            : rows.findIndex(
                  (entry) =>
                      entry.workspaceId === args[0] &&
                      entry.roomId === args[1] &&
                      entry.surface === args[2] &&
                      entry.relativePath === args[3] &&
                      (!/object_key = \?5/.test(sql) || entry.objectKey === args[4]) &&
                      entry.kind === 'file',
              )
        if (existingIndex < 0) {
            return 0
        }
        rows.splice(existingIndex, 1)
        return 1
    }
    if (!/INSERT INTO hosted_room_file_index/.test(sql)) {
        return 1
    }
    const directory = /'directory'/.test(sql)
    const row: HostedFileIndexRow = {
        workspaceId: String(args[0]),
        roomId: String(args[1]),
        surface: String(args[2]),
        relativePath: String(args[3]),
        objectKey: directory ? '' : String(args[4]),
        kind: directory ? 'directory' : 'file',
        byteLength: directory || args[5] === null ? null : Number(args[5]),
        mediaType: directory || args[6] === null ? null : String(args[6]),
        createdAt: String(directory ? args[4] : args[7]),
        updatedAt: String(directory ? args[4] : args[7]),
    }
    const existingIndex = rows.findIndex(
        (entry) =>
            entry.workspaceId === row.workspaceId &&
            entry.roomId === row.roomId &&
            entry.surface === row.surface &&
            entry.relativePath === row.relativePath,
    )
    if (existingIndex < 0) {
        rows.push(row)
        return 1
    }
    const existing = rows[existingIndex]
    if (/ON CONFLICT/.test(sql) && existing.kind === 'directory' && row.kind === 'file') {
        rows[existingIndex] = {
            ...existing,
            objectKey: row.objectKey,
            kind: 'file',
            byteLength: row.byteLength,
            mediaType: row.mediaType,
            updatedAt: row.updatedAt,
        }
        return 1
    }
    if (/ON CONFLICT/.test(sql) && existing.kind === 'file' && row.kind === 'file') {
        rows[existingIndex] = {
            ...existing,
            objectKey: row.objectKey,
            byteLength: row.byteLength,
            mediaType: row.mediaType,
            updatedAt: row.updatedAt,
        }
        return 1
    }
    if (/ON CONFLICT/.test(sql) && existing.kind === 'directory' && row.kind === 'directory') {
        existing.updatedAt = row.updatedAt
        return 1
    }
    if (/ON CONFLICT/.test(sql) && existing.kind === 'file' && row.kind === 'directory') {
        return 0
    }
    throw new Error('constraint failed')
}

function fileRow(relativePath: string): HostedFileIndexRow {
    return {
        workspaceId: 'workspace_1',
        roomId: 'room_1',
        surface: 'workspace',
        relativePath,
        objectKey: `object:${relativePath}`,
        kind: 'file',
        byteLength: 4,
        mediaType: 'text/plain',
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
    }
}

describe('hosted file index', () => {
    it('rejects uploads below an existing file path and deletes the pending object', async () => {
        const store = hostedEnv()
        store.rows.push(fileRow('docs'))
        store.objects.set('object:docs', new TextEncoder().encode('docs'))

        await expect(
            writeHostedRoomUploadedFile({
                env: store.env,
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                surface: 'workspace',
                relativeDirectory: 'docs',
                fileName: 'report.txt',
                content: new TextEncoder().encode('text'),
            }),
        ).rejects.toThrow(/already a file/)

        expect([...store.objects.keys()]).toEqual(['object:docs'])
    })

    it('rejects runtime sync below an existing file path and deletes the pending object', async () => {
        const store = hostedEnv()
        store.rows.push(fileRow('docs'))
        store.objects.set('object:docs', new TextEncoder().encode('docs'))

        await expect(
            upsertHostedRoomRuntimeFile({
                env: store.env,
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                surface: 'workspace',
                relativePath: 'docs/report.txt',
                content: new TextEncoder().encode('text'),
            }),
        ).rejects.toThrow(/already a file/)

        expect([...store.objects.keys()]).toEqual(['object:docs'])
    })

    it('rejects a file ancestor race when the directory upsert no-ops', async () => {
        const store = hostedEnv()
        const originalBatch = store.env.AGENT_ROOM_DB.batch.bind(store.env.AGENT_ROOM_DB)
        store.env.AGENT_ROOM_DB.batch = async (statements) => {
            store.rows.push(fileRow('docs'))
            store.objects.set('object:docs', new TextEncoder().encode('docs'))
            return originalBatch(statements)
        }

        await expect(
            writeHostedRoomUploadedFile({
                env: store.env,
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                surface: 'workspace',
                relativeDirectory: 'docs',
                fileName: 'report.txt',
                content: new TextEncoder().encode('text'),
            }),
        ).rejects.toThrow(/already a file/)

        expect(store.rows.map((row) => `${row.kind}:${row.relativePath}`)).toEqual(['file:docs'])
        expect([...store.objects.keys()]).toEqual(['object:docs'])
    })

    it('removes the index row even when object cleanup fails', async () => {
        const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const store = hostedEnv()
        store.rows.push(fileRow('docs/report.txt'))
        store.objects.set('object:docs/report.txt', new TextEncoder().encode('text'))
        store.failDeletes.add('object:docs/report.txt')

        try {
            await expect(
                deleteHostedRoomIndexedFile({
                    env: store.env,
                    workspaceId: 'workspace_1',
                    roomId: 'room_1',
                    surface: 'workspace',
                    relativePath: 'docs/report.txt',
                }),
            ).resolves.toBeUndefined()

            expect(store.rows).toEqual([])
            expect([...store.objects.keys()]).toEqual(['object:docs/report.txt'])
            expect(consoleWarn).toHaveBeenCalledWith(
                'Hosted file object cleanup failed: delete failed: object:docs/report.txt',
            )
        } finally {
            consoleWarn.mockRestore()
        }
    })

    it('persists runtime upsert success when stale object cleanup fails', async () => {
        const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const store = hostedEnv()
        store.rows.push(fileRow('docs/report.txt'))
        store.objects.set('object:docs/report.txt', new TextEncoder().encode('old'))
        store.failDeletes.add('object:docs/report.txt')

        try {
            await expect(
                upsertHostedRoomRuntimeFile({
                    env: store.env,
                    workspaceId: 'workspace_1',
                    roomId: 'room_1',
                    surface: 'workspace',
                    relativePath: 'docs/report.txt',
                    content: new TextEncoder().encode('new'),
                }),
            ).resolves.toMatchObject({
                relativePath: 'docs/report.txt',
                byteLength: 3,
            })

            const indexed = store.rows.find((row) => row.relativePath === 'docs/report.txt')
            expect(indexed?.objectKey).not.toBe('object:docs/report.txt')
            expect([...store.objects.keys()]).toContain('object:docs/report.txt')
            expect(consoleWarn).toHaveBeenCalledWith(
                'Hosted stale file object cleanup failed: delete failed: object:docs/report.txt',
            )
        } finally {
            consoleWarn.mockRestore()
        }
    })
})
