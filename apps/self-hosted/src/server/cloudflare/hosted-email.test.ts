import type { D1Database, R2Bucket } from '@cloudflare/workers-types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentRoomHostedEnv } from './bindings'
import { renderHostedAuthEmail, sendHostedAuthEmail, type HostedEmailPayload } from './hosted-email'

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
        AGENT_ROOM_EMAIL_WEBHOOK_URL: 'https://mail.example.test/send',
        AGENT_ROOM_EMAIL_WEBHOOK_BEARER_TOKEN: 'b'.repeat(16),
        AGENT_ROOM_EMAIL_FROM: 'Agent Room <hello@example.test>',
        ...overrides,
    }
}

function emailPayload(overrides: Partial<HostedEmailPayload> = {}): HostedEmailPayload {
    return {
        purpose: 'email_verification',
        to: 'parsa@example.test',
        subject: 'Verify your Agent Room email',
        actionUrl:
            'https://rooms.example.test/api/auth/verify-email?token=abc&callbackURL=https%3A%2F%2Frooms.example.test%2F',
        metadata: {
            userId: 'user_1',
        },
        ...overrides,
    }
}

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('hosted auth email rendering', () => {
    it('renders branded HTML with the marketing logo and safe fallback link', () => {
        const rendered = renderHostedAuthEmail(emailPayload())

        expect(rendered.html).toContain('<!doctype html>')
        expect(rendered.html).toContain('https://www.openagentroom.com/apple-touch-icon.png')
        expect(rendered.html).toContain('Confirm your Agent Room email')
        expect(rendered.html).toContain('Verify email')
        expect(rendered.html).toContain('Agent Room will never ask you to reply with your password')
        expect(rendered.html).toContain(
            'token=abc&amp;callbackURL=https%3A%2F%2Frooms.example.test%2F',
        )
        expect(rendered.text).toContain('Confirm your Agent Room email')
        expect(rendered.text).toContain(
            'https://rooms.example.test/api/auth/verify-email?token=abc&callbackURL=https%3A%2F%2Frooms.example.test%2F',
        )
        expect(rendered.text).toContain('Agent Room: https://www.openagentroom.com')
    })

    it('escapes user-controlled fields in HTML output', () => {
        const rendered = renderHostedAuthEmail(
            emailPayload({
                to: 'bad"<script>@example.test',
                actionUrl: 'https://rooms.example.test/reset?token="<script>',
            }),
        )

        expect(rendered.html).toContain('bad&quot;&lt;script&gt;@example.test')
        expect(rendered.html).toContain('token=&quot;&lt;script&gt;')
        expect(rendered.html).not.toContain('bad"<script>')
        expect(rendered.html).not.toContain('token="<script>')
    })

    it('uses purpose-specific copy for password resets and invitations', () => {
        expect(
            renderHostedAuthEmail(
                emailPayload({
                    purpose: 'password_reset',
                }),
            ).html,
        ).toContain('Reset your Agent Room password')

        expect(
            renderHostedAuthEmail(
                emailPayload({
                    purpose: 'organization_invitation',
                }),
            ).html,
        ).toContain('Join your Agent Room workspace')
    })
})

describe('hosted auth email delivery', () => {
    it('sends the rendered HTML and text through the configured webhook', async () => {
        const fetchMock = vi.fn<(...args: Parameters<typeof fetch>) => Promise<Response>>(
            async () => new Response(null, { status: 202 }),
        )
        vi.stubGlobal('fetch', fetchMock)

        await sendHostedAuthEmail(hostedEnv(), emailPayload())

        expect(fetchMock).toHaveBeenCalledOnce()
        expect(fetchMock).toHaveBeenCalledWith(
            'https://mail.example.test/send',
            expect.objectContaining({
                method: 'POST',
                headers: {
                    authorization: `Bearer ${'b'.repeat(16)}`,
                    'content-type': 'application/json',
                },
            }),
        )

        const requestInit = fetchMock.mock.calls[0]?.[1] as { body: string } | undefined
        const body = JSON.parse(requestInit?.body ?? '{}') as {
            from: string
            to: string
            subject: string
            html: string
            text: string
        }

        expect(body).toMatchObject({
            from: 'Agent Room <hello@example.test>',
            to: 'parsa@example.test',
            subject: 'Verify your Agent Room email',
        })
        expect(body.html).toContain('https://www.openagentroom.com/apple-touch-icon.png')
        expect(body.text).toContain('https://www.openagentroom.com')
    })
})
