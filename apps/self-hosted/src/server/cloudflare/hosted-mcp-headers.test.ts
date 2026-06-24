import type { D1Database, R2Bucket } from '@cloudflare/workers-types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentRoomHostedEnv } from './bindings'
import type { HostedActor } from './hosted-auth'
import { saveHostedMcpConnection } from './hosted-operator-config-write-service'

interface SavedSecretRow {
    id: string
    workspaceId: string
    keyName: string
    cipherText: string
    nonce: string
    authTag: string
    keyVersion: number
    createdAt: string
    updatedAt: string
}

interface SavedMcpRow {
    id: string
    workspaceId: string
    name: string
    serverKey: string
    transport: string
    command: string | null
    args: string
    url: string | null
    headers: string
    authMode: string
    credentialSecretId: string | null
    allowedTools: string
    status: string
    validationMessage: string
    lastValidatedAt: string
    createdByUserId: string
    createdAt: string
    updatedAt: string
}

function hostedEnv(): {
    env: AgentRoomHostedEnv
    dump: () => {
        secrets: SavedSecretRow[]
        mcpRows: SavedMcpRow[]
    }
} {
    const secrets: SavedSecretRow[] = []
    const mcpRows: SavedMcpRow[] = []
    const db = {
        prepare: (sql: string) => ({
            bind: (...args: unknown[]) => ({
                first: async () => {
                    if (/FROM hosted_secret/.test(sql) && /SELECT\s+cipher_text/.test(sql)) {
                        const secret = secrets.find(
                            (entry) => entry.workspaceId === args[0] && entry.id === args[1],
                        )
                        return secret
                            ? {
                                  cipherText: secret.cipherText,
                                  nonce: secret.nonce,
                                  authTag: secret.authTag,
                              }
                            : null
                    }
                    if (/FROM hosted_secret/.test(sql) && /SELECT id/.test(sql)) {
                        return (
                            secrets.find(
                                (secret) =>
                                    secret.workspaceId === args[0] && secret.keyName === args[1],
                            ) ?? null
                        )
                    }
                    if (/FROM hosted_mcp_connection/.test(sql)) {
                        return (
                            mcpRows.find(
                                (row) => row.workspaceId === args[0] && row.id === args[1],
                            ) ?? null
                        )
                    }
                    return null
                },
                all: async () => ({
                    results: [],
                }),
                run: async () => {
                    if (/INSERT INTO hosted_secret/.test(sql)) {
                        secrets.push({
                            id: String(args[0]),
                            workspaceId: String(args[1]),
                            keyName: String(args[2]),
                            cipherText: String(args[3]),
                            nonce: String(args[4]),
                            authTag: String(args[5]),
                            keyVersion: Number(args[6]),
                            createdAt: String(args[7]),
                            updatedAt: String(args[7]),
                        })
                        return {
                            meta: {
                                changes: 1,
                            },
                        }
                    }
                    if (/UPDATE hosted_secret/.test(sql)) {
                        const existing = secrets.find(
                            (secret) => secret.workspaceId === args[5] && secret.id === args[6],
                        )
                        if (existing) {
                            existing.cipherText = String(args[0])
                            existing.nonce = String(args[1])
                            existing.authTag = String(args[2])
                            existing.keyVersion = Number(args[3])
                            existing.updatedAt = String(args[4])
                        }
                        return {
                            meta: {
                                changes: existing ? 1 : 0,
                            },
                        }
                    }
                    if (/UPDATE hosted_mcp_connection\s+SET headers/.test(sql)) {
                        const existing = mcpRows.find(
                            (row) => row.workspaceId === args[2] && row.id === args[3],
                        )
                        if (existing) {
                            existing.headers = String(args[0])
                            existing.updatedAt = String(args[1])
                        }
                        return {
                            meta: {
                                changes: existing ? 1 : 0,
                            },
                        }
                    }
                    if (/INSERT INTO hosted_mcp_connection/.test(sql)) {
                        const existingIndex = mcpRows.findIndex((row) => row.id === args[0])
                        const existing = existingIndex >= 0 ? mcpRows[existingIndex] : null
                        const row: SavedMcpRow = {
                            id: String(args[0]),
                            workspaceId: String(args[1]),
                            name: String(args[2]),
                            serverKey: String(args[3]),
                            transport: String(args[4]),
                            command: args[5] === null ? null : String(args[5]),
                            args: String(args[6]),
                            url: args[7] === null ? null : String(args[7]),
                            headers: String(args[8]),
                            authMode: String(args[9]),
                            credentialSecretId: args[10] === null ? null : String(args[10]),
                            allowedTools: String(args[11]),
                            status: String(args[12]),
                            validationMessage: String(args[13]),
                            lastValidatedAt: String(args[14]),
                            createdByUserId: existing?.createdByUserId ?? String(args[15]),
                            createdAt: existing?.createdAt ?? String(args[14]),
                            updatedAt: String(args[14]),
                        }
                        if (existingIndex >= 0) {
                            mcpRows[existingIndex] = row
                        } else {
                            mcpRows.push(row)
                        }
                        return {
                            meta: {
                                changes: 1,
                            },
                        }
                    }
                    return {
                        meta: {
                            changes: 0,
                        },
                    }
                },
            }),
        }),
    } as unknown as D1Database

    return {
        env: {
            AGENT_ROOM_DB: db,
            AGENT_ROOM_WORKSPACE_BUCKET: {} as R2Bucket,
            AGENT_ROOM_RUNTIME_JOBS: {} as AgentRoomHostedEnv['AGENT_ROOM_RUNTIME_JOBS'],
            AGENT_ROOM_RUNTIME: {} as AgentRoomHostedEnv['AGENT_ROOM_RUNTIME'],
            AGENT_ROOM_AUTH_MODE: 'better-auth',
            AGENT_ROOM_BILLING_MODE: 'disabled',
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
            AGENT_ROOM_EMAIL_WEBHOOK_URL: 'https://mail.example.test/send',
            AGENT_ROOM_EMAIL_WEBHOOK_BEARER_TOKEN: 'b'.repeat(16),
            AGENT_ROOM_EMAIL_FROM: 'Agent Room <noreply@example.test>',
            AGENT_ROOM_HOSTED_OPENROUTER_API_KEY: 'openrouter-platform-key',
        },
        dump: () => ({
            secrets,
            mcpRows,
        }),
    }
}

