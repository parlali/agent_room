import { BrainCircuitIcon, ChevronDownIcon, Loader2Icon } from 'lucide-react'

import { Button } from '#/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import type {
    RoomExecutionModelState,
    RoomExecutionSpeedMode,
    RoomExecutionThinkingLevel,
} from '#/domain/room-execution-types'

export type ModelModeChange = {
    provider: string
    model: string
    thinkingLevel: RoomExecutionThinkingLevel | null
    speedMode: RoomExecutionSpeedMode | null
}

const THINKING_LABELS: Record<RoomExecutionThinkingLevel, string> = {
    off: 'Standard',
    minimal: 'Minimal',
    low: 'Light',
    medium: 'Balanced',
    high: 'Smarter',
    xhigh: 'Smartest',
}

const ORDERED_THINKING_LEVELS: RoomExecutionThinkingLevel[] = [
    'off',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
]
const SPEED_LABELS: Record<RoomExecutionSpeedMode, string> = {
    normal: 'Normal',
    fast: 'Faster',
}

export function ModelModeMenu({
    state,
    disabled,
    updating,
    onChange,
}: {
    state: RoomExecutionModelState | null
    disabled: boolean
    updating: boolean
    onChange: (change: ModelModeChange) => void
}) {
    if (!state) return null

    const thinkingLabel = THINKING_LABELS[state.thinkingLevel] ?? state.thinkingLevel
    const visibleThinkingLevels = menuThinkingLevels(state)
    const visibleSpeedModes = menuSpeedModes(state)
    const speedLabel = state.speedMode ? SPEED_LABELS[state.speedMode] : null
    const showSpeedInTrigger = state.speedMode === 'fast'

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={disabled || updating}
                    className="max-w-40 justify-start gap-1.5 px-2 text-muted-foreground sm:max-w-48"
                    aria-label="Choose intelligence and speed"
                >
                    {updating ? <Loader2Icon className="animate-spin" /> : <BrainCircuitIcon />}
                    <span className="truncate text-foreground">{thinkingLabel}</span>
                    {showSpeedInTrigger ? (
                        <span className="hidden truncate text-muted-foreground sm:inline">
                            {speedLabel}
                        </span>
                    ) : null}
                    <ChevronDownIcon className="ml-auto size-3.5" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 rounded-xl p-2">
                <DropdownMenuLabel className="px-2 text-sm">Intelligence</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                    value={state.thinkingLevel}
                    onValueChange={(value) => {
                        if (value === state.thinkingLevel) return
                        onChange({
                            provider: state.provider,
                            model: state.model,
                            thinkingLevel: value as RoomExecutionThinkingLevel,
                            speedMode: state.speedMode,
                        })
                    }}
                >
                    {visibleThinkingLevels.map((level) => (
                        <DropdownMenuRadioItem
                            key={level}
                            value={level}
                            className="py-2 pr-9 pl-2 text-base"
                        >
                            {THINKING_LABELS[level]}
                        </DropdownMenuRadioItem>
                    ))}
                </DropdownMenuRadioGroup>
                {visibleSpeedModes.length > 1 ? (
                    <>
                        <DropdownMenuSeparator className="mx-2 my-2" />
                        <DropdownMenuLabel className="px-2 text-sm">Speed</DropdownMenuLabel>
                        <DropdownMenuRadioGroup
                            value={state.speedMode ?? ''}
                            onValueChange={(value) => {
                                if (value === state.speedMode) return
                                onChange({
                                    provider: state.provider,
                                    model: state.model,
                                    thinkingLevel: state.thinkingLevel,
                                    speedMode: value as RoomExecutionSpeedMode,
                                })
                            }}
                        >
                            {visibleSpeedModes.map((mode) => (
                                <DropdownMenuRadioItem
                                    key={mode}
                                    value={mode}
                                    className="py-2 pr-9 pl-2 text-base"
                                >
                                    {SPEED_LABELS[mode]}
                                </DropdownMenuRadioItem>
                            ))}
                        </DropdownMenuRadioGroup>
                    </>
                ) : null}
                {state.options.length > 1 ? (
                    <>
                        <DropdownMenuSeparator className="mx-2 my-2" />
                        <DropdownMenuSub>
                            <DropdownMenuSubTrigger className="px-2 py-2 text-base text-muted-foreground">
                                Advanced
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent className="max-h-96 w-72 overflow-y-auto rounded-xl p-2">
                                <DropdownMenuLabel className="px-2 text-sm">
                                    Model
                                </DropdownMenuLabel>
                                <ModelRadioItems state={state} onChange={onChange} />
                            </DropdownMenuSubContent>
                        </DropdownMenuSub>
                    </>
                ) : null}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

function ModelRadioItems({
    state,
    onChange,
}: {
    state: RoomExecutionModelState
    onChange: (change: ModelModeChange) => void
}) {
    return (
        <DropdownMenuRadioGroup
            value={state.value}
            onValueChange={(value) => {
                const option = state.options.find((item) => item.value === value)
                if (!option || option.value === state.value) return
                onChange({
                    provider: option.provider,
                    model: option.model,
                    thinkingLevel: nextThinkingLevel(state, option),
                    speedMode: nextSpeedMode(state, option),
                })
            }}
        >
            {state.options.map((option) => (
                <DropdownMenuRadioItem
                    key={option.value}
                    value={option.value}
                    className="items-start py-2 pr-9 pl-2 text-base"
                >
                    <span className="min-w-0">
                        <span className="block truncate">{option.label}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                            {option.provider}/{option.model}
                        </span>
                    </span>
                </DropdownMenuRadioItem>
            ))}
        </DropdownMenuRadioGroup>
    )
}

function menuThinkingLevels(state: RoomExecutionModelState): RoomExecutionThinkingLevel[] {
    const visible = ORDERED_THINKING_LEVELS.filter((level) =>
        state.availableThinkingLevels.includes(level),
    )

    if (
        state.availableThinkingLevels.includes(state.thinkingLevel) &&
        !visible.includes(state.thinkingLevel)
    ) {
        return [state.thinkingLevel, ...visible]
    }

    return visible.length > 0 ? visible : state.availableThinkingLevels
}

function nextThinkingLevel(
    state: RoomExecutionModelState,
    option: RoomExecutionModelState['options'][number],
): RoomExecutionThinkingLevel {
    if (option.availableThinkingLevels.includes(state.thinkingLevel)) {
        return state.thinkingLevel
    }

    return option.availableThinkingLevels[0] ?? state.thinkingLevel
}

function menuSpeedModes(state: RoomExecutionModelState): RoomExecutionSpeedMode[] {
    return state.availableSpeedModes
}

function nextSpeedMode(
    state: RoomExecutionModelState,
    option: RoomExecutionModelState['options'][number],
): RoomExecutionSpeedMode | null {
    if (!state.speedMode) return option.availableSpeedModes[0] ?? null
    if (option.availableSpeedModes.includes(state.speedMode)) {
        return state.speedMode
    }

    return option.availableSpeedModes[0] ?? null
}
