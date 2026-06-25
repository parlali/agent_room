import { createWebTools } from './web-tools'
import {
    type SearchProvider,
    type SearchProviderSearchInput,
    type SearchProviderResponse,
} from './web-search'
import { createTestPiRuntimeConfig } from './test-runtime-defaults'
import {
    hostedRuntimeUsageCallbackTokenEnvKey,
    piRuntimeTokenEnvKey,
} from '../rooms/pi-runtime-contract'

const originalFetch = globalThis.fetch
const originalBraveKey = process.env.AGENT_ROOM_SEARCH_BRAVE_API_KEY
const originalPiRuntimeToken = process.env[piRuntimeTokenEnvKey]
const originalHostedUsageCallbackToken = process.env[hostedRuntimeUsageCallbackTokenEnvKey]
const originalBrowserbaseKey = process.env.AGENT_ROOM_SEARCH_BROWSERBASE_API_KEY
const originalWebSocket = globalThis.WebSocket

export async function executeWebTool(input: object) {
    const events: Array<{ event: string; payload: unknown }> = []
    const tools = createWebTools({
        config: createTestPiRuntimeConfig({
            search: {
                brave: {
                    enabled: true,
                    envKey: 'AGENT_ROOM_SEARCH_BRAVE_API_KEY',
                    country: null,
                    searchLang: null,
                    safeSearch: 'moderate',
                    timeoutMs: 10000,
                    resultCount: 5,
                },
            },
        }),
        audit: async (event, payload) => {
            events.push({ event, payload })
        },
    })
    const tool = tools.find((entry) => entry.name === 'web_search')
    if (!tool) {
        throw new Error('Missing web search tool')
    }
    const result = await tool.execute('call-1', input as never, undefined, undefined, {} as never)
    return {
        result,
        events,
    }
}

export function resultDetails(result: Awaited<ReturnType<typeof executeWebTool>>['result']) {
    return typeof result.details === 'object' && result.details !== null
        ? (result.details as Record<string, unknown>)
        : {}
}

export class FakeSearchProvider implements SearchProvider {
    id
    label
    priority
    calls = 0
    private implementation

    constructor(input: {
        id: SearchProvider['id']
        label: string
        priority: number
        implementation: (input: SearchProviderSearchInput, calls: number) => SearchProviderResponse
    }) {
        this.id = input.id
        this.label = input.label
        this.priority = input.priority
        this.implementation = input.implementation
    }

    isConfigured(): boolean {
        return true
    }

    async search(input: SearchProviderSearchInput): Promise<SearchProviderResponse> {
        this.calls += 1
        return this.implementation(input, this.calls)
    }
}

export function resetWebToolTestGlobals() {
    globalThis.fetch = originalFetch
    if (originalBraveKey === undefined) {
        delete process.env.AGENT_ROOM_SEARCH_BRAVE_API_KEY
    } else {
        process.env.AGENT_ROOM_SEARCH_BRAVE_API_KEY = originalBraveKey
    }
    if (originalPiRuntimeToken === undefined) {
        delete process.env[piRuntimeTokenEnvKey]
    } else {
        process.env[piRuntimeTokenEnvKey] = originalPiRuntimeToken
    }
    if (originalHostedUsageCallbackToken === undefined) {
        delete process.env[hostedRuntimeUsageCallbackTokenEnvKey]
    } else {
        process.env[hostedRuntimeUsageCallbackTokenEnvKey] = originalHostedUsageCallbackToken
    }
    if (originalBrowserbaseKey === undefined) {
        delete process.env.AGENT_ROOM_SEARCH_BROWSERBASE_API_KEY
    } else {
        process.env.AGENT_ROOM_SEARCH_BROWSERBASE_API_KEY = originalBrowserbaseKey
    }
    globalThis.WebSocket = originalWebSocket
}