function actor(): HostedActor {
    return {
        authProvider: 'better-auth',
        userId: 'user_1',
        sessionId: 'session_1',
        email: 'user@example.test',
        workspaceId: 'workspace_1',
    }
}

describe('hosted MCP header storage', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    function stubMcpInitialize() {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = input instanceof Request ? input.url : String(input)
                if (url.startsWith('https://cloudflare-dns.com/dns-query')) {
                    return new Response(
                        JSON.stringify({
                            Answer: [
                                {
                                    type: url.includes('type=A') ? 1 : 28,
                                    data: url.includes('type=A') ? '203.0.113.10' : '2001:db8::10',
                                },
                            ],
                        }),
                        {
                            headers: {
                                'content-type': 'application/json',
                            },
                        },
                    )
                }
                return new Response('{"jsonrpc":"2.0","id":1,"result":{}}')
            }),
        )
    }

    it('stores header values as hosted secrets and preserves redacted existing headers', async () => {
        stubMcpInitialize()
        const store = hostedEnv()
        const created = await saveHostedMcpConnection({
            env: store.env,
            actor: actor(),
            data: {
                name: 'HTTP MCP',
                serverKey: 'http-mcp',
                transport: 'http',
                url: 'https://mcp.example.test',
                headersText: JSON.stringify({
                    Authorization: 'Bearer secret-value',
                }),
                authMode: 'none',
            },
        })
        const firstRow = store.dump().mcpRows[0]
        const firstHeaders = JSON.parse(firstRow.headers) as Record<string, string>
        const firstSecretRef = firstHeaders.Authorization

        expect(created.headers).toEqual({
            Authorization: '********',
        })
        expect(created.status).toBe('ready')
        expect(firstSecretRef).toMatch(/^hosted-secret:/)
        expect(firstRow.headers).not.toContain('secret-value')
        expect(JSON.stringify(store.dump().secrets)).not.toContain('secret-value')

        await saveHostedMcpConnection({
            env: store.env,
            actor: actor(),
            data: {
                id: created.id,
                name: 'HTTP MCP',
                serverKey: 'http-mcp',
                transport: 'http',
                url: 'https://mcp.example.test',
                headersText: JSON.stringify({
                    Authorization: '********',
                }),
                authMode: 'none',
            },
        })
        const secondHeaders = JSON.parse(store.dump().mcpRows[0].headers) as Record<string, string>

        expect(secondHeaders.Authorization).toBe(firstSecretRef)
        expect(store.dump().secrets).toHaveLength(1)
    })

    it('migrates legacy plaintext headers before preserving redacted edits', async () => {
        stubMcpInitialize()
        const store = hostedEnv()
        store.dump().mcpRows.push({
            id: 'mcp_legacy',
            workspaceId: 'workspace_1',
            name: 'Legacy HTTP MCP',
            serverKey: 'legacy-http-mcp',
            transport: 'http',
            command: null,
            args: '[]',
            url: 'https://mcp.example.test',
            headers: JSON.stringify({
                Authorization: 'Bearer legacy-secret',
            }),
            authMode: 'none',
            credentialSecretId: null,
            allowedTools: '[]',
            status: 'ready',
            validationMessage: 'Legacy MCP connection',
            lastValidatedAt: new Date(0).toISOString(),
            createdByUserId: 'user_1',
            createdAt: new Date(0).toISOString(),
            updatedAt: new Date(0).toISOString(),
        })

        await saveHostedMcpConnection({
            env: store.env,
            actor: actor(),
            data: {
                id: 'mcp_legacy',
                name: 'Legacy HTTP MCP',
                serverKey: 'legacy-http-mcp',
                transport: 'http',
                url: 'https://mcp.example.test',
                headersText: JSON.stringify({
                    Authorization: '********',
                }),
                authMode: 'none',
            },
        })

        const row = store.dump().mcpRows[0]
        const headers = JSON.parse(row.headers) as Record<string, string>
        expect(headers.Authorization).toMatch(/^hosted-secret:/)
        expect(row.headers).not.toContain('legacy-secret')
        expect(store.dump().secrets).toHaveLength(1)
    })
})
