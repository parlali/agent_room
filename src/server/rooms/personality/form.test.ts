import { describe, expect, it } from 'vitest'
import { defaultPersonalityForm, sanitizePersonalityForm } from './form'
import { resolveArchetypeParagraph } from './archetypes'

describe('personality form', () => {
    it('falls back per field and bounds oversized notes', () => {
        const form = sanitizePersonalityForm({
            archetype: 'unknown_archetype',
            tone: 'loud',
            directness: 'balanced',
            reportStyle: 'concise',
            humor: 'none',
            challengeStyle: 'balanced',
            notes: 'x'.repeat(500),
        })
        expect(form).toEqual({
            ...defaultPersonalityForm(),
            directness: 'balanced',
            reportStyle: 'concise',
            humor: 'none',
            challengeStyle: 'balanced',
            notes: 'x'.repeat(400),
        })
    })

    it('renders archetype paragraphs only through trusted lookup', () => {
        expect(resolveArchetypeParagraph('unknown_archetype')).toContain('pragmatic builder')
    })
})
