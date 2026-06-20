import type { D1Database, R2Bucket } from '@cloudflare/workers-types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentRoomHostedEnv } from './bindings'
import { sendHostedAuthEmail } from './hosted-email'

function hostedEnv(overrides: Partial<AgentRoomHostedEnv> = {}): AgentRoomHostedEnv {
    return {
        AGENT_ROOM_DB: {} as D1Database,
        AGENT_ROOM_WORKSPACE_BUCKET: {} as R2Bucket,
        AGENT_ROOM_RUNTIME_JOBS: {} as AgentRoomHostedEnv['AGENT_ROOM_RUNTIME_JOBS'],
        AGENT_ROOM_RUNTIME: {} as AgentRoomHostedEnv['AGENT_ROOM_RUNTIME'],
        AGENT_ROOM_AUTH_MODE: 'better-auth',
        AGENT_ROOM_RUNTIME_BACKEND: 'cloudflare-containers',
        AGENT_ROOM_RUNTIME_STORAGE: 'r2',
        BETTER_AUTH_SECRET: 'a'.repeat(32),
        BETTER_AUTH_URL: 'https://rooms.example.test',
        GOOGLE_CLIENT_ID: 'google-client',
        GOOGLE_CLIENT_SECRET: 'google-secret',
        AGENT_ROOM_EMAIL_WEBHOOK_URL: 'https://mail.example.test/api/v1/emails',
        AGENT_ROOM_EMAIL_WEBHOOK_BEARER_TOKEN: 'b'.repeat(16),
        AGENT_ROOM_EMAIL_FROM: 'Agent Room <noreply@example.test>',
        ...overrides,
    }
}

describe('hosted auth email delivery', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('sends auth email through the configured Resend-compatible endpoint', async () => {
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
            return new Response(null, { status: 202 })
        })
        vi.stubGlobal('fetch', fetchMock)

        await sendHostedAuthEmail(hostedEnv(), {
            purpose: 'email_verification',
            to: 'user@example.test',
            subject: 'Verify <Agent Room>',
            actionUrl:
                'https://rooms.example.test/api/auth/verify?token=abc&email=user@example.test',
            metadata: {
                userId: 'user_1',
            },
        })

        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(fetchMock).toHaveBeenCalledWith('https://mail.example.test/api/v1/emails', {
            method: 'POST',
            headers: {
                authorization: `Bearer ${'b'.repeat(16)}`,
                'content-type': 'application/json',
            },
            body: expect.any(String),
        })

        const fetchCall = fetchMock.mock.calls[0]
        expect(fetchCall).toBeDefined()
        const requestInit = fetchCall[1]
        const body = JSON.parse(requestInit?.body as string) as Record<string, string>
        expect(body).toMatchObject({
            from: 'Agent Room <noreply@example.test>',
            to: 'user@example.test',
            subject: 'Verify <Agent Room>',
        })
        expect(body.html).toContain('Verify &lt;Agent Room&gt;')
        expect(body.html).toContain(
            'https://rooms.example.test/api/auth/verify?token=abc&amp;email=user@example.test',
        )
        expect(body.text).toContain(
            'https://rooms.example.test/api/auth/verify?token=abc&email=user@example.test',
        )
        expect(body).not.toHaveProperty('metadata')
        expect(body).not.toHaveProperty('purpose')
    })

    it('fails closed when the email endpoint rejects the message', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(null, { status: 401 })),
        )

        await expect(
            sendHostedAuthEmail(hostedEnv(), {
                purpose: 'password_reset',
                to: 'user@example.test',
                subject: 'Reset your password',
                actionUrl: 'https://rooms.example.test/reset',
                metadata: {
                    userId: 'user_1',
                },
            }),
        ).rejects.toThrow(/status 401/)
    })
})
