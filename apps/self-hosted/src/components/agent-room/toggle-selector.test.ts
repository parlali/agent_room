import { describe, expect, it } from 'vitest'

import { mergeToggleSelectorItems } from './toggle-selector'

type Item = {
    value: string
    label: string
}

const item = (value: string): Item => ({
    value,
    label: value,
})

describe('mergeToggleSelectorItems', () => {
    it('keeps visible row positions stable when a visible item becomes selected', () => {
        const rows = mergeToggleSelectorItems({
            visibleItems: [item('client_app'), item('data')],
            selectedItems: [item('data')],
            getValue: (entry) => entry.value,
        })

        expect(rows.map((entry) => entry.value)).toEqual(['client_app', 'data'])
    })

    it('appends selected-only rows without duplicating visible items', () => {
        const rows = mergeToggleSelectorItems({
            visibleItems: [item('client_app'), item('data')],
            selectedItems: [item('data'), item('archived')],
            getValue: (entry) => entry.value,
        })

        expect(rows.map((entry) => entry.value)).toEqual(['client_app', 'data', 'archived'])
    })
})
