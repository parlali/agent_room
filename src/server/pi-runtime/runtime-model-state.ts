import { existsSync } from 'node:fs'
import { AuthStorage, ModelRegistry, SessionManager } from '@mariozechner/pi-coding-agent'
import { supportsXhigh, type Api, type Model } from '@mariozechner/pi-ai'
import type {
    RoomExecutionModelOption,
    RoomExecutionModelState,
    RoomExecutionThinkingLevel,
} from '../rooms/execution-types'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import type { ThreadRecord } from './thread-records'
import type { ActiveThread } from './runtime-runner'

const THINKING_LEVELS: RoomExecutionThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high']
const THINKING_LEVELS_WITH_XHIGH: RoomExecutionThinkingLevel[] = [...THINKING_LEVELS, 'xhigh']

interface RuntimeModelStateDependencies {
    config: PiRuntimeConfig
    activeThreads: Map<string, ActiveThread>
}

export function createRuntimeModelState(dependencies: RuntimeModelStateDependencies) {
    function createModelRegistry(): ModelRegistry {
        return ModelRegistry.create(
            AuthStorage.create(dependencies.config.paths.authPath),
            dependencies.config.paths.modelsPath,
        )
    }

    function normalizeThinkingLevel(value: unknown): RoomExecutionThinkingLevel {
        return typeof value === 'string' && (THINKING_LEVELS_WITH_XHIGH as string[]).includes(value)
            ? (value as RoomExecutionThinkingLevel)
            : 'medium'
    }

    function availableThinkingLevels(model: Model<Api> | undefined): RoomExecutionThinkingLevel[] {
        if (!model?.reasoning) return ['off']
        return supportsXhigh(model) ? THINKING_LEVELS_WITH_XHIGH : THINKING_LEVELS
    }

    function clampThinkingLevel(
        value: RoomExecutionThinkingLevel,
        levels: RoomExecutionThinkingLevel[],
    ): RoomExecutionThinkingLevel {
        if (levels.includes(value)) return value
        const requestedIndex = THINKING_LEVELS_WITH_XHIGH.indexOf(value)
        for (let index = requestedIndex; index < THINKING_LEVELS_WITH_XHIGH.length; index += 1) {
            const candidate = THINKING_LEVELS_WITH_XHIGH[index]!
            if (levels.includes(candidate)) return candidate
        }
        for (let index = requestedIndex - 1; index >= 0; index -= 1) {
            const candidate = THINKING_LEVELS_WITH_XHIGH[index]!
            if (levels.includes(candidate)) return candidate
        }
        return levels[0] ?? 'off'
    }

    function modelValue(provider: string, model: string): string {
        return `${provider}/${model}`
    }

    function modelLabel(model: Model<Api> | undefined, fallback: string): string {
        return model?.name?.trim() || fallback
    }

    function modelOption(model: Model<Api>): RoomExecutionModelOption {
        return {
            value: modelValue(model.provider, model.id),
            provider: model.provider,
            model: model.id,
            label: modelLabel(model, model.id),
            supportsReasoning: Boolean(model.reasoning),
            availableThinkingLevels: availableThinkingLevels(model),
        }
    }

    function modelOptions(
        registry: ModelRegistry,
        current?: Model<Api>,
    ): RoomExecutionModelOption[] {
        const provider = current?.provider ?? dependencies.config.provider.piProvider
        const options = registry
            .getAll()
            .filter((model) => model.provider === provider)
            .map(modelOption)
            .sort((left, right) =>
                left.label.localeCompare(right.label, undefined, { numeric: true }),
            )
        if (
            !current ||
            options.some((option) => option.value === modelValue(current.provider, current.id))
        ) {
            return options
        }
        return [modelOption(current), ...options]
    }

    function persistedThreadModel(record: ThreadRecord): {
        provider: string
        model: string
        thinkingLevel: RoomExecutionThinkingLevel
    } {
        try {
            if (existsSync(record.sessionFile)) {
                const sessionManager = SessionManager.open(
                    record.sessionFile,
                    dependencies.config.paths.sessionsDir,
                    dependencies.config.paths.workspaceDir,
                )
                const context = sessionManager.buildSessionContext()
                return {
                    provider:
                        context.model?.provider ??
                        record.modelProvider ??
                        dependencies.config.provider.piProvider,
                    model:
                        context.model?.modelId ??
                        record.model ??
                        dependencies.config.provider.piModel,
                    thinkingLevel: normalizeThinkingLevel(
                        context.thinkingLevel ?? record.thinkingLevel,
                    ),
                }
            }
        } catch (error) {
            void error
        }
        return {
            provider: record.modelProvider ?? dependencies.config.provider.piProvider,
            model: record.model ?? dependencies.config.provider.piModel,
            thinkingLevel: normalizeThinkingLevel(record.thinkingLevel),
        }
    }

    function syncRecordModelState(record: ThreadRecord, session?: ActiveThread['session']): void {
        if (session?.model) {
            record.modelProvider = session.model.provider
            record.model = session.model.id
            record.thinkingLevel = normalizeThinkingLevel(session.thinkingLevel)
            return
        }
        const persisted = persistedThreadModel(record)
        record.modelProvider = persisted.provider
        record.model = persisted.model
        record.thinkingLevel = persisted.thinkingLevel
    }

    function selectedThreadModelState(record: ThreadRecord): RoomExecutionModelState | null {
        const active = dependencies.activeThreads.get(record.key)
        const registry = createModelRegistry()
        const persisted = persistedThreadModel(record)
        const activeModel = active?.session.model
        const provider = activeModel?.provider ?? persisted.provider
        const modelId = activeModel?.id ?? persisted.model
        const model = activeModel ?? registry.find(provider, modelId)
        if (!model && !modelId) return null
        const levels =
            active?.session.getAvailableThinkingLevels() ?? availableThinkingLevels(model)
        const thinkingLevel = clampThinkingLevel(
            active ? normalizeThinkingLevel(active.session.thinkingLevel) : persisted.thinkingLevel,
            levels,
        )
        return {
            value: modelValue(provider, modelId),
            provider,
            model: modelId,
            label: modelLabel(model, modelId),
            thinkingLevel,
            availableThinkingLevels: levels,
            options: modelOptions(registry, model),
        }
    }

    return {
        createModelRegistry,
        normalizeThinkingLevel,
        syncRecordModelState,
        selectedThreadModelState,
    }
}
