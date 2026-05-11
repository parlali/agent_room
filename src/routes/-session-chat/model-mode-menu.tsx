import { BrainCircuitIcon, ChevronDownIcon, Loader2Icon } from 'lucide-react'

import { Button } from '#/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
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
                    <span className="truncate text-foreground">{state.label}</span>
                    <span className="hidden truncate text-muted-foreground sm:inline">
                        {thinkingLabel}
                    </span>
                    <ChevronDownIcon className="ml-auto size-3.5" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuLabel>Model</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                    value={state.value}
                    onValueChange={(value) => {
                        const option = state.options.find((item) => item.value === value)
                        if (!option || option.value === state.value) return
                        onChange({
                            provider: option.provider,
                            model: option.model,
                            thinkingLevel: state.thinkingLevel,
                        })
                    }}
                >
                    {state.options.map((option) => (
                        <DropdownMenuRadioItem
                            key={option.value}
                            value={option.value}
                            className="items-start py-1.5"
                        >
                            <div className="min-w-0">
                                <div className="truncate">{option.label}</div>
                                <div className="truncate text-xs text-muted-foreground">
                                    {option.provider}/{option.model}
                                </div>
                            </div>
                        </DropdownMenuRadioItem>
                    ))}
                </DropdownMenuRadioGroup>

                <DropdownMenuSeparator />
                <DropdownMenuLabel>Reasoning</DropdownMenuLabel>
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
                    {state.availableThinkingLevels.map((level) => (
                        <DropdownMenuRadioItem
                            key={level}
                            value={level}
                            className={cn(level === 'off' && 'text-muted-foreground')}
                        >
                            {THINKING_LABELS[level]}
                        </DropdownMenuRadioItem>
                    ))}
                </DropdownMenuRadioGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
