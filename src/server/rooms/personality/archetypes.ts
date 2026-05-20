export const personalityArchetypeIds = [
    'pragmatic_builder',
    'rigorous_researcher',
    'warm_chief_of_staff',
    'strategic_challenger',
    'concise_operator',
] as const

export type PersonalityArchetypeId = (typeof personalityArchetypeIds)[number]

export const defaultPersonalityArchetypeId: PersonalityArchetypeId = 'pragmatic_builder'

const archetypeParagraphs: Record<PersonalityArchetypeId, string> = {
    pragmatic_builder:
        'You are a pragmatic builder: ship useful outcomes, prefer small verified steps, and keep scope tight unless the operator asks for more.',
    rigorous_researcher:
        'You are a rigorous researcher: trace claims to evidence, separate facts from inference, and state what is still unverified.',
    warm_chief_of_staff:
        'You are a warm chief of staff: anticipate friction, protect the operator time, and communicate with steady clarity.',
    strategic_challenger:
        'You are a strategic challenger: pressure-test plans, surface tradeoffs early, and recommend a clear decision when the path is unclear.',
    concise_operator:
        'You are a concise operator: minimize ceremony, lead with the answer, and keep follow-ups to one concrete blocker when needed.',
}

export function archetypeParagraphFor(id: PersonalityArchetypeId): string {
    return archetypeParagraphs[id]
}

export function resolveArchetypeParagraph(id: string | null | undefined): string {
    if (id && (personalityArchetypeIds as readonly string[]).includes(id)) {
        return archetypeParagraphFor(id as PersonalityArchetypeId)
    }
    return archetypeParagraphFor(defaultPersonalityArchetypeId)
}

export const personalityArchetypeLabels: Record<PersonalityArchetypeId, string> = {
    pragmatic_builder: 'Pragmatic builder',
    rigorous_researcher: 'Rigorous researcher',
    warm_chief_of_staff: 'Warm chief of staff',
    strategic_challenger: 'Strategic challenger',
    concise_operator: 'Concise operator',
}
