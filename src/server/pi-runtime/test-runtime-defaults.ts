import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type {
    CapabilityConfig,
    ImageRuntimeConfig,
    MaterializedMcpServer,
    RunBudgetConfig,
    SearchRuntimeConfig,
} from '../domain/types'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'

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
    deepWorkTurnMs: 6 * 60 * 60 * 1000,
    subagentTurnMs: 2 * 60 * 60 * 1000,
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

export interface TestPiRuntimeConfigOptions {
    root?: string
    runtime?: Partial<PiRuntimeConfig['runtime']>
    paths?: Partial<PiRuntimeConfig['paths']>
    provider?: Partial<PiRuntimeConfig['provider']>
    roomMode?: PiRuntimeConfig['roomMode']
    capabilities?: Partial<CapabilityConfig>
    search?: Partial<SearchRuntimeConfig>
    image?: Partial<ImageRuntimeConfig>
    github?: Partial<PiRuntimeConfig['github']>
    budgets?: Partial<RunBudgetConfig>
    instructions?: string
    mcpServers?: MaterializedMcpServer[]
    models?: PiRuntimeConfig['models']
    compaction?: Partial<PiRuntimeConfig['compaction']>
}

export function createTestPiRuntimeConfig(
    options: TestPiRuntimeConfigOptions = {},
): PiRuntimeConfig {
    const root = options.root ?? '/tmp/agent-room-test'
    const stateDir = options.paths?.stateDir ?? join(root, 'pi-state')
    const workspaceDir = options.paths?.workspaceDir ?? join(root, 'workspace')
    const storeDir = options.paths?.storeDir ?? join(root, 'store')
    const sessionsDir = options.paths?.sessionsDir ?? join(stateDir, 'sessions')
    const internalStateDir = options.paths?.internalStateDir ?? join(stateDir, 'internal-state')
    const homeDir = options.paths?.homeDir ?? join(stateDir, 'home')
    const tmpDir = options.paths?.tmpDir ?? join(stateDir, 'tmp')

    return {
        runtime: {
            kind: 'pi',
            roomId: 'room-1',
            displayName: 'Room One',
            bindHost: '127.0.0.1',
            port: 32123,
            token: 'token-token-token-token-token',
            ...options.runtime,
        },
        paths: {
            roomRootDir: root,
            stateDir,
            workspaceDir,
            storeDir,
            sessionsDir,
            internalStateDir,
            authPath: join(stateDir, 'auth.json'),
            modelsPath: join(stateDir, 'models.json'),
            threadIndexPath: join(stateDir, 'threads.json'),
            runtimeEventsPath: join(stateDir, 'runtime-events.jsonl'),
            homeDir,
            tmpDir,
            ...options.paths,
        },
        provider: {
            sourceProvider: 'ollama',
            sourceModel: 'llama',
            piProvider: 'ollama',
            piModel: 'llama',
            api: 'openai-completions',
            authMode: 'api_key',
            baseUrl: 'http://127.0.0.1:11434/v1',
            envKey: null,
            kind: 'local',
            fallbackModels: [],
            ...options.provider,
        },
        roomMode: options.roomMode ?? 'coworker',
        capabilities: {
            ...testCapabilities,
            ...options.capabilities,
        },
        search: {
            ...testSearch,
            ...options.search,
        },
        image: {
            ...testImage,
            ...options.image,
        },
        github: {
            enabled: false,
            installationId: null,
            accountLogin: null,
            repositories: [],
            tokenEnvKey: null,
            tokenExpiresAt: null,
            ghHostsPath: null,
            gitCredentialsPath: null,
            gitConfigPath: null,
            ...options.github,
        },
        budgets: {
            ...testBudgets,
            ...options.budgets,
        },
        instructions: options.instructions ?? '',
        mcpServers: options.mcpServers ?? [],
        models: options.models ?? {
            providers: {},
        },
        compaction: {
            enabled: true,
            reserveTokens: 16384,
            keepRecentTokens: 20000,
            ...options.compaction,
        },
    }
}

export async function ensureTestPiRuntimeDirectories(config: PiRuntimeConfig): Promise<void> {
    await Promise.all([
        mkdir(config.paths.stateDir, { recursive: true }),
        mkdir(config.paths.workspaceDir, { recursive: true }),
        mkdir(config.paths.storeDir, { recursive: true }),
        mkdir(config.paths.sessionsDir, { recursive: true }),
        mkdir(config.paths.internalStateDir, { recursive: true }),
        mkdir(config.paths.homeDir, { recursive: true }),
        mkdir(config.paths.tmpDir, { recursive: true }),
    ])
}
