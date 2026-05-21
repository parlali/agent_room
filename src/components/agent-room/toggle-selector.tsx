import type { ReactNode } from 'react'

import { Switch } from '#/components/ui/switch'
import { cn } from '#/lib/utils'

export function mergeToggleSelectorItems<TItem>({
    visibleItems,
    selectedItems,
    getValue,
}: {
    visibleItems: readonly TItem[]
    selectedItems: readonly TItem[]
    getValue: (item: TItem) => string
}): TItem[] {
    const seen = new Set<string>()
    const merged: TItem[] = []

    for (const item of visibleItems) {
        const value = getValue(item)
        if (seen.has(value)) continue
        seen.add(value)
        merged.push(item)
    }

    for (const item of selectedItems) {
        const value = getValue(item)
        if (seen.has(value)) continue
        seen.add(value)
        merged.push(item)
    }

    return merged
}

export function ToggleSelector<TItem>({
    items,
    selectedValues,
    getValue,
    renderItem,
    getAriaLabel,
    onCheckedChange,
    className,
    itemClassName,
}: {
    items: readonly TItem[]
    selectedValues: readonly string[]
    getValue: (item: TItem) => string
    renderItem: (item: TItem, checked: boolean) => ReactNode
    getAriaLabel: (item: TItem, checked: boolean) => string
    onCheckedChange: (value: string, checked: boolean, item: TItem) => void
    className?: string
    itemClassName?: string
}) {
    const selectedValueSet = new Set(selectedValues)

    return (
        <ul className={cn('divide-y divide-border/60', className)}>
            {items.map((item) => {
                const value = getValue(item)
                const checked = selectedValueSet.has(value)
                return (
                    <li
                        key={value}
                        className={cn('flex items-center gap-3 px-4 py-3', itemClassName)}
                    >
                        <div className="min-w-0 flex-1">{renderItem(item, checked)}</div>
                        <Switch
                            checked={checked}
                            onCheckedChange={(next) => onCheckedChange(value, next, item)}
                            aria-label={getAriaLabel(item, checked)}
                        />
                    </li>
                )
            })}
        </ul>
    )
}
