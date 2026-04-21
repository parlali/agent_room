import { describe, expect, it } from 'vitest'
import { __testing, extractOpenAICodexAuthUrl } from './codex-oauth-flow'

describe('codex oauth flow helpers', () => {
    it('extracts the OpenAI Codex authorization URL from OpenClaw terminal output', () => {
        const output =
            '\u001b[32mOAuth URL ready\u001b[39m\n\nOpen this URL in your LOCAL browser:\n\nhttps://auth.openai.com/oauth/authorize?response_type=code&client_id=app_EMoamEEZ73f0CkXaXp7hrann&state=abc&code_challenge=xyz\n'

        expect(extractOpenAICodexAuthUrl(output)).toBe(
            'https://auth.openai.com/oauth/authorize?response_type=code&client_id=app_EMoamEEZ73f0CkXaXp7hrann&state=abc&code_challenge=xyz',
        )
    })

    it('decodes child process byte chunks before parsing terminal output', () => {
        expect(__testing.chunkToText(new Uint8Array([79, 65, 117, 116, 104]))).toBe('OAuth')
    })

    it('accepts full redirect URLs with code and state parameters', () => {
        expect(
            __testing.validateRedirectUrlValue(
                'http://localhost:1455/auth/callback?code=abc&state=expected',
            ),
        ).toBe('http://localhost:1455/auth/callback?code=abc&state=expected')
    })

    it('rejects redirect URLs missing OAuth state', () => {
        expect(() =>
            __testing.validateRedirectUrlValue('http://localhost:1455/auth/callback?code=abc'),
        ).toThrow('Redirect URL must include code and state parameters')
    })

    it('uses a bounded expect bridge for URL capture and redirect passback', () => {
        expect(__testing.openClawOAuthExpectScript).toContain('expect_user')
        expect(__testing.openClawOAuthExpectScript).toContain('flush stdout')
        expect(__testing.openClawOAuthExpectScript).toContain('AGENT_ROOM_CODEX_OAUTH_URL_FILE')
        expect(__testing.openClawOAuthExpectScript).toContain('send -- "$expect_out(1,string)')
        expect(__testing.openClawOAuthExpectScript).not.toContain('interact')
    })
})
