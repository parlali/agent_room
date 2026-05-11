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
import { cn } from '#/lib/utils'
import type {
    RoomExecutionModelState,
    RoomExecutionThinkingLevel,
} from '#/server/rooms/execution-types'

export type ModelModeChange = {
    provider: string
    model: string
    thinkingLevel: RoomExecutionThinkingLevel | null
}

const THINKING_LABELS: Record<RoomExecutionThinkingLevel, string> = {
    off: 'Off',
    minimal: 'Minimal',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    xhigh: 'Extra High',
}

const PRIMARY_THINKING_LEVELS: RoomExecutionThinkingLevel[] = ['low', 'medium', 'high', 'xhigh']

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
    const triggerModelLabel = compactModelLabel(state.label)
    const visibleThinkingLevels = menuThinkingLevels(state)
    const featuredModelOptions = state.options.filter(isFeaturedModelOption)
    const speedModelOptions = state.options.filter(isSpeedModelOption)
    const regularModelOptions = state.options.filter(
        (option) => !isFeaturedModelOption(option) && !isSpeedModelOption(option),
    )
    const modelMenuOptions = featuredModelOptions.length > 0 ? featuredModelOptions : state.options
    const otherModelOptions = featuredModelOptions.length > 0 ? regularModelOptions : []
    const modelMenuLabel = state.label || state.model

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={disabled || updating}
                    className="max-w-44 justify-start gap-1.5 px-2 text-muted-foreground sm:max-w-56"
                    aria-label="Choose model and reasoning"
                >
                    {updating ? <Loader2Icon className="animate-spin" /> : <BrainCircuitIcon />}
                    <span className="truncate text-foreground">{triggerModelLabel}</span>
                    <span className="hidden truncate text-muted-foreground sm:inline">
                        {thinkingLabel}
                    </span>
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
                <DropdownMenuSeparator className="mx-2 my-2" />
                <DropdownMenuSub>
                    <DropdownMenuSubTrigger className="px-2 py-2 text-base">
                        <span className="truncate">{modelMenuLabel}</span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="max-h-96 w-64 overflow-y-auto rounded-xl p-2">
                        <DropdownMenuLabel className="px-2 text-sm">Model</DropdownMenuLabel>
                        <ModelRadioItems
                            state={state}
                            options={modelMenuOptions}
                            onChange={onChange}
                        />
                        {otherModelOptions.length > 0 ? (
                            <>
                                <DropdownMenuSeparator className="mx-2 my-2" />
                                <DropdownMenuSub>
                                    <DropdownMenuSubTrigger className="px-2 py-2 text-base">
                                        Other models
                                    </DropdownMenuSubTrigger>
                                    <DropdownMenuSubContent className="max-h-96 w-72 overflow-y-auto rounded-xl p-2">
                                        <ModelRadioItems
                                            state={state}
                                            options={otherModelOptions}
                                            onChange={onChange}
                                            showProvider
                                        />
                                    </DropdownMenuSubContent>
                                </DropdownMenuSub>
                            </>
                        ) : null}
                    </DropdownMenuSubContent>
                </DropdownMenuSub>
                {speedModelOptions.length > 0 ? (
                    <DropdownMenuSub>
                        <DropdownMenuSubTrigger className="px-2 py-2 text-base">
                            Speed
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="max-h-96 w-72 overflow-y-auto rounded-xl p-2">
                            <ModelRadioItems
                                state={state}
                                options={speedModelOptions}
                                onChange={onChange}
                                showProvider
                            />
                        </DropdownMenuSubContent>
                    </DropdownMenuSub>
                ) : null}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

function ModelRadioItems({
    state,
    options,
    showProvider,
    onChange,
}: {
    state: RoomExecutionModelState
    options: RoomExecutionModelState['options']
    showProvider?: boolean
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
                })
            }}
        >
            {options.map((option) => (
                <DropdownMenuRadioItem
                    key={option.value}
                    value={option.value}
                    className={cn('py-2 pr-9 pl-2 text-base', showProvider && 'items-start')}
                >
                    {showProvider ? (
                        <span className="min-w-0">
                            <span className="block truncate">{option.label}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                                {option.provider}/{option.model}
                            </span>
                        </span>
                    ) : (
                        <span className="truncate">{option.label}</span>
                    )}
                </DropdownMenuRadioItem>
            ))}
        </DropdownMenuRadioGroup>
    )
}

function menuThinkingLevels(state: RoomExecutionModelState): RoomExecutionThinkingLevel[] {
    const visible = PRIMARY_THINKING_LEVELS.filter((level) =>
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

function isFeaturedModelOption(option: RoomExecutionModelState['options'][number]) {
    return option.label === 'GPT-5.5' || option.label === 'GPT-5.4'
}

function isSpeedModelOption(option: RoomExecutionModelState['options'][number]) {
    const label = option.label.toLowerCase()
    const model = option.model.toLowerCase()
    return label.includes('mini') || label.includes('spark') || model.includes('mini')
}

function compactModelLabel(label: string) {
    return label.replace(/^GPT-/, '')
}
