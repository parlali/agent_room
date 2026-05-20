import { describe, expect, it } from 'vitest'
import { capabilityConfigToJson, defaultCapabilities, mergeCapabilities } from './capabilities'

describe('runtime capability merging', () => {
    it('keeps programmer mode lean while allowing image generation', () => {
        const capabilities = mergeCapabilities({
            defaults: capabilityConfigToJson(defaultCapabilities),
            overrides: {},
            roomMode: 'programmer',
            mcpConnectionCount: 1,
        })

        expect(capabilities).toMatchObject({
            webSearch: true,
            urlFetch: true,
            shellCoding: true,
            images: true,
            documents: false,
            spreadsheets: false,
            presentations: false,
            pdf: false,
            mcp: true,
        })
    })
})
