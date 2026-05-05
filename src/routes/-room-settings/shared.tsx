import type { ModelOption } from '#/lib/model-options'
import { Button } from '#/components/ui/button'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '#/components/ui/select'
import { cn } from '#/lib/utils'
import { Loader2Icon, SaveIcon } from 'lucide-react'

export function ModelSelect({
    id,
    value,
    options,
    onChange,
    disabled = false,
}: {
    id: string
    value: string
    options: ModelOption[]
    onChange: (value: string) => void
    disabled?: boolean
}) {
    return (
        <Select value={value} onValueChange={onChange} disabled={disabled}>
            <SelectTrigger id={id} className="w-full">
                <SelectValue placeholder="Pick a model" />
            </SelectTrigger>
            <SelectContent>
                {options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                        {option.label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}

export function ModeRadio({
    label,
    description,
    checked,
    onSelect,
}: {
    label: string
    description: string
    checked: boolean
    onSelect: () => void
}) {
    return (
        <button
            type="button"
            onClick={onSelect}
            className={cn(
                'flex flex-col items-start gap-1 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                checked
                    ? 'border-foreground bg-muted/40 text-foreground'
                    : 'border-border/70 text-muted-foreground hover:border-border hover:text-foreground',
            )}
            aria-pressed={checked}
        >
            <span className="font-medium">{label}</span>
            <span className="text-xs">{description}</span>
        </button>
    )
}

export function SaveBar({
    dirty,
    pending,
    onSave,
}: {
    dirty: boolean
    pending: boolean
    onSave: () => void
}) {
    return (
        <Button
            size="sm"
            onClick={onSave}
            disabled={!dirty || pending}
            variant={dirty ? 'default' : 'outline'}
        >
            {pending ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
            Save
        </Button>
    )
}
