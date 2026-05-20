import { z } from 'zod'
import {
    defaultPersonalityArchetypeId,
    personalityArchetypeIds,
    type PersonalityArchetypeId,
} from './archetypes'

export const personalityToneValues = ['neutral', 'warm', 'direct', 'formal'] as const
export const personalityDirectnessValues = ['balanced', 'gentle', 'firm'] as const
export const personalityReportStyleValues = ['concise', 'structured', 'narrative'] as const
export const personalityHumorValues = ['none', 'light', 'dry'] as const
export const personalityChallengeStyleValues = ['supportive', 'balanced', 'pushback'] as const

export const maxPersonalityNotesLength = 400

export const personalityFormSchema = z.strictObject({
    archetype: z.enum(personalityArchetypeIds),
    tone: z.enum(personalityToneValues),
    directness: z.enum(personalityDirectnessValues),
    reportStyle: z.enum(personalityReportStyleValues),
    humor: z.enum(personalityHumorValues),
    challengeStyle: z.enum(personalityChallengeStyleValues),
    notes: z.string().max(maxPersonalityNotesLength),
})

export type PersonalityForm = z.infer<typeof personalityFormSchema>

export function defaultPersonalityForm(): PersonalityForm {
    return {
        archetype: defaultPersonalityArchetypeId,
        tone: 'neutral',
        directness: 'balanced',
        reportStyle: 'concise',
        humor: 'none',
        challengeStyle: 'balanced',
        notes: '',
    }
}

export function sanitizePersonalityForm(input: unknown): PersonalityForm {
    const defaults = defaultPersonalityForm()
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        return defaults
    }
    const value = input as Record<string, unknown>
    const notes =
        typeof value.notes === 'string'
            ? value.notes.slice(0, maxPersonalityNotesLength)
            : defaults.notes
    return {
        archetype: personalityArchetypeIds.includes(value.archetype as PersonalityArchetypeId)
            ? (value.archetype as PersonalityArchetypeId)
            : defaults.archetype,
        tone: personalityToneValues.includes(value.tone as PersonalityForm['tone'])
            ? (value.tone as PersonalityForm['tone'])
            : defaults.tone,
        directness: personalityDirectnessValues.includes(
            value.directness as PersonalityForm['directness'],
        )
            ? (value.directness as PersonalityForm['directness'])
            : defaults.directness,
        reportStyle: personalityReportStyleValues.includes(
            value.reportStyle as PersonalityForm['reportStyle'],
        )
            ? (value.reportStyle as PersonalityForm['reportStyle'])
            : defaults.reportStyle,
        humor: personalityHumorValues.includes(value.humor as PersonalityForm['humor'])
            ? (value.humor as PersonalityForm['humor'])
            : defaults.humor,
        challengeStyle: personalityChallengeStyleValues.includes(
            value.challengeStyle as PersonalityForm['challengeStyle'],
        )
            ? (value.challengeStyle as PersonalityForm['challengeStyle'])
            : defaults.challengeStyle,
        notes,
    }
}

export function personalityMemoryLines(form: PersonalityForm): string[] {
    const lines = [
        `Tone: ${form.tone}`,
        `Directness: ${form.directness}`,
        `Report style: ${form.reportStyle}`,
        `Humor: ${form.humor}`,
        `Challenge style: ${form.challengeStyle}`,
    ]
    const notes = form.notes.trim()
    if (notes) {
        lines.push(`Notes: ${notes}`)
    }
    return lines
}

export function friendlyArchetypeLabel(archetype: PersonalityArchetypeId): string {
    const labels: Record<PersonalityArchetypeId, string> = {
        pragmatic_builder: 'a pragmatic builder',
        rigorous_researcher: 'a rigorous researcher',
        warm_chief_of_staff: 'a warm chief of staff',
        strategic_challenger: 'a strategic challenger',
        concise_operator: 'a concise operator',
    }
    return labels[archetype]
}
