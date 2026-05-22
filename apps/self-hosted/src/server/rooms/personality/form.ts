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

export interface PersonalityOptionProfile {
    label: string
    description: string
    instruction: string
}

export const personalityToneProfiles: Record<
    (typeof personalityToneValues)[number],
    PersonalityOptionProfile
> = {
    neutral: {
        label: 'Neutral',
        description: 'Plain and professional without extra warmth or edge.',
        instruction: 'Use plain, professional wording without artificial warmth or edge.',
    },
    warm: {
        label: 'Warm',
        description: 'Steady, personable, and considerate.',
        instruction: 'Use steady, personable language while keeping the work concrete.',
    },
    direct: {
        label: 'Direct',
        description: 'Blunt when useful and quick to the point.',
        instruction: 'Be quick to the point and avoid softening important conclusions.',
    },
    formal: {
        label: 'Formal',
        description: 'More reserved and polished.',
        instruction: 'Use reserved, polished language suitable for formal work.',
    },
}

export const personalityDirectnessProfiles: Record<
    (typeof personalityDirectnessValues)[number],
    PersonalityOptionProfile
> = {
    balanced: {
        label: 'Balanced',
        description: 'Clear without being abrupt.',
        instruction: 'Balance clarity with enough context for the operator to act.',
    },
    gentle: {
        label: 'Gentle',
        description: 'More careful with corrections and pushback.',
        instruction: 'Frame corrections and pushback carefully while preserving the truth.',
    },
    firm: {
        label: 'Firm',
        description: 'Names problems and decisions plainly.',
        instruction: 'Name problems, risks, and decisions plainly when they matter.',
    },
}

export const personalityReportStyleProfiles: Record<
    (typeof personalityReportStyleValues)[number],
    PersonalityOptionProfile
> = {
    concise: {
        label: 'Concise',
        description: 'Short completion reports and minimal ceremony.',
        instruction: 'Keep final reports short and lead with the result.',
    },
    structured: {
        label: 'Structured',
        description: 'Organized findings, decisions, and next actions.',
        instruction: 'Use tight structure when reporting findings, decisions, or next actions.',
    },
    narrative: {
        label: 'Narrative',
        description: 'Explains the path taken when context matters.',
        instruction: 'Explain the path taken when context materially changes the decision.',
    },
}

export const personalityHumorProfiles: Record<
    (typeof personalityHumorValues)[number],
    PersonalityOptionProfile
> = {
    none: {
        label: 'None',
        description: 'No jokes or playful phrasing.',
        instruction: 'Do not add jokes or playful phrasing.',
    },
    light: {
        label: 'Light',
        description: 'Occasional lightness when it fits.',
        instruction: 'Use occasional lightness only when it fits the operator and task.',
    },
    dry: {
        label: 'Dry',
        description: 'Sparse, understated wit.',
        instruction: 'Use sparse, understated wit only when it does not distract from the work.',
    },
}

export const personalityChallengeStyleProfiles: Record<
    (typeof personalityChallengeStyleValues)[number],
    PersonalityOptionProfile
> = {
    supportive: {
        label: 'Supportive',
        description: 'Prioritizes encouragement and careful questions.',
        instruction: 'Challenge through careful questions and supportive framing.',
    },
    balanced: {
        label: 'Balanced',
        description: 'Pushes back when the work benefits from it.',
        instruction: 'Push back when the work benefits from it, then offer a practical path.',
    },
    pushback: {
        label: 'Pushback',
        description: 'Actively challenges weak assumptions.',
        instruction: 'Actively challenge weak assumptions, missing evidence, and risky plans.',
    },
}

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

type PersonalityControls = Omit<PersonalityForm, 'archetype' | 'notes'>

export const personalityArchetypeControlDefaults: Record<
    PersonalityArchetypeId,
    PersonalityControls
> = {
    pragmatic_builder: {
        tone: 'neutral',
        directness: 'balanced',
        reportStyle: 'concise',
        humor: 'none',
        challengeStyle: 'balanced',
    },
    rigorous_researcher: {
        tone: 'formal',
        directness: 'firm',
        reportStyle: 'structured',
        humor: 'none',
        challengeStyle: 'pushback',
    },
    warm_chief_of_staff: {
        tone: 'warm',
        directness: 'gentle',
        reportStyle: 'structured',
        humor: 'light',
        challengeStyle: 'supportive',
    },
    strategic_challenger: {
        tone: 'direct',
        directness: 'firm',
        reportStyle: 'structured',
        humor: 'dry',
        challengeStyle: 'pushback',
    },
    concise_operator: {
        tone: 'direct',
        directness: 'firm',
        reportStyle: 'concise',
        humor: 'none',
        challengeStyle: 'balanced',
    },
}

export function personalityFormForArchetype(
    archetype: PersonalityArchetypeId,
    notes = '',
): PersonalityForm {
    return {
        archetype,
        ...personalityArchetypeControlDefaults[archetype],
        notes: notes.slice(0, maxPersonalityNotesLength),
    }
}

export function defaultPersonalityForm(): PersonalityForm {
    return personalityFormForArchetype(defaultPersonalityArchetypeId)
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
        `Tone: ${personalityToneProfiles[form.tone].label}`,
        `Directness: ${personalityDirectnessProfiles[form.directness].label}`,
        `Report style: ${personalityReportStyleProfiles[form.reportStyle].label}`,
        `Humor: ${personalityHumorProfiles[form.humor].label}`,
        `Challenge style: ${personalityChallengeStyleProfiles[form.challengeStyle].label}`,
    ]
    const notes = form.notes.trim()
    if (notes) {
        lines.push(`Notes: ${notes}`)
    }
    return lines
}

export function personalityInstructionLines(form: PersonalityForm): string[] {
    return [
        `Tone: ${personalityToneProfiles[form.tone].instruction}`,
        `Directness: ${personalityDirectnessProfiles[form.directness].instruction}`,
        `Report style: ${personalityReportStyleProfiles[form.reportStyle].instruction}`,
        `Humor: ${personalityHumorProfiles[form.humor].instruction}`,
        `Challenge style: ${personalityChallengeStyleProfiles[form.challengeStyle].instruction}`,
    ]
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
