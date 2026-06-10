import { describe, expect, it } from 'vitest'
import {
    defaultPersonalityForm,
    personalityInstructionLines,
    sanitizePersonalityForm,
} from './form'
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

    it('renders structured tuning instructions through trusted lookup', () => {
        const form = sanitizePersonalityForm({
            archetype: 'strategic_challenger',
            tone: 'direct',
            directness: 'firm',
            reportStyle: 'structured',
            humor: 'dry',
            challengeStyle: 'pushback',
            notes: 'Secret notes should stay out of prompt directives',
        })

        const lines = personalityInstructionLines(form).join('\n')

        expect(lines).toContain('Tone: Be quick to the point')
        expect(lines).toContain('Directness: Name problems')
        expect(lines).toContain('Report style: Use tight structure')
        expect(lines).toContain('Humor: Use sparse, understated wit')
        expect(lines).toContain('Challenge style: Actively challenge weak assumptions')
        expect(lines).not.toContain('Secret notes')
    })
})
