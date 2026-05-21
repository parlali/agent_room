// @vitest-environment jsdom

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ToggleSelector, mergeToggleSelectorItems } from './toggle-selector'

vi.mock('#/components/ui/switch', () => ({
    Switch: ({
        checked,
        onCheckedChange,
        'aria-label': ariaLabel,
    }: {
        checked: boolean
        onCheckedChange: (checked: boolean) => void
        'aria-label': string
    }) => (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={ariaLabel}
            onClick={() => onCheckedChange(!checked)}
        />
    ),
}))

type Item = {
    value: string
}

const visibleItems: Item[] = [{ value: 'client_app' }, { value: 'data' }]
const reactActGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactActGlobal.IS_REACT_ACT_ENVIRONMENT = true

describe('ToggleSelector interactions', () => {
    let root: Root | null = null
    let container: HTMLDivElement | null = null

    afterEach(() => {
        if (root) {
            act(() => root?.unmount())
        }
        container?.remove()
        root = null
        container = null
    })

    it('keeps the second row bound to the second value after selection changes', async () => {
        container = document.createElement('div')
        document.body.append(container)
        root = createRoot(container)
        const toggledValues: string[] = []

        function Harness() {
            const [selectedValues, setSelectedValues] = useState<string[]>([])
            const rows = mergeToggleSelectorItems({
                visibleItems,
                selectedItems: selectedValues.map((value) => ({ value })),
                getValue: (item) => item.value,
            })

            return (
                <ToggleSelector
                    items={rows}
                    selectedValues={selectedValues}
                    getValue={(item) => item.value}
                    getAriaLabel={(item) => `Toggle ${item.value}`}
                    onCheckedChange={(value, checked) => {
                        toggledValues.push(value)
                        setSelectedValues((current) =>
                            checked
                                ? Array.from(new Set([...current, value]))
                                : current.filter((entry) => entry !== value),
                        )
                    }}
                    renderItem={(item) => <span>{item.value}</span>}
                />
            )
        }

        await act(async () => {
            root?.render(<Harness />)
        })

        expect(rowLabels()).toEqual(['client_app', 'data'])

        await clickSwitch(1)

        expect(toggledValues).toEqual(['data'])
        expect(rowLabels()).toEqual(['client_app', 'data'])

        await clickSwitch(1)

        expect(toggledValues).toEqual(['data', 'data'])
        expect(rowLabels()).toEqual(['client_app', 'data'])
    })

    async function clickSwitch(index: number) {
        const switchButton = container?.querySelectorAll('button[role="switch"]').item(index)
        expect(switchButton).toBeInstanceOf(HTMLButtonElement)
        await act(async () => {
            switchButton?.dispatchEvent(
                new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                }),
            )
        })
    }

    function rowLabels() {
        return Array.from(container?.querySelectorAll('li') ?? []).map(
            (row) => row.textContent ?? '',
        )
    }
})
