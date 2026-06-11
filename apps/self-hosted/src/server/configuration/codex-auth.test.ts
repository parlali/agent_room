import { readFile, rm, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
    convertCodexCliAuthToPiCredential,
    inspectCodexAppAuthStatusSync,
    writeCodexPiAuthFromCliAuthSync,
} from './codex-auth'

function jwt(payload: Record<string, unknown>): string {
    const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
    return `${header}.${body}.signature`
}

describe('Codex app auth helpers', () => {
    it('converts official Codex CLI auth into Pi OAuth credentials', () => {
        const access = jwt({
            exp: 1990000000,
            'https://api.openai.com/auth': {
                chatgpt_account_id: 'account-from-token',
            },
        })

        const credential = convertCodexCliAuthToPiCredential({
            auth_mode: 'chatgpt',
            tokens: {
                access_token: access,
                refresh_token: 'refresh-token',
            },
        })

        expect(credential).toEqual({
            type: 'oauth',
            access,
            refresh: 'refresh-token',
            expires: 1990000000 * 1000,
            accountId: 'account-from-token',
        })
    })

    it('writes and inspects the app-level Pi auth file', async () => {
        const root = await mkdtemp(join(tmpdir(), 'agent-room-codex-auth-'))
        try {
            const authPath = join(root, 'auth.json')
            const access = jwt({ exp: 1990000000 })
            const status = writeCodexPiAuthFromCliAuthSync({
                authPath,
                cliAuthJson: JSON.stringify({
                    auth_mode: 'chatgpt',
                    tokens: {
                        access_token: access,
                        refresh_token: 'refresh-token',
                        account_id: 'account-from-file',
                    },
                }),
            })

            expect(status.ready).toBe(true)
            expect(status.accountId).toBe('account-from-file')
            expect(inspectCodexAppAuthStatusSync({ authPath })).toMatchObject({
                ready: true,
                status: 'ready',
                accountId: 'account-from-file',
            })
            await expect(readFile(authPath, 'utf8')).resolves.toContain('"openai-codex"')
        } finally {
            await rm(root, {
                recursive: true,
                force: true,
            })
        }
    })

    it('rejects expired app-level Pi auth credentials', async () => {
        const root = await mkdtemp(join(tmpdir(), 'agent-room-codex-auth-'))
        try {
            const authPath = join(root, 'auth.json')
            writeCodexPiAuthFromCliAuthSync({
                authPath,
                cliAuthJson: JSON.stringify({
                    auth_mode: 'chatgpt',
                    tokens: {
                        access_token: jwt({ exp: 1000000000 }),
                        refresh_token: 'refresh-token',
                        account_id: 'account-from-file',
                    },
                }),
                nowMs: 1000000000 * 1000,
            })

            expect(inspectCodexAppAuthStatusSync({ authPath })).toMatchObject({
                ready: false,
                status: 'invalid',
                message: 'Codex app server login is expired',
            })
        } finally {
            await rm(root, {
                recursive: true,
                force: true,
            })
        }
    })
})
