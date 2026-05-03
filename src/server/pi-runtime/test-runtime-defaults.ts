import type {
    CapabilityConfig,
    ImageRuntimeConfig,
    RunBudgetConfig,
    SearchRuntimeConfig,
} from '../domain/types'

export const testCapabilities: CapabilityConfig = {
    webSearch: true,
    urlFetch: true,
    documents: true,
    spreadsheets: true,
    presentations: true,
    pdf: true,
    images: true,
    mcp: true,
    shellCoding: true,
}

export const testSearch: SearchRuntimeConfig = {
    enabled: true,
    backendUrl: 'http://127.0.0.1:8888',
    defaultResultCount: 5,
    timeoutMs: 10000,
}

export const testImage: ImageRuntimeConfig = {
    enabled: false,
    provider: null,
    model: null,
    envKey: null,
}

export const testBudgets: RunBudgetConfig = {
    manualTurnMs: 8 * 60 * 60 * 1000,
    scheduledTurnMs: 8 * 60 * 60 * 1000,
    subagentTurnMs: 8 * 60 * 60 * 1000,
    maintenanceTurnMs: 10 * 60 * 1000,
    idleTimeoutMs: 10 * 60 * 1000,
    providerIdleTimeoutMs: 2 * 60 * 1000,
    shellCommandMs: 30 * 60 * 1000,
    webFetchMs: 15000,
    documentWorkerMs: 10 * 60 * 1000,
    imageGenerationMs: 5 * 60 * 1000,
    mcpToolMs: 2 * 60 * 1000,
    shortCommandWaitMs: 5000,
}
