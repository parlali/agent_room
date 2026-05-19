import type { Api, Model } from '@mariozechner/pi-ai'
import type { RoomExecutionSpeedMode } from '../rooms/execution-types'

const CODEX_SPEED_MODES: RoomExecutionSpeedMode[] = ['normal', 'fast']

export function normalizeSpeedMode(value: unknown): RoomExecutionSpeedMode {
    return value === 'fast' ? 'fast' : 'normal'
}

export function availableSpeedModesForModel(
    model: Model<Api> | undefined,
): RoomExecutionSpeedMode[] {
    return model?.provider === 'openai-codex' && model.api === 'openai-codex-responses'
        ? CODEX_SPEED_MODES
        : []
}

export function clampSpeedMode(
    value: RoomExecutionSpeedMode | null,
    levels: RoomExecutionSpeedMode[],
): RoomExecutionSpeedMode | null {
    if (levels.length === 0) return null
    const normalized = normalizeSpeedMode(value)
    return levels.includes(normalized) ? normalized : (levels[0] ?? null)
}

export function codexServiceTierForSpeedMode(
    model: Model<Api>,
    speedMode: RoomExecutionSpeedMode | null | undefined,
): 'priority' | undefined {
    if (model.provider !== 'openai-codex' || model.api !== 'openai-codex-responses') {
        return undefined
    }
    return speedMode === 'fast' ? 'priority' : undefined
}
