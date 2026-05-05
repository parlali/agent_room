import { describe, expect, it } from 'vitest'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import { createRuntimeRedactor, isRecord } from './runtime-redaction'
import { createTestPiRuntimeConfig } from './test-runtime-defaults'

function testConfig(): PiRuntimeConfig {
    return createTestPiRuntimeConfig({
        runtime: {
            displayName: 'Room',
            port: 1234,
            token: 'runtime-secret',
        },
        provider: {
            sourceProvider: 'openai',
            sourceModel: 'gpt-test',
            piProvider: 'openai',
            piModel: 'gpt-test',
            api: 'openai-responses',
            authMode: 'api_key',
            fallbackModels: [],
            baseUrl: null,
            envKey: null,
            kind: 'builtin',
        },
        search: {
            backendUrl: 'http://127.0.0.1:8080',
            timeoutMs: 1000,
        },
        budgets: {
            manualTurnMs: 1000,
            scheduledTurnMs: 1000,
            subagentTurnMs: 1000,
            maintenanceTurnMs: 1000,
            idleTimeoutMs: 1000,
            providerIdleTimeoutMs: 1000,
            shellCommandMs: 1000,
            webFetchMs: 1000,
            documentWorkerMs: 1000,
            imageGenerationMs: 1000,
            mcpToolMs: 1000,
            shortCommandWaitMs: 1000,
        },
        compaction: {
            reserveTokens: 1000,
            keepRecentTokens: 1000,
        },
        mcpServers: [
            {
                id: 'mcp',
                provider: 'MCP',
                transport: 'streamable_http',
                command: null,
                args: [],
                url: 'http://127.0.0.1:3000/mcp',
                env: {},
                headers: {
                    Authorization: 'Bearer mcp-secret',
                },
                allowedTools: [],
            },
        ],
    })
}

describe('runtime redaction', () => {
    it('redacts runtime and bearer secrets from nested payloads', () => {
        const { redactPayload, errorMessage } = createRuntimeRedactor(testConfig())

        expect(
            redactPayload({
                runtime: 'runtime-secret',
                nested: {
                    bearer: 'Bearer mcp-secret',
                },
            }),
        ).toEqual({
            runtime: '[redacted]',
            nested: {
                bearer: '[redacted]',
            },
        })
        expect(errorMessage(new Error('bad runtime-secret'))).toBe('bad [redacted]')
    })

    it('identifies plain records without accepting arrays', () => {
        expect(isRecord({ ok: true })).toBe(true)
        expect(isRecord([])).toBe(false)
    })
})
