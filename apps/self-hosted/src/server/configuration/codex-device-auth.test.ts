import { describe, expect, it } from 'vitest'
import { __testing } from './codex-device-auth'

describe('Codex device auth helpers', () => {
    it('extracts OpenAI verification URL and code from CLI output', () => {
        expect(
            __testing.extractDeviceAuthFields(
                'Open https://auth.openai.com/codex/device and enter code 123456',
            ),
        ).toEqual({
            verificationUrl: 'https://auth.openai.com/codex/device',
            userCode: '123456',
        })
    })

    it('strips terminal styling and does not parse words as device codes', () => {
        expect(
            __testing.extractDeviceAuthFields(
                '\u001B[32mTo authorize, open https://auth.openai.com/codex/device\u001B[0m and enter code 654321',
            ),
        ).toEqual({
            verificationUrl: 'https://auth.openai.com/codex/device',
            userCode: '654321',
        })

        expect(
            __testing.extractDeviceAuthFields(
                'To authorize, open https://auth.openai.com/codex/device',
            ),
        ).toEqual({
            verificationUrl: 'https://auth.openai.com/codex/device',
            userCode: null,
        })
    })

    it('extracts current Codex CLI alphanumeric device codes', () => {
        expect(
            __testing.extractDeviceAuthFields(
                [
                    'Follow these steps to sign in with ChatGPT using device code authorization:',
                    '',
                    '1. Open this link in your browser and sign in to your account',
                    '   \u001B[94mhttps://auth.openai.com/codex/device\u001B[0m',
                    '',
                    '2. Enter this one-time code \u001B[90m(expires in 15 minutes)\u001B[0m',
                    '   \u001B[94mH1WM-MYASF\u001B[0m',
                ].join('\n'),
            ),
        ).toEqual({
            verificationUrl: 'https://auth.openai.com/codex/device',
            userCode: 'H1WM-MYASF',
        })
    })

    it('removes model provider keys from the Codex login process environment', () => {
        const env = __testing.childEnv('/tmp/codex-home')

        expect(env.CODEX_HOME).toBe('/tmp/codex-home')
        expect(env.HOME).toBe('/tmp/codex-home')
        expect(env.OPENAI_API_KEY).toBeUndefined()
        expect(env.OPENROUTER_API_KEY).toBeUndefined()
    })
})
