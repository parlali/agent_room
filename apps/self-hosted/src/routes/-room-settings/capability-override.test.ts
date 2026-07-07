import { describe, expect, it } from 'vitest'
import { CAPABILITY_OPTIONS, type CapabilityOption } from '#/domain/capabilities'
import { mergeCapabilities } from '#/server/configuration/capabilities'
import { applyCapabilityOverride } from './model'

function optionById(id: string): CapabilityOption {
    const option = CAPABILITY_OPTIONS.find((entry) => entry.id === id)
    if (!option) throw new Error(`missing capability option: ${id}`)
    return option
}

describe('applyCapabilityOverride', () => {
    it('persists a toggle for capabilities where id equals key', () => {
        const idEqualsKey = ['documents', 'spreadsheets', 'presentations', 'pdf', 'images', 'mcp']
        for (const id of idEqualsKey) {
            const option = optionById(id)
            expect(option.id).toBe(option.key)

            const overrides = applyCapabilityOverride({
                overrides: {},
                option,
                next: false,
                appDefaults: null,
            })

            expect(overrides[option.id]).toBe(false)

            const merged = mergeCapabilities({
                defaults: {},
                overrides,
                roomMode: 'coworker',
                mcpConnectionCount: 5,
            })
            expect(merged[option.key]).toBe(false)
        }
    })

    it('persists a toggle for capabilities where id differs from key', () => {
        const option = optionById('shell_coding')
        expect(option.id).not.toBe(option.key)

        const overrides = applyCapabilityOverride({
            overrides: {},
            option,
            next: false,
            appDefaults: null,
        })

        const merged = mergeCapabilities({
            defaults: {},
            overrides,
            roomMode: 'coworker',
            mcpConnectionCount: 5,
        })
        expect(merged.shellCoding).toBe(false)
    })

    it('drops the override when the new value matches the app default', () => {
        const option = optionById('images')
        const overrides = applyCapabilityOverride({
            overrides: { images: false },
            option,
            next: true,
            appDefaults: { images: true } as Record<string, boolean>,
        })
        expect(overrides.images).toBeUndefined()
    })

    it('clears the legacy camelCase key when writing under the id', () => {
        const option = optionById('shell_coding')
        const overrides = applyCapabilityOverride({
            overrides: { shellCoding: true },
            option,
            next: false,
            appDefaults: null,
        })
        expect(overrides.shellCoding).toBeUndefined()
        expect(overrides.shell_coding).toBe(false)
    })
})
