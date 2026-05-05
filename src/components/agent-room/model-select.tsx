import type { ModelOption } from '#/lib/model-options'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '#/components/ui/select'

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
